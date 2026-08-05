import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import {
  HomeOutlined,
  BookOutlined,
  PlusCircleOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Spin } from 'antd';
import { useAuth } from '@/store/useAuth';
import { useSettings } from '@/store/useSettings';
import { useUserWords } from '@/store/useWords';
import { useSyncStatus } from '@/store/useSyncStatus';
import { flushSyncQueue, pullIncremental, pullOnLogin, pushPrefsNow } from '@/api/realtimeSync';
import { prefetchVocabBank } from '@/json/vocab';
import { ensureBankMap } from '@/utils/wordSyncPatch';
import { ensureVocabBankRelated } from '@/utils/vocabBankRelated';

const NAV_ITEMS = [
  { path: '/today', label: '今日', icon: <HomeOutlined /> },
  { path: '/words', label: '词表', icon: <BookOutlined /> },
  { path: '/add', label: '添加', icon: <PlusCircleOutlined /> },
  { path: '/settings', label: '设置', icon: <SettingOutlined /> },
];

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const username = useAuth((s) => s.username);
  const settings = useSettings();
  const words = useUserWords();
  const pulling = useSyncStatus((s) => s.pulling);
  const pulledCount = useSyncStatus((s) => s.pulledCount);
  const isPractice = location.pathname === '/practice';
  const isWordDetail = /^\/words\/[^/]+$/.test(location.pathname);
  const isWordsList = location.pathname === '/words';
  const hideMainNav = isPractice || isWordDetail;
  const showSyncGate = pulling && words.length === 0;
  const showSyncBanner = pulling && words.length > 0;

  // Prefetch vocab banks after login (keeps login JS small)
  useEffect(() => {
    if (!username) return;
    prefetchVocabBank();
    void ensureBankMap();
    void ensureVocabBankRelated();
  }, [username]);

  // Cold start / 新设备：本地无词时主动全量拉，避免干看着全 0
  useEffect(() => {
    if (!settings.syncToken || !username) return;
    if (words.length > 0 || pulling) return;
    // 已成功同步过（含服务器确实无词）就别循环全量拉
    if (settings.lastSyncAt > 0) return;
    let cancelled = false;
    void (async () => {
      const { db } = await import('@/db/ieltsDb');
      if (cancelled) return;
      const count = await db.words.where('userId').equals(username).count();
      if (cancelled || count > 0) return;
      try {
        await pullOnLogin();
      } catch {
        // 网络失败时保持空列表；设置页可手动拉
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.syncToken, settings.lastSyncAt, username, words.length, pulling]);

  // Pull incremental when tab becomes visible; periodic soft pull
  useEffect(() => {
    if (!settings.syncToken || !username) return;

    const pull = () => {
      pullIncremental().catch(() => {});
    };

    const onVis = () => {
      if (document.visibilityState === 'visible') {
        void flushSyncQueue().then(pull);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    const interval = setInterval(pull, 5 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(interval);
    };
  }, [settings.syncToken, username]);

  // Flush prefs occasionally when categories may have changed
  useEffect(() => {
    if (!settings.syncToken || !settings.autoSync) return;
    const t = setTimeout(() => {
      pushPrefsNow().catch(() => {});
    }, 3000);
    return () => clearTimeout(t);
  }, [settings.syncToken, settings.autoSync]);

  return (
    <div
      className={`app-container${isPractice ? ' practice-mode' : ''}${
        isWordDetail ? ' word-detail-mode' : ''
      }${isWordsList ? ' words-mode' : ''}`}
    >
      <main className="app-content">
        {showSyncBanner && (
          <div className="sync-banner">正在同步词库 · 已写入 {pulledCount} 个词</div>
        )}
        {showSyncGate ? (
          <div className="sync-gate">
            <Spin size="large" />
            <h2>正在同步词库</h2>
            <p>
              {pulledCount > 0
                ? `已写入 ${pulledCount} 个词，请稍候…`
                : '第一次全量拉取可能较慢，不是没有单词'}
            </p>
          </div>
        ) : (
          children
        )}
      </main>
      {!hideMainNav && (
        <nav className="bottom-nav">
          {NAV_ITEMS.map((it) => (
            <button
              key={it.path}
              className={`bottom-nav-item ${location.pathname === it.path ? 'active' : ''}`}
              onClick={() => navigate(it.path)}
            >
              {it.icon}
              <span>{it.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
