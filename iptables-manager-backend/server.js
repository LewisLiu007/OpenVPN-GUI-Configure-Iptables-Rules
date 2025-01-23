// server.js
// 后端服务器：使用Express处理API请求，生成config.txt并执行manage_iptables.sh脚本。
// 新增: 读取 /etc/openvpn/server/yoocar.conf 中的 ifconfig-pool-persist 参数定位 ipp.txt 文件，
//       并提供 /api/ipp-users 接口返回所有 (username, user_ip) 列表给前端使用。

const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const { exec } = require('child_process');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 5000; // 后端服务器监听端口

app.use(bodyParser.json());
app.use(cors()); // 允许跨域请求（根据需要进行配置）

// 配置文件位置：根据实际情况调整
const YOOCAR_CONF_PATH = '/etc/openvpn/server/yoocar.conf';

// ======================================================================
// 1. 获取 ipp.txt 的路径
//    读取 yoocar.conf 中的 ifconfig-pool-persist 参数，拼接成绝对路径
// ======================================================================
function getIppFilePath() {
    // 假设 yoocar.conf 内容中会有一行类似：ifconfig-pool-persist ipp.txt
    // 或 ifconfig-pool-persist /etc/openvpn/server/ipp.txt

    // 先读取整个 yoocar.conf
    let confContent;
    try {
        confContent = fs.readFileSync(YOOCAR_CONF_PATH, 'utf8');
    } catch (err) {
        console.error(`读取 yoocar.conf 失败: ${err.message}`);
        return null; // 后续调用者要根据此结果进行判断
    }

    // 在 conf 中找到 ifconfig-pool-persist 所在行
    const lines = confContent.split('\n');
    let relativeOrAbsolute = '';
    let confDir = path.dirname(YOOCAR_CONF_PATH);  // yoocar.conf 的所在目录

    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('ifconfig-pool-persist ')) {
            // 拿到后面的值
            // e.g. "ifconfig-pool-persist ipp.txt" => ["ifconfig-pool-persist", "ipp.txt"]
            let parts = line.split(/\s+/);  
            // parts[0] = "ifconfig-pool-persist", parts[1] = "ipp.txt" or "/etc/openvpn/server/ipp.txt"
            if (parts.length >= 2) {
                relativeOrAbsolute = parts[1];
            }
            break; // 找到就跳出
        }
    }

    if (!relativeOrAbsolute) {
        console.warn("未在 yoocar.conf 中找到 ifconfig-pool-persist 配置。");
        return null;
    }

    // 检查 relativeOrAbsolute 是否是绝对路径
    if (relativeOrAbsolute.startsWith('/')) {
        return relativeOrAbsolute; // 已经是绝对路径
    } else {
        // 否则与 yoocar.conf 同目录拼接
        return path.join(confDir, relativeOrAbsolute);
    }
}

// ======================================================================
// 2. 解析 ipp.txt 文件
//    文件格式: 每行 "username,ip" 或者更复杂
// ======================================================================
function parseIppFile(ippFilePath) {
    try {
        const data = fs.readFileSync(ippFilePath, 'utf8');
        const lines = data.split('\n');
        const result = [];
        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith('#')) {
                continue; // 跳过空行/注释
            }
            // 假设每行是 "username,ip"
            const parts = line.split(',');
            if (parts.length >= 2) {
                const username = parts[0].trim();
                const user_ip = parts[1].trim();
                result.push({ username, user_ip });
            }
        }
        return result;
    } catch (err) {
        console.error(`读取 ipp.txt 失败: ${err.message}`);
        return [];
    }
}

// ======================================================================
// 3. 新增 API: GET /api/ipp-users
//    返回从 ipp.txt 读取到的 { username, user_ip } 列表
// ======================================================================
app.get('/api/ipp-users', (req, res) => {
    const ippFilePath = getIppFilePath();
    if (!ippFilePath) {
        // 未找到 ifconfig-pool-persist 或读取失败
        return res.status(500).json({
            success: false,
            message: '无法确定 ipp.txt 文件路径，请检查 yoocar.conf'
        });
    }

    const ippUsers = parseIppFile(ippFilePath);
    // 读取成功, 返回 JSON
    return res.json(ippUsers);
});

// ======================================================================
// 4. 接收配置数据，生成 config.txt 并执行脚本
//    POST /api/update-config
// ======================================================================
app.post('/api/update-config', (req, res) => {
    const { users, resources, allow_rules } = req.body;

    // 构建config.txt内容
    let configContent = '';

    // [users]部分
    configContent += '[users]\n';
    users.forEach(user => {
        configContent += `${user.username},${user.user_ip}\n`;
    });
    configContent += '\n';

    // [resources]部分
    configContent += '[resources]\n';
    resources.forEach(resource => {
        configContent += `${resource.resource_name},${resource.resource_ip}\n`;
    });
    configContent += '\n';

    // [allow_rules]部分
    configContent += '[allow_rules]\n';
    allow_rules.forEach(rule => {
        configContent += `${rule.username},${rule.resource_name}\n`;
    });

    // 写入 config.txt 文件
    const configPath = path.join(__dirname, 'config.txt');
    fs.writeFile(configPath, configContent, (err) => {
        if (err) {
            console.error('写入config.txt失败：', err);
            return res.status(500).json({ success: false, message: '写入配置文件失败。' });
        }

        console.log('config.txt已成功更新。');

        // 执行 manage_iptables.sh 脚本
        // 确保脚本有执行权限：chmod +x manage_iptables.sh
        exec(`sudo ./manage_iptables.sh add`, { cwd: __dirname }, (error, stdout, stderr) => {
            if (error) {
                console.error(`执行脚本出错: ${error.message}`);
                return res.status(500).json({ success: false, message: '执行脚本失败。', error: error.message });
            }
            if (stderr) {
                console.error(`脚本stderr: ${stderr}`);
                // 根据需要，可以选择将stderr视为错误或仅作警告
            }

            console.log(`脚本输出: ${stdout}`);
            return res.json({ success: true, message: '配置已更新并执行脚本。', output: stdout });
        });
    });
});

// ======================================================================
// 5. 返回当前 config.txt 配置
//    GET /api/config
// ======================================================================
app.get('/api/config', (req, res) => {
    const configPath = path.join(__dirname, 'config.txt');
    
    fs.readFile(configPath, 'utf8', (err, data) => {
        if (err) {
            console.error('读取配置文件失败：', err);
            return res.status(500).json({ success: false, message: '读取配置文件失败' });
        }
        
        const config = parseConfig(data);
        return res.json(config);
    });
});

// ======================================================================
// 6. 解析 config.txt 的函数
// ======================================================================
function parseConfig(data) {
    const users = [];
    const resources = [];
    const allowRules = [];
    
    const lines = data.split('\n');
    let section = '';
    
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        if (line.startsWith('[users]')) {
            section = 'users';
            continue;
        } 
        if (line.startsWith('[resources]')) {
            section = 'resources';
            continue;
        }
        if (line.startsWith('[allow_rules]')) {
            section = 'allow_rules';
            continue;
        }

        // 正常配置行
        const parts = line.split(',');
        if (section === 'users' && parts.length >= 2) {
            users.push({ username: parts[0], user_ip: parts[1] });
        } else if (section === 'resources' && parts.length >= 2) {
            resources.push({ resource_name: parts[0], resource_ip: parts[1] });
        } else if (section === 'allow_rules' && parts.length >= 2) {
            allowRules.push({ username: parts[0], resource_name: parts[1] });
        }
    }
    
    return { users, resources, allow_rules: allowRules };
}

// ======================================================================
// 7. 启动服务器
// ======================================================================
app.listen(PORT, () => {
    console.log(`后端服务器正在运行在端口 ${PORT}`);
});
