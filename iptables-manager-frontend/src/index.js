// src/index.js
import 'bootstrap/dist/css/bootstrap.min.css';
import React from 'react';
import ReactDOM from 'react-dom/client';  // 注意这里
import App from './App';
// 如果你需要全局样式或者CSS文件，也在这里引入

const rootElement = document.getElementById('root');
// 通过 createRoot 创建 root
const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

