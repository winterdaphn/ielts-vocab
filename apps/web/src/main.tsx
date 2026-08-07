import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'dayjs/locale/zh-cn';
import App from './App';
import { ieltsTheme } from './styles/theme';
import './styles/global.css';
import './styles/antd-overrides.scss';

/** GitHub Pages + 部分手机浏览器（如夸克）刷新深链会丢 path；Hash 路由只请求 index.html */
const useHashRouter = import.meta.env.VITE_HASH_ROUTER === 'true';
const Router = useHashRouter ? HashRouter : BrowserRouter;
const routerBasename = useHashRouter
  ? undefined
  : import.meta.env.BASE_URL.replace(/\/$/, '') || undefined;

ReactDOM.createRoot(document.getElementById('root')!).render(
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
      <Router basename={routerBasename}>
        <App />
      </Router>
    </AntdApp>
  </ConfigProvider>
);
