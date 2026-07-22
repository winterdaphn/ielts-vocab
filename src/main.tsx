import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'dayjs/locale/zh-cn';
import App from './App';
import { ieltsTheme } from './styles/theme';
import './styles/global.css';
import './styles/antd-overrides.scss';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        ...ieltsTheme,
        // Stable class names + CSS variables → SCSS overrides work reliably
        cssVar: {},
        hashed: false,
      }}
      locale={zhCN}
    >
      <AntdApp>
        <BrowserRouter basename="/ielts-vocab">
          <App />
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>
);
