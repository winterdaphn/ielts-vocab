# IELTS 词汇训练 (React + Vite + Antd)

个人 IELTS 词汇学习工具，AI 驱动的智能出题和评判，支持多设备云端加密同步。

## 技术栈

- **React 18** + **TypeScript** + **Vite 5**
- **Antd v5** 组件库
- **Zustand** 状态管理（持久化到 localStorage）
- **Dexie** 包装 IndexedDB（单词存储）
- **React Router v6** 路由
- **CloudBase Functions** 云同步后端

## 项目结构

```
src/
├── api/           # 网络 & 加密
│   ├── auth.ts        登录/注册 + 密码哈希
│   ├── cloud.ts       CloudBase HTTP 调用
│   ├── crypto.ts      PBKDF2 + AES-GCM 加密
│   └── llm.ts         OpenAI 兼容 LLM 调用
├── components/    # 共享 UI 组件
│   └── MainLayout.tsx 底部导航 + 布局
├── config/        # 配置常量
│   └── providers.ts   LLM 服务商预设
├── db/            # 本地持久化
│   └── ieltsDb.ts     Dexie schema + CRUD
├── pages/         # 路由页面
│   ├── LoginPage.tsx
│   ├── TodayPage.tsx
│   ├── WordsPage.tsx
│   ├── AddPage.tsx
│   ├── SettingsPage.tsx
│   └── PracticePage.tsx
├── store/         # Zustand 状态
│   ├── useAuth.ts      登录态（用户名+密码）
│   ├── useSettings.ts  AI 配置 + 同步配置
│   └── useWords.ts     词表（带 userId 隔离）
├── styles/        # 主题与全局样式
│   ├── theme.ts        Antd 主题配置
│   ├── theme-var.css   CSS 变量
│   └── global.css      全局样式
├── types/         # TypeScript 类型
│   ├── word.ts
│   ├── settings.ts
│   └── user.ts
├── utils/         # 工具函数
│   ├── date.ts         localStorage helpers
│   ├── inflections.ts  词形变化
│   └── scheduler.ts    SM-2 间隔重复
├── App.tsx        # 路由根
└── main.tsx       # 入口
```

## 本地开发

```bash
npm install
npm run dev          # 启动 dev server (http://localhost:5173)
npm run build        # 产出 dist/
npm run preview      # 预览构建结果
npm run lint         # tsc --noEmit 类型检查
```

## 部署（GitHub Pages + Actions）

线上地址：https://winterdaphn.github.io/ielts-vocab/

推送到 `main` 后，GitHub Actions 会自动 `npm run build` 并部署 `dist/`（见 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)）。

**首次启用（只需做一次）：**

1. 打开仓库 [Settings → Pages](https://github.com/winterdaphn/ielts-vocab/settings/pages)
2. **Build and deployment → Source** 选 **GitHub Actions**（不要选 Deploy from a branch）
3. 若 workflow 被拦，到 Settings → Actions → General 允许运行

之后：

```bash
git push origin main
```

到仓库 **Actions** 页看构建是否成功；约 1–2 分钟后刷新线上地址即可。也可在 Actions 里手动跑 **Deploy to GitHub Pages**。

## 安全模型

- **密码哈希**：`SHA-256("auth:{username}:{password}")` → 前 16 字节 → base64，存到服务端
- **数据加密**：本地 `PBKDF2(password, salt=username, 120k iter)` → 256-bit AES-GCM key → 加密 words + streak
- **服务端只看哈希**，永远拿不到明文密码，也解不了你的词表
- 换设备用同一用户名+密码 → 同一份数据

## 数据迁移（v5.x → v6）

v6 用 IndexedDB（Dexie）替代旧的 localStorage 词表存储。
- v5 的 `ielts-{username}-words` 等 key 不再使用
- v6 的 `ielts-auth` / `ielts-settings` 会读旧版的 `ielts-auth-username` / `ielts-auth-password`
- 第一次打开 v6 后，登录会从云端拉取加密数据
- 老的云端数据如果用了 v5 格式，可能需要重新推送一次

## 云函数

`cloudbase-vocab-api/index.js` (v2.4)，独立仓库/函数。

Endpoints：
- `POST /api/auth/register` - 注册
- `POST /api/auth/login` - 登录
- `GET /api/all` - 拉数据 (X-Profile header)
- `POST /api/all` - 推数据 (X-Profile header)
