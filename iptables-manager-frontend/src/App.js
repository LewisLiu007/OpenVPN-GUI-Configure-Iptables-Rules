// src/App.js
// 说明：
// 1. 从后端 /api/config 获取当前配置 (users, resources, allow_rules)。
// 2. 从后端 /api/ipp-users 获取 OpenVPN ipp.txt 用户列表 (username, user_ip)。
// 3. 用户管理：从下拉框中选择用户名，自动填充 IP，删除前检查是否有规则引用该用户。
// 4. 资源管理：手动输入资源名和IP，删除前检查是否有规则引用该资源。
// 5. 允许规则管理：可添加/删除规则。若已存在相同规则则避免重复添加。
// 6. 提交配置：POST 到 /api/update-config 并执行管理脚本。

import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Form, Button, Table, Card, Alert } from 'react-bootstrap';
import axios from 'axios';

function App() {
  // 1. 当前 config.txt 中的用户、资源、规则
  const [users, setUsers] = useState([]);
  const [resources, setResources] = useState([]);
  const [allowRules, setAllowRules] = useState([]);

  // 2. 用于添加新用户 / 新资源 / 新规则的临时输入
  const [newUser, setNewUser] = useState({ username: '', user_ip: '' });
  const [newResource, setNewResource] = useState({ resource_name: '', resource_ip: '' });
  const [newRule, setNewRule] = useState({ username: '', resource_name: '' });

  // 3. 提示信息
  const [message, setMessage] = useState({ type: '', text: '' });

  // 4. ippUsers：从后端 /api/ipp-users 获取的可选用户列表 (ipp.txt)
  const [ippUsers, setIppUsers] = useState([]);

  // ---------------------------
  //   一、加载现有配置 & IPP用户列表
  // ---------------------------
  useEffect(() => {
    // 加载当前 config.txt 配置
    axios.get('http://192.168.164.177:5000/api/config')
      .then(response => {
        const { users, resources, allow_rules } = response.data;
        setUsers(users);
        setResources(resources);
        setAllowRules(allow_rules);
      })
      .catch(error => {
        console.error('加载配置时出错:', error);
        setMessage({ type: 'danger', text: '加载配置时出错' });
      });

    // 加载 IPP 用户列表，用于下拉框
    axios.get('http://192.168.164.177:5000/api/ipp-users')
      .then(response => {
        setIppUsers(response.data); // [{username, user_ip}, ...]
      })
      .catch(error => {
        console.error('加载IPP用户列表时出错:', error);
        // 如需提示可在此设置
      });
  }, []);

  // ---------------------------
  //   二、添加/删除 用户（带删除限制）
  // ---------------------------
  const addUser = () => {
    if (!newUser.username.trim() || !newUser.user_ip.trim()) {
      setMessage({ type: 'danger', text: '请选择用户' });
      return;
    }
    // 检查是否在 users 中已存在
    const exists = users.some(u => u.username === newUser.username);
    if (exists) {
      setMessage({ type: 'warning', text: '该用户已存在' });
      return;
    }

    setUsers([...users, newUser]);
    setNewUser({ username: '', user_ip: '' });
    setMessage({ type: 'success', text: '用户已添加' });
  };

  const deleteUser = (index) => {
    // 检查该用户是否被允许规则所使用
    const userToDelete = users[index];
    const isUsedByRule = allowRules.some(rule => rule.username === userToDelete.username);
    if (isUsedByRule) {
      setMessage({ type: 'danger', text: '请先删除允许规则的配置再删除此用户' });
      return;
    }

    const updatedUsers = [...users];
    updatedUsers.splice(index, 1);
    setUsers(updatedUsers);
  };

  // ---------------------------
  //   三、添加/删除 资源（带删除限制）
  // ---------------------------
  const addResource = () => {
    if (!newResource.resource_name.trim() || !newResource.resource_ip.trim()) {
      setMessage({ type: 'danger', text: '请填写完整的资源信息' });
      return;
    }
    // 检查是否已存在同名资源
    const exists = resources.some(r => r.resource_name === newResource.resource_name);
    if (exists) {
      setMessage({ type: 'warning', text: '资源名已存在' });
      return;
    }

    setResources([...resources, newResource]);
    setNewResource({ resource_name: '', resource_ip: '' });
    setMessage({ type: 'success', text: '资源已添加' });
  };

  const deleteResource = (index) => {
    // 检查该资源是否被允许规则所使用
    const resourceToDelete = resources[index];
    const isUsedByRule = allowRules.some(rule => rule.resource_name === resourceToDelete.resource_name);
    if (isUsedByRule) {
      setMessage({ type: 'danger', text: '请先删除允许规则的配置再删除此资源' });
      return;
    }

    const updatedResources = [...resources];
    updatedResources.splice(index, 1);
    setResources(updatedResources);
  };

  // ---------------------------
  //   四、添加/删除 允许规则
  // ---------------------------
  const addRule = () => {
    if (!newRule.username.trim() || !newRule.resource_name.trim()) {
      setMessage({ type: 'danger', text: '请选择用户和资源' });
      return;
    }
    // 检查用户、资源是否存在
    const userExists = users.some(u => u.username === newRule.username);
    const resourceExists = resources.some(r => r.resource_name === newRule.resource_name);
    if (!userExists || !resourceExists) {
      setMessage({ type: 'danger', text: '指定的用户或资源不存在' });
      return;
    }
    // 检查规则是否重复
    const ruleExists = allowRules.some(rule =>
      rule.username === newRule.username && rule.resource_name === newRule.resource_name
    );
    if (ruleExists) {
      setMessage({ type: 'warning', text: '该规则已存在，无法重复添加' });
      return;
    }

    setAllowRules([...allowRules, newRule]);
    setNewRule({ username: '', resource_name: '' });
    setMessage({ type: 'success', text: '允许规则已添加' });
  };

  const deleteRule = (index) => {
    const updatedRules = [...allowRules];
    updatedRules.splice(index, 1);
    setAllowRules(updatedRules);
  };

  // ---------------------------
  //   五、提交配置
  // ---------------------------
  const submitConfig = () => {
    axios.post('http://192.168.164.177:5000/api/update-config', {
      users,
      resources,
      allow_rules: allowRules
    })
      .then(response => {
        if (response.data.success) {
          setMessage({ type: 'success', text: response.data.message });
        } else {
          setMessage({ type: 'danger', text: response.data.message });
        }
      })
      .catch(error => {
        console.error('提交配置时出错:', error);
        setMessage({ type: 'danger', text: '提交配置时出错' });
      });
  };

  // ---------------------------
  //   六、渲染UI
  // ---------------------------
  return (
    <Container className="mt-4">
      <h1 className="text-center mb-4">Yoocar优咔 VPN 权限控制配置管理</h1>

      {message.text && (
        <Alert
          variant={message.type}
          onClose={() => setMessage({ type: '', text: '' })}
          dismissible
        >
          {message.text}
        </Alert>
      )}

      <Row>
        {/* 1. 用户管理 */}
        <Col md={4}>
          <Card>
            <Card.Header>用户管理</Card.Header>
            <Card.Body>
              <Form>
                <Form.Group controlId="formSelectUsername" className="mb-2">
                  <Form.Label>选择用户名</Form.Label>
                  <Form.Control
                    as="select"
                    value={newUser.username}
                    onChange={(e) => {
                      const selectedUsername = e.target.value;
                      const found = ippUsers.find(u => u.username === selectedUsername);
                      const ip = found ? found.user_ip : '';
                      setNewUser({ username: selectedUsername, user_ip: ip });
                    }}
                  >
                    <option value="">请选择</option>
                    {ippUsers.map((item, idx) => (
                      <option key={idx} value={item.username}>
                        {item.username}
                      </option>
                    ))}
                  </Form.Control>
                </Form.Group>

                <Form.Group controlId="formUserIP" className="mb-2">
                  <Form.Label>用户IP</Form.Label>
                  <Form.Control
                    type="text"
                    placeholder="用户IP"
                    value={newUser.user_ip}
                    readOnly
                  />
                </Form.Group>

                <Button variant="primary" onClick={addUser}>添加用户</Button>
              </Form>

              <h5 className="mt-4">当前用户</h5>
              <Table striped bordered hover>
                <thead>
                  <tr>
                    <th>用户名</th>
                    <th>用户IP</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user, index) => (
                    <tr key={index}>
                      <td>{user.username}</td>
                      <td>{user.user_ip}</td>
                      <td>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => deleteUser(index)}
                        >
                          删除
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>

        {/* 2. 资源管理 */}
        <Col md={4}>
          <Card>
            <Card.Header>资源管理</Card.Header>
            <Card.Body>
              <Form>
                <Form.Group controlId="formResourceName" className="mb-2">
                  <Form.Label>资源名</Form.Label>
                  <Form.Control
                    type="text"
                    placeholder="输入资源名"
                    value={newResource.resource_name}
                    onChange={(e) => setNewResource({ ...newResource, resource_name: e.target.value })}
                  />
                </Form.Group>
                <Form.Group controlId="formResourceIP" className="mb-2">
                  <Form.Label>资源IP</Form.Label>
                  <Form.Control
                    type="text"
                    placeholder="输入资源IP（例如192.168.100.1）"
                    value={newResource.resource_ip}
                    onChange={(e) => setNewResource({ ...newResource, resource_ip: e.target.value })}
                  />
                </Form.Group>
                <Button variant="primary" onClick={addResource}>添加资源</Button>
              </Form>

              <h5 className="mt-4">当前资源</h5>
              <Table striped bordered hover>
                <thead>
                  <tr>
                    <th>资源名</th>
                    <th>资源IP</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {resources.map((resource, index) => (
                    <tr key={index}>
                      <td>{resource.resource_name}</td>
                      <td>{resource.resource_ip}</td>
                      <td>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => deleteResource(index)}
                        >
                          删除
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>

        {/* 3. 允许规则管理 */}
        <Col md={4}>
          <Card>
            <Card.Header>允许规则管理</Card.Header>
            <Card.Body>
              <Form>
                <Form.Group controlId="formRuleUsername" className="mb-2">
                  <Form.Label>用户名</Form.Label>
                  <Form.Control
                    as="select"
                    value={newRule.username}
                    onChange={(e) => setNewRule({ ...newRule, username: e.target.value })}
                  >
                    <option value="">选择用户</option>
                    {users.map((user, idx) => (
                      <option key={idx} value={user.username}>
                        {user.username}
                      </option>
                    ))}
                  </Form.Control>
                </Form.Group>
                <Form.Group controlId="formRuleResource" className="mb-2">
                  <Form.Label>资源名</Form.Label>
                  <Form.Control
                    as="select"
                    value={newRule.resource_name}
                    onChange={(e) => setNewRule({ ...newRule, resource_name: e.target.value })}
                  >
                    <option value="">选择资源</option>
                    {resources.map((resource, idx) => (
                      <option key={idx} value={resource.resource_name}>
                        {resource.resource_name}
                      </option>
                    ))}
                  </Form.Control>
                </Form.Group>
                <Button variant="primary" onClick={addRule}>添加允许规则</Button>
              </Form>

              <h5 className="mt-4">当前允许规则</h5>
              <Table striped bordered hover>
                <thead>
                  <tr>
                    <th>用户名</th>
                    <th>资源名</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {allowRules.map((rule, index) => (
                    <tr key={index}>
                      <td>{rule.username}</td>
                      <td>{rule.resource_name}</td>
                      <td>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => deleteRule(index)}
                        >
                          删除
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="mt-4">
        <Col>
          <Button variant="success" onClick={submitConfig}>
            提交配置并应用
          </Button>
        </Col>
      </Row>
    </Container>
  );
}

export default App;

