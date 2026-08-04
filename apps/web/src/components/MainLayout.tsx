import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import {
  HomeOutlined,
  BookOutlined,
  PlusCircleOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useAuth } from '@/store/useAuth';
import { useSettings } from '@/store/useSettings';
import { flushSyncQueue, pullIncremental, pushPrefsNow } from '@/api/realtimeSync';
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
  const isPractice = location.pathname === '/practice';
  const isWordDetail = /^\/words\/[^/]+$/.test(location.pathname);
  const isWordsList = location.pathname === '/words';
  const hideMainNav = isPractice || isWordDetail;

  // Prefetch vocab banks after login (keeps login JS small)
  useEffect(() => {
    if (!username) return;
    prefetchVocabBank();
    void ensureBankMap();
    void ensureVocabBankRelated();
  }, [username]);

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
      <main className="app-content">{children}</main>
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
