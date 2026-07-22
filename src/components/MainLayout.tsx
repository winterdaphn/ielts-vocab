import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import {
  HomeOutlined,
  BookOutlined,
  PlusCircleOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useAuth } from '@/store/useAuth';
import { useUserWords } from '@/store/useWords';
import { useSettings } from '@/store/useSettings';
import { pushToCloud } from '@/api/sync';

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
  const password = useAuth((s) => s.password);
  const settings = useSettings();
  const words = useUserWords();
  const isPractice = location.pathname === '/practice';

  // Auto-sync after word list change
  useEffect(() => {
    if (!settings.autoSync || !settings.workerUrl) return;
    if (!username || !password) return;
    const t = setTimeout(() => {
      autoSync().catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words.length]);

  async function autoSync() {
    try {
      await pushToCloud(words, settings, username, password);
    } catch {
      // silent
    }
  }

  return (
    <div className={`app-container${isPractice ? ' practice-mode' : ''}`}>
      <main className="app-content">{children}</main>
      {!isPractice && (
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
