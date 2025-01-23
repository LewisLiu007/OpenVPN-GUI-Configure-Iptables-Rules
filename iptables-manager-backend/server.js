// server.js
// 后端服务器：使用Express处理API请求，生成config.txt并执行manage_iptables.sh脚本。

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

// API端点：接收配置数据，生成config.txt并执行脚本
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

    // 写入config.txt文件
    const configPath = path.join(__dirname, 'config.txt');
    fs.writeFile(configPath, configContent, (err) => {
        if (err) {
            console.error('写入config.txt失败：', err);
            return res.status(500).json({ success: false, message: '写入配置文件失败。' });
        }

        console.log('config.txt已成功更新。');

        // 执行manage_iptables.sh脚本
        // 确保脚本有执行权限：chmod +x manage_iptables.sh
        exec(`sudo ./manage_iptables.sh add`, { cwd: __dirname }, (error, stdout, stderr) => {
            if (error) {
                console.error(`执行脚本出错: ${error.message}`);
                return res.status(500).json({ success: false, message: '执行脚本失败。', error: error.message });
            }
            if (stderr) {
                console.error(`脚本stderr: ${stderr}`);
                // 根据需要，可以选择将stderr视为错误或警告
            }

            console.log(`脚本输出: ${stdout}`);
            return res.json({ success: true, message: '配置已更新并执行脚本。', output: stdout });
        });
    });
});

// 添加一个新路由用于返回当前配置
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

// 用于解析配置文件的函数
const parseConfig = (data) => {
    const users = [];
    const resources = [];
    const allowRules = [];
    
    const lines = data.split('\n');
    let section = '';
    
    lines.forEach(line => {
        line = line.trim();
        
        if (line.startsWith('[users]')) {
            section = 'users';
        } else if (line.startsWith('[resources]')) {
            section = 'resources';
        } else if (line.startsWith('[allow_rules]')) {
            section = 'allow_rules';
        } else if (line) {
            const parts = line.split(',');
            if (section === 'users') {
                users.push({ username: parts[0], user_ip: parts[1] });
            } else if (section === 'resources') {
                resources.push({ resource_name: parts[0], resource_ip: parts[1] });
            } else if (section === 'allow_rules') {
                allowRules.push({ username: parts[0], resource_name: parts[1] });
            }
        }
    });
    
    return { users, resources, allow_rules: allowRules };
};


// 启动服务器
app.listen(PORT, () => {
    console.log(`后端服务器正在运行在端口 ${PORT}`);
});

