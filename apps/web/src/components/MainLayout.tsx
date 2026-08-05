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

import { useUserWords } from '@/store/useWords';

import { useSyncStatus } from '@/store/useSyncStatus';
import { flushSyncQueue, pullIncremental, pullOnLogin, pushPrefsNow } from '@/api/realtimeSync';
import { flushCloudSessionPatch, flushCloudItemPatches } from '@/api/practiceCloudSync';

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

  const isPractice = location.pathname === '/practice';

  const isWordDetail = /^\/words\/[^/]+$/.test(location.pathname);

  const isWordsList = location.pathname === '/words';

  const hideMainNav = isPractice || isWordDetail;



  useEffect(() => {

    if (!username) return;

    prefetchVocabBank();

    void ensureBankMap();

    void ensureVocabBankRelated();

  }, [username]);



  useEffect(() => {

    if (!settings.syncToken || !username) return;

    if (words.length > 0 || pulling) return;

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

        /* console in pullIncremental */

      }

    })();

    return () => {

      cancelled = true;

    };

  }, [settings.syncToken, settings.lastSyncAt, username, words.length, pulling]);



  // 切回标签：只推送本地队列，不拉服务器（避免本机进度被旧 prefs/词表盖掉 + 少闪屏）

  useEffect(() => {

    if (!settings.syncToken || !username) return;



    const onVis = () => {
      if (document.visibilityState === 'visible') {
        void flushSyncQueue();
        void flushCloudSessionPatch();
      } else {
        // Leaving the tab: push practice progress before the page freezes.
        void flushCloudSessionPatch({ keepalive: true });
        void flushCloudItemPatches();
      }
    };

    document.addEventListener('visibilitychange', onVis);



    const interval = setInterval(() => {

      if (location.pathname === '/practice') return;

      void pullIncremental({ reason: 'interval', applyPracticePrefs: false });

    }, 5 * 60 * 1000);



    return () => {

      document.removeEventListener('visibilitychange', onVis);

      clearInterval(interval);

    };

  }, [settings.syncToken, username, location.pathname]);



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


