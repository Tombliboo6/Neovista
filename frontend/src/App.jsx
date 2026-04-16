import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import HomePage from './components/home/HomePage';
import { useAppStore } from './store/useAppStore';

const Workspace = lazy(() => import('./components/workspace/Workspace'));
const AdminPage = lazy(() => import('./components/admin/AdminPage'));

function App() {
  const bootstrapAuth = useAppStore((state) => state.bootstrapAuth);

  useEffect(() => {
    bootstrapAuth();
  }, [bootstrapAuth]);

  return (
    <BrowserRouter>
      <Toaster position="top-center" />
      <Suspense fallback={<div className="min-h-screen grid place-items-center text-sm text-gray-500">加载中...</div>}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/workspace" element={<Workspace />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
