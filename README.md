# IELTS Vocab

个人 IELTS / 考研词汇学习工具：本地词表 + AI 出题与评判，支持艾宾浩斯阶梯复习、近义/形近/固定搭配，以及多设备云端加密同步。

线上地址：https://winterdaphn.github.io/ielts-vocab/

---

## 功能概览

| 模块 | 说明 |
|------|------|
| **今日** | 到期复习、学习进度、连续打卡；按艾宾浩斯阶梯安排下次复习 |
| **词表** | 浏览/筛选单词；划掉、删除；进入词详情 |
| **词详情** | 音标（美/英）、释义、例句；助记笔记；近义词 / 形近词 / 固定搭配；上一个 · 下一个 · 划掉 · 删除 · 去学习 |
| **练习** | 选择题、完形填空、中译英等；AI 生成题干与评判；答对推进阶梯，答错回到 5 分钟 |
| **添加** | 手动加词；可走 LLM 补全释义、音标、例句等 |
| **设置** | OpenAI 兼容 API；导入内置雅思/考研词库或粘贴/文件；云同步推拉 |

### 学习增强

- **近义词**：词库内匹配 + AI 补全，可增删
- **形近词**：仅拼写形近（词库匹配），可删可手加（自动补释义）
- **固定搭配**：如 `feel elated` + 中文释义；词库预置 + 详情页手记；AI 补充不覆盖已有手记
- **助记**：可展开长文本编辑并保存

### 复习算法（艾宾浩斯阶梯）

固定间隔，答对升一档，答错重置到第一档：

```
5 分钟 → 30 分钟 → 12 小时 → 1 天 → 2 天 → 4 天 → 7 天 → 15 天 → 30 天
```

复习池只抽**已到期**的词。实现见 `src/utils/scheduler.ts`。

---

## 技术栈

| 层 | 选型 |
|----|------|
| UI | React 18、TypeScript、Ant Design 6、Sass |
| 构建 | Vite 8 |
| 路由 | React Router 6 |
| 状态 | Zustand（登录 / 设置持久化到 localStorage） |
| 词表存储 | Dexie（IndexedDB） |
| AI | OpenAI 兼容 HTTP（DeepSeek / Moonshot / 智谱等） |
| 同步 | CloudBase HTTP + 客户端 AES-GCM 加密 |

---

## 本地开发

```bash
npm install
npm run dev      # http://localhost:5173（仓库 base 为 /ielts-vocab/）
npm run build    # 产出 dist/
npm run preview  # 预览构建
npm run lint     # tsc --noEmit
```

路径别名：`@` → `src/`。

---

## 部署（GitHub Pages）

推送到 `main` 后，Actions 会 `npm run build` 并部署 `dist/`（[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)）。

**首次启用：**

1. 仓库 Settings → Pages → Source 选 **GitHub Actions**
2. 如有需要，在 Actions 权限中允许 workflow 运行

之后：

```bash
git push origin main
```

约 1–2 分钟后刷新线上地址即可。

---

## 项目结构

```
src/
├── api/                 # 网络、加密、LLM
│   ├── auth.ts          # 登录 / 注册、密码哈希
│   ├── cloud.ts         # CloudBase HTTP
│   ├── crypto.ts        # PBKDF2 + AES-GCM
│   └── llm.ts           # 出题、评判、近义/形近/搭配等生成与规范化
├── components/          # 共享 UI（布局、可标记例句、近义/形近/搭配列表等）
├── config/              # LLM 服务商预设等
├── db/                  # Dexie schema 与 CRUD
├── hooks/               # 练习会话等
├── json/
│   ├── ielts-vocab.json # 内置词库（释义、音标、近义/形近、搭配等）
│   └── collocations.json# 搭配中间数据（可合并进词库）
├── pages/               # 路由页面
├── store/               # Zustand：auth / settings / words
├── styles/              # 主题、全局样式、Antd 覆盖
├── types/               # Word、Settings 等
└── utils/
    ├── scheduler.ts     # 艾宾浩斯阶梯
    ├── practiceSelect.ts / practiceSession.ts
    ├── vocabBankRelated.ts  # 从词库取近义/形近
    ├── phonetic.ts / speak.ts / inflections.ts
    └── ...
```

`scripts/` 下可有词库增强脚本（如批量写搭配）；若在 `.gitignore` 中，仅本地使用。

---

## 数据模型（核心）

```ts
interface Word {
  id: string;
  word: string;
  translation: string;
  phoneticUs?: string;
  phoneticUk?: string;
  partOfSpeech?: string;
  mnemonic?: string;
  synonyms?: RelatedWord[];      // { word, gloss, note? }
  similars?: RelatedWord[];      // 仅拼写形近
  collocations?: Collocation[];  // { phrase, gloss }
  examples: WordExample[];
  crossedOut: boolean;
  // 复习字段
  ease: number;
  interval: number;
  streak: number;       // 阶梯档位相关
  nextReview: number;   // 下次复习时间戳
  totalReviews: number;
  correctReviews: number;
  createdAt: number;
}
```

练习用例句可带完形空、四选一选项与解析（由 LLM 填充并缓存到词上）。

---

## 内置词库

- 路径：`src/json/ielts-vocab.json`
- **设置 → 导入雅思词汇 / 导入考研词汇**：按标签批量导入本地词表
- 导入时会带上词库中的 `synonyms` / `similars` / `collocations`（若有）
- **已导入的旧词不会自动更新**词库新字段；需要重新导入跳过已有词，或自行做「从词库同步」类能力

近义/形近在运行时也可通过 `vocabBankRelated` 按当前词库补全；形近以词库为准，近义可与 AI 结果合并。

---

## 设置与 AI

1. 打开 **设置**，选择服务商预设或自定义 Base URL
2. 填入 **API Key**（仅存本机 / 加密同步，不经过本仓库服务端明文）
3. 练习与详情中的 AI 能力依赖该配置

支持任意 **OpenAI Chat Completions 兼容**接口。

---

## 安全与云同步

- **密码哈希**：`SHA-256("auth:{username}:{password}")` → 前 16 字节 → base64，提交服务端做鉴权
- **数据加密**：本地 `PBKDF2(password, salt=username, 120k)` → AES-GCM，加密词表与相关配置后再上传
- 服务端只存哈希与密文，无法直接读明文词表
- 换设备：同一用户名 + 密码 → 拉云端解密到本地 IndexedDB

云函数（独立部署，约 v2.4）常见接口：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/all` | 拉数据（`X-Profile`） |
| POST | `/api/all` | 推数据（`X-Profile`） |

设置页可配置同步 Endpoint / Token，并手动推送、拉取。

---

## 数据迁移（v5 → v6）

v6 用 IndexedDB（Dexie）替代 localStorage 存词表。

- 旧 key（如 `ielts-{username}-words`）不再使用
- `ielts-auth` / `ielts-settings` 会兼容读旧版用户名密码 key
- 首次打开 v6 建议登录后从云端拉取；若云端仍是 v5 格式，可能需要本机整理后再推一次

---

## 常见使用路径

1. 注册 / 登录 → 设置 API Key →（可选）导入雅思词库  
2. **今日** 看到期量 → **去学习** 或进练习  
3. 练习中做对做错会自动改写 `nextReview` / 阶梯  
4. 打开词详情补助记、近义、形近、搭配  
5. 换设备前在设置里 **推送到云端**，新设备登录后 **拉取**

---

## 已知限制

- 词库 JSON 更新后，**已在用户词表中的词**不会自动合并新搭配/近义；需重导或额外同步逻辑
- 形近词刻意排除纯音近、语义易混，只保留拼写形近
- GitHub Pages 为静态站，API Key 与词表敏感逻辑均在浏览器侧；请自行保管密码与 Key

---

## License

Private / 个人项目（以仓库设置为准）。
