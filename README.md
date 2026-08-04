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

复习池只抽**已到期**的词。实现见 `apps/web/src/utils/scheduler.ts`。

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
| 后端 | Node.js 22、**Fastify**、PostgreSQL 16、JWT |
| 同步 | 关系表按词增量同步（改笔记/近义自动推）+ Dexie 本地优先 |
| 编排 | Docker Compose（nginx / api / db） |

---

## 本地开发（monorepo）

```bash
# 前端
cd apps/web && npm install
npm run dev:web    # 根目录也可；http://localhost:5173，/api 代理到 :3000

# 后端（需 Postgres，或 docker compose up db -d）
cd apps/api && npm install && cp .env.example .env
# 编辑 .env 里的 DATABASE_URL / JWT_SECRET
npm run dev:api    # http://localhost:3000
```

路径别名：`@` → `apps/web/src/`。

---

## 部署（GitHub Pages）

推送到 `main` 后，Actions 在 `apps/web` 下 build 并部署（[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)）。

自建服务器部署见根目录 `docker-compose.yml`（nginx + Fastify api + Postgres）。

---

## 项目结构

```
apps/
├── web/                 # React 前端
│   └── src/
│       ├── api/         # auth / cloud sync / crypto / llm / youdao
│       ├── components/
│       ├── db/
│       ├── pages/
│       ├── store/
│       └── ...
└── api/                 # Fastify 后端（server.js）
docker-compose.yml
nginx/default.conf
```

`apps/web/scripts/` 下可有词库增强脚本（若在 `.gitignore` 中，仅本地使用）。

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

- 路径：`apps/web/src/json/vocab/`（雅思 / 考研）
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

自建 Fastify API 常见接口：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册 → JWT |
| POST | `/api/auth/login` | 登录 → JWT |
| GET | `/api/words?since=` | 增量拉词 |
| PUT/PATCH/DELETE | `/api/words/:id` | 单词 upsert / 进度 / 删除 |
| POST | `/api/words/batch` | 批量导入 |
| GET/PUT | `/api/me/prefs` | 分类 / 练习 / 打卡 |
| GET | `/api/youdao?q=` | 有道词典代理 |

设置页可配置 API Base，并支持 **从 CloudBase 一键导入**。

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
