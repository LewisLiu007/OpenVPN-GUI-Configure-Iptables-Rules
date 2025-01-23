#!/bin/bash

CONFIG_FILE="config.txt"

# 检查是否以 root 权限运行
if [[ $EUID -ne 0 ]]; then
   echo "此脚本必须以 root 权限运行。"
   exit 1
fi

# 检查配置文件是否存在
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "配置文件 $CONFIG_FILE 不存在。请确保配置文件在当前目录。"
    exit 1
fi

# 检查脚本参数
if [[ $# -ne 1 ]]; then
    echo "用法: $0 {add|remove}"
    exit 1
fi

ACTION=$1

# 验证 ACTION 参数
if [[ "$ACTION" != "add" && "$ACTION" != "remove" ]]; then
    echo "无效的操作: $ACTION"
    echo "用法: $0 {add|remove}"
    exit 1
fi

# 解析配置文件
parse_config() {
    local section=""
    declare -A users
    declare -A resources
    declare -a allow_rules

    while IFS= read -r line || [[ -n "$line" ]]; do
        # 去除前后空格
        line=$(echo "$line" | xargs)
        # 跳过空行和注释行
        [[ -z "$line" || "$line" =~ ^# ]] && continue

        # 检查是否为新section
        if [[ "$line" =~ ^\[(.*)\]$ ]]; then
            section="${BASH_REMATCH[1]}"
            continue
        fi

        case "$section" in
            users)
                IFS=',' read -r username user_ip <<< "$line"
                users["$username"]="$user_ip"
                ;;
            resources)
                IFS=',' read -r resource_name resource_ip <<< "$line"
                resources["$resource_name"]="$resource_ip"
                ;;
            allow_rules)
                IFS=',' read -r username resource_name <<< "$line"
                allow_rules+=("$username,$resource_name")
                ;;
        esac
    done < "$CONFIG_FILE"
    echo "${!users[@]}" "${users[@]}"
    echo "${!resources[@]}" "${resources[@]}"
    echo "${allow_rules[@]}"
}

# 解析配置文件
declare -A users
declare -A resources
declare -a allow_rules

while IFS= read -r line || [[ -n "$line" ]]; do
    line=$(echo "$line" | xargs)
    [[ -z "$line" || "$line" =~ ^# ]] && continue
    if [[ "$line" =~ ^\[(.*)\]$ ]]; then
        section="${BASH_REMATCH[1]}"
        continue
    fi
    case "$section" in
        users)
            IFS=',' read -r username user_ip <<< "$line"
            users["$username"]="$user_ip"
            ;;
        resources)
            IFS=',' read -r resource_name resource_ip <<< "$line"
            resources["$resource_name"]="$resource_ip"
            ;;
        allow_rules)
            IFS=',' read -r username resource_name <<< "$line"
            allow_rules+=("$username,$resource_name")
            ;;
    esac
done < "$CONFIG_FILE"

# 执行添加或删除规则
for username in "${!users[@]}"; do
    user_ip="${users[$username]}"
    chain_name="USER_$username"

    if [[ "$ACTION" == "remove" ]]; then
        # 删除 FORWARD 链中的跳转规则
        iptables -D FORWARD -s "$user_ip"/32 -j "$chain_name" 2>/dev/null
        if [[ $? -eq 0 ]]; then
            echo "从 FORWARD 链中删除跳转规则：$user_ip -> $chain_name"
        else
            echo "跳转规则不存在或删除失败：$user_ip -> $chain_name"
        fi

        # 删除链中的所有规则
        while iptables -L "$chain_name" -n --line-numbers | grep -q .; do
            iptables -D "$chain_name" 1
            if [[ $? -eq 0 ]]; then
                echo "从链 $chain_name 中删除一条规则。"
            else
                echo "删除链 $chain_name 中的规则失败或链已为空。"
                break
            fi
        done

        # 删除用户链
        iptables -X "$chain_name" 2>/dev/null
        if [[ $? -eq 0 ]]; then
            echo "删除链 $chain_name 成功。"
        else
            echo "删除链 $chain_name 失败或链不存在。"
        fi
    fi

    if [[ "$ACTION" == "add" ]]; then
        # 先清理现有的规则，避免重复
        iptables -D FORWARD -s "$user_ip"/32 -j "$chain_name" 2>/dev/null

        # clear old 链
	iptables -F "$chain_name" 2>/dev/null
	iptables -X "$chain_name" 2>/dev/null

        iptables -N "$chain_name"
        if [[ $? -ne 0 ]]; then
            echo "创建链 $chain_name 失败。"
            continue
        fi
        echo "创建链 $chain_name 成功。"

        # 为允许的资源添加 ACCEPT 规则
        for rule in "${allow_rules[@]}"; do
            rule_username=$(echo "$rule" | cut -d',' -f1)
            rule_resource=$(echo "$rule" | cut -d',' -f2)
            if [[ "$rule_username" == "$username" ]]; then
                resource_ip="${resources[$rule_resource]}"
                if [[ -z "$resource_ip" ]]; then
                    echo "警告：资源 $rule_resource 未在 [resources] 中定义。"
                    continue
                fi
                
                # 检查是否已经存在相同的规则
                if ! iptables -C "$chain_name" -d "$resource_ip"/32 -j ACCEPT 2>/dev/null; then
                    iptables -A "$chain_name" -d "$resource_ip"/32 -j ACCEPT
                    if [[ $? -eq 0 ]]; then
                        echo "在链 $chain_name 中添加允许规则：允许访问 $rule_resource ($resource_ip)"
                    else
                        echo "添加允许规则失败：允许访问 $rule_resource ($resource_ip)"
                    fi
                else
                    echo "规则已存在，跳过添加：$chain_name -> $resource_ip"
                fi
            fi
        done

        # 添加默认 DROP 规则
        if ! iptables -C "$chain_name" -j DROP 2>/dev/null; then
            iptables -A "$chain_name" -j DROP
            if [[ $? -eq 0 ]]; then
                echo "在链 $chain_name 中添加默认 DROP 规则。"
            else
                echo "添加默认 DROP 规则失败：链 $chain_name"
            fi
        else
            echo "链 $chain_name 中已存在默认 DROP 规则，跳过。"
        fi

        # 将用户链链接到 FORWARD 链
        if ! iptables -C FORWARD -s "$user_ip"/32 -j "$chain_name" 2>/dev/null; then
            iptables -A FORWARD -s "$user_ip"/32 -j "$chain_name"
            if [[ $? -eq 0 ]]; then
                echo "在 FORWARD 链中添加跳转规则：$user_ip -> $chain_name"
            else
                echo "添加跳转规则失败：$user_ip -> $chain_name"
            fi
        else
            echo "FORWARD 链中已存在跳转规则：$user_ip -> $chain_name，跳过。"
        fi
    fi
done

# 保存 iptables 规则（可选，取决于系统）
# 例如，对于基于 Debian 的系统，可以使用：
# iptables-save > /etc/iptables/rules.v4

