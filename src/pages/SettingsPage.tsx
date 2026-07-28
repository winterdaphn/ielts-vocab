import { useState, useRef } from 'react';
import { Form, Input, Button, Card, App, Popconfirm, Alert, Space, Divider, Tag } from 'antd';
import {
  CloudUploadOutlined,
  CloudDownloadOutlined,
  ExportOutlined,
  ImportOutlined,
  DeleteOutlined,
  LogoutOutlined,
  KeyOutlined,
  ApiOutlined,
  UserOutlined,
  DatabaseOutlined,
  RobotOutlined,
  BookOutlined,
} from '@ant-design/icons';
import { useSettings } from '@/store/useSettings';
import { useAuth } from '@/store/useAuth';
import { useWordsStore, useUserWords } from '@/store/useWords';
import { PROVIDERS } from '@/config/providers';
import { testConnection } from '@/api/llm';
import { pullFromCloud, pushToCloud } from '@/api/sync';
import { clearCryptoCache } from '@/api/crypto';
import { dbClearForUser } from '@/db/ieltsDb';
import { makeNewWord } from '@/store/useWords';
import type { Word } from '@/types/word';
import { useNavigate } from 'react-router-dom';
import { modeLabel, parsePracticeMode } from '@/utils/practiceSession';
import ieltsVocabBank from '@/json/ielts-vocab.json';

type Tab = 'ai' | 'data' | 'account';

interface VocabBankEntry {
  word: string;
  phonetic?: string;
  phoneticUk?: string;
  phoneticUs?: string;
  pos?: string;
  translation?: string;
  source?: string;
  synonyms?: { word: string; gloss: string; note: string }[];
  similars?: { word: string; gloss: string; note: string }[];
  collocations?: { phrase: string; gloss: string }[];
}

function modeLabelSafe(mode: unknown): string {
  return modeLabel(parsePracticeMode(typeof mode === 'string' ? mode : undefined));
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('ai');
  return (
    <div>
      <div className="app-header">
        <h1>设置</h1>
        <p>选择标签查看不同设置</p>
      </div>

      <div className="settings-tabs">
        <button className={`settings-tab ${tab === 'ai' ? 'active' : ''}`} onClick={() => setTab('ai')}>
          <RobotOutlined /> AI
        </button>
        <button className={`settings-tab ${tab === 'data' ? 'active' : ''}`} onClick={() => setTab('data')}>
          <DatabaseOutlined /> 数据
        </button>
        <button className={`settings-tab ${tab === 'account' ? 'active' : ''}`} onClick={() => setTab('account')}>
          <UserOutlined /> 账户
        </button>
      </div>

      {tab === 'ai' && <AISettings />}
      {tab === 'data' && <DataSettings />}
      {tab === 'account' && <AccountSettings />}
    </div>
  );
}

// ============= AI tab =============
function AISettings() {
  const { message } = App.useApp();
  const settings = useSettings();
  const update = useSettings((s) => s.update);
  const setProvider = useSettings((s) => s.setProvider);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const reply = await testConnection(settings);
      if (reply.toLowerCase().includes('ok')) {
        setTestResult({ ok: true, msg: '✓ 连接成功' });
        message.success('连接成功');
      } else {
        setTestResult({ ok: false, msg: `⚠ 返回异常：${reply.slice(0, 50)}` });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: '✗ ' + (e instanceof Error ? e.message : '失败') });
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <Card title="AI 服务商" style={{ marginBottom: 12 }}>
        <div className="provider-presets">
          {Object.entries(PROVIDERS).map(([key, p]) => (
            <button
              key={key}
              className={`provider-preset ${settings.provider === key ? 'active' : ''}`}
              onClick={() => setProvider(key as any)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </Card>

      <Card title="API 配置">
        <Form layout="vertical">
          <Form.Item
            label={<Space><KeyOutlined />API Key</Space>}
            extra={<span style={{ fontSize: 12, color: 'var(--text-light)' }}>保存在你浏览器本地，不会上传</span>}
          >
            <Input.Password
              value={settings.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
              placeholder="sk-..."
            />
          </Form.Item>
          <Form.Item label="API Base URL">
            <Input
              value={settings.apiBase}
              onChange={(e) => update({ apiBase: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </Form.Item>
          <Form.Item label="模型">
            <Input
              value={settings.model}
              onChange={(e) => update({ model: e.target.value })}
              placeholder="gpt-4o-mini"
            />
          </Form.Item>
          <Button type="primary" block onClick={handleTest} loading={testing} icon={<ApiOutlined />}>
            测试连接
          </Button>
          {testResult && (
            <div
              style={{
                marginTop: 12,
                fontSize: 13,
                color: testResult.ok ? 'var(--success)' : 'var(--error)',
              }}
            >
              {testResult.msg}
            </div>
          )}
        </Form>
      </Card>
    </>
  );
}

// ============= Data tab =============
function DataSettings() {
  const { message, modal } = App.useApp();
  const settings = useSettings();
  const update = useSettings((s) => s.update);
  const username = useAuth((s) => s.username);
  const password = useAuth((s) => s.password);
  const words = useUserWords();
  const setWords = useWordsStore((s) => s.setWords);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pasteText, setPasteText] = useState('');
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [importingSource, setImportingSource] = useState<'ielts' | 'kaoyan' | null>(null);

  async function handleExport() {
    const data = { version: 1, exportedAt: new Date().toISOString(), words };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ielts-vocab-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('已导出');
  }

  async function importFromText(text: string) {
    const data = JSON.parse(text);
    if (!data.words || !Array.isArray(data.words)) throw new Error('格式不对，找不到 words');
    if (data.words.length === 0) {
      message.info('文件里没有单词');
      return;
    }
    let added = 0, skipped = 0;
    const { addWord } = useWordsStore.getState();
    for (const w of data.words) {
      if (!w.word) { skipped++; continue; }
      const exists = words.find((x) => x.word === w.word);
      if (exists) { skipped++; continue; }
      await addWord(makeNewWord(w));
      added++;
    }
    message.success(`已导入 ${added} 个单词${skipped ? `（${skipped} 个跳过）` : ''}`);
  }

  async function handleImportBankVocab(source: 'ielts' | 'kaoyan') {
    const label = source === 'ielts' ? '雅思' : '考研';
    const bank = ieltsVocabBank as VocabBankEntry[];
    const entries = bank.filter((w) => w.source === source && w.word);
    const existing = new Set(words.map((w) => w.word.toLowerCase()));
    const toAdd: Word[] = [];
    let skipped = 0;

    for (const entry of entries) {
      if (existing.has(entry.word.toLowerCase())) {
        skipped++;
        continue;
      }
      toAdd.push(
        makeNewWord({
          word: entry.word,
          translation: entry.translation || '',
          phonetic: entry.phonetic || entry.phoneticUk || entry.phoneticUs || '',
          phoneticUk: entry.phoneticUk || '',
          phoneticUs: entry.phoneticUs || '',
          partOfSpeech: entry.pos || '',
          synonyms: entry.synonyms || [],
          similars: entry.similars || [],
          collocations: entry.collocations || [],
        })
      );
      existing.add(entry.word.toLowerCase());
    }

    if (toAdd.length === 0) {
      message.info(`${label}词库里没有新词可导入（已跳过 ${skipped} 个）`);
      return;
    }

    const confirmed = await new Promise<boolean>((resolve) => {
      modal.confirm({
        title: `导入${label}词汇？`,
        content: `将从内置词库导入 ${toAdd.length} 个${label}单词${
          skipped ? `（已有 ${skipped} 个会跳过）` : ''
        }。不会覆盖你现有的词。`,
        okText: '导入',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!confirmed) return;

    setImportingSource(source);
    try {
      await useWordsStore.getState().addWords(toAdd);
      message.success(`已导入 ${toAdd.length} 个${label}单词${skipped ? `（跳过 ${skipped} 个）` : ''}`);
    } catch (e) {
      message.error('导入失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setImportingSource(null);
    }
  }

  async function handlePush() {
    if (!settings.workerUrl) return message.error('请先填 Worker URL');
    if (!password) return message.error('请先登录');
    setPushing(true);
    try {
      const payload = await pushToCloud(words, settings, username, password);
      const practice = payload.state?.practice as
        | { idx?: number; wordIds?: string[]; mode?: string }
        | null
        | undefined;
      const bits = [`已推送 ${payload.words.length} 个单词`];
      if (practice && Array.isArray(practice.wordIds) && practice.wordIds.length) {
        bits.push(
          `练习进度 ${modeLabelSafe(practice.mode)} ${(practice.idx ?? 0) + 1}/${practice.wordIds.length}`
        );
      } else {
        bits.push('无未完成练习');
      }
      if (payload.encrypted) bits.push('配置已加密');
      message.success(bits.join(' · '));
    } catch (e) {
      message.error('推送失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setPushing(false);
    }
  }

  async function handlePull() {
    if (!settings.workerUrl) return message.error('请先填 Worker URL');
    if (!password) return message.error('请先登录');
    setPulling(true);
    try {
      const result = await pullFromCloud(settings, username, password);
      if (!result.replaced && result.added === 0 && !result.practiceRestored) {
        message.info('云端没有可同步的数据');
        return;
      }
      const bits = [`已拉取 ${result.added} 个单词`];
      if (result.practiceRestored) bits.push('练习进度已恢复');
      message.success(bits.join(' · '));
      if (result.needsPassword) {
        message.warning('词表已同步，但加密配置解密失败（密码可能不一致）');
      }
    } catch (e) {
      message.error('拉取失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setPulling(false);
    }
  }

  return (
    <>
      <Card title="本地数据" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Button icon={<ExportOutlined />} onClick={handleExport}>导出</Button>
          <Button icon={<ImportOutlined />} onClick={() => fileInputRef.current?.click()}>
            选择文件导入
          </Button>
          <Button
            type="primary"
            icon={<BookOutlined />}
            loading={importingSource === 'ielts'}
            disabled={importingSource !== null}
            onClick={() => handleImportBankVocab('ielts')}
          >
            导入雅思词汇
          </Button>
          <Button
            icon={<BookOutlined />}
            loading={importingSource === 'kaoyan'}
            disabled={importingSource !== null}
            onClick={() => handleImportBankVocab('kaoyan')}
          >
            导入考研词汇
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                await importFromText(await file.text());
              } catch (err) {
                message.error('导入失败：' + (err instanceof Error ? err.message : '未知错误'));
              }
              e.target.value = '';
            }}
          />
          <Popconfirm
            title="确定清空所有单词？"
            description="此操作不可恢复！"
            onConfirm={async () => {
              await dbClearForUser(username);
              setWords([]);
              message.success('已清空');
            }}
            okText="确定"
            cancelText="取消"
          >
            <Button danger icon={<DeleteOutlined />}>清空词表</Button>
          </Popconfirm>
        </Space>
        <Divider />
        <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 4 }}>或者直接粘贴 JSON：</div>
        <Input.TextArea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="把 JSON 内容粘贴到这里..."
          autoSize={{ minRows: 4, maxRows: 8 }}
          style={{ fontFamily: 'SF Mono, Consolas, monospace', fontSize: 12 }}
        />
        <Button
          type="primary"
          size="small"
          onClick={async () => {
            if (!pasteText.trim()) return message.warning('粘贴框是空的');
            try {
              await importFromText(pasteText);
              setPasteText('');
            } catch (err) {
              message.error('导入失败：' + (err instanceof Error ? err.message : '未知错误'));
            }
          }}
          style={{ marginTop: 8 }}
        >
          从粘贴内容导入
        </Button>
        <p style={{ color: 'var(--text-mute)', fontSize: 12, marginTop: 8 }}>
          数据存储在浏览器 IndexedDB，清缓存会丢失
        </p>
      </Card>

      <Card title="☁️ 云同步">
        <Form layout="vertical">
          <Form.Item label="Worker URL">
            <Input
              value={settings.workerUrl}
              onChange={(e) => update({ workerUrl: e.target.value })}
              placeholder="https://ielts-vocab-d5gu0dfe9e1a9b5e9-1257115199.ap-shanghai.app.tcloudbase.com/vocab-api"
            />
          </Form.Item>
          <Form.Item
            label="同步 Token（可选）"
            extra={<span style={{ fontSize: 12, color: 'var(--text-light)' }}>如果 Worker 设置了 AUTH_TOKEN 就填</span>}
          >
            <Input.Password
              value={settings.syncToken}
              onChange={(e) => update({ syncToken: e.target.value })}
              placeholder="可选"
            />
          </Form.Item>
          <Form.Item>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.autoSync}
                onChange={(e) => update({ autoSync: e.target.checked })}
              />
              <span>词表增减时自动推送</span>
            </label>
          </Form.Item>
          <Space.Compact block>
            <Button type="primary" loading={pushing} onClick={handlePush} icon={<CloudUploadOutlined />} style={{ flex: 1 }}>
              推送到云端
            </Button>
            <Button loading={pulling} onClick={handlePull} icon={<CloudDownloadOutlined />} style={{ flex: 1 }}>
              从云端拉取
            </Button>
          </Space.Compact>
          <p style={{ color: 'var(--text-mute)', fontSize: 12, marginTop: 12 }}>
            {settings.lastSyncAt
              ? `上次同步：${new Date(settings.lastSyncAt).toLocaleString('zh-CN')}`
              : '尚未同步'}
            <br />
            手动推送会上传：词表与复习进度、连续学习天数、今日完成标记、未完成练习（题号/模式，不含已填答案）。换电脑拉取后可继续上次练习，题目现出。
          </p>
        </Form>
      </Card>
    </>
  );
}

// ============= Account tab =============
function AccountSettings() {
  const { message, modal } = App.useApp();
  const username = useAuth((s) => s.username);
  const clearAuth = useAuth((s) => s.clear);
  const setWords = useWordsStore((s) => s.setWords);
  const navigate = useNavigate();

  async function handleLogout() {
    const confirmed = await new Promise<boolean>((resolve) => {
      modal.confirm({
        title: '退出登录？',
        content: '退出后会清除本地数据。如需重新登录，输入同样的用户名和密码即可。',
        okText: '退出',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!confirmed) return;
    await dbClearForUser(username);
    setWords([]);
    clearCryptoCache();
    clearAuth();
    message.success('已退出登录');
    navigate('/login');
  }

  return (
    <>
      <Card title="已登录账号" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent)' }}>
              👤 {username || '未登录'}
            </div>
            <div style={{ color: 'var(--text-light)', fontSize: 12 }}>数据已加密同步到云端</div>
          </div>
          <Button danger icon={<LogoutOutlined />} onClick={handleLogout}>退出登录</Button>
        </div>
      </Card>

      <Card title="账号信息">
        <p style={{ color: 'var(--text-light)', fontSize: 13, lineHeight: 1.7 }}>
          • 同一个用户名 + 密码在不同设备都能解密同一份云端数据<br />
          • 忘了密码？只能重置账号（云端数据会丢失，需要重新创建）
        </p>
      </Card>

      <Card title="关于" style={{ marginTop: 12 }}>
        <p style={{ color: 'var(--text-light)', fontSize: 13, lineHeight: 1.7 }}>
          这是一个个人 IELTS 词汇学习工具，AI 驱动的智能出题和评判。
          <br /><br />
          <b>支持的服务：</b>OpenAI / DeepSeek / Moonshot / 智谱 GLM / 任何 OpenAI 兼容 API
          <br /><br />
          <b>推荐：</b>用 DeepSeek 或 GLM-4-Flash 这种便宜的模型，性价比高
        </p>
        <div style={{ marginTop: 8 }}>
          <Tag color="green">React 18</Tag>
          <Tag color="blue">Vite</Tag>
          <Tag color="purple">Antd v5</Tag>
          <Tag color="cyan">Dexie</Tag>
        </div>
      </Card>
    </>
  );
}
