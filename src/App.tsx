import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/store/useAuth';
import LoginPage from '@/pages/LoginPage';
import TodayPage from '@/pages/TodayPage';
import WordsPage from '@/pages/WordsPage';
import WordDetailPage from '@/pages/WordDetailPage';
import AddPage from '@/pages/AddPage';
import SettingsPage from '@/pages/SettingsPage';
import PracticePage from '@/pages/PracticePage';
import MainLayout from '@/components/MainLayout';

export default function App() {
  const username = useAuth((s) => s.username);

  if (!username) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <MainLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<TodayPage />} />
        <Route path="/words" element={<WordsPage />} />
        <Route path="/words/:id" element={<WordDetailPage />} />
        <Route path="/add" element={<AddPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/practice" element={<PracticePage />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Routes>
    </MainLayout>
  );
}
