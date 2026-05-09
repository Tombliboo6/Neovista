import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import HomePage from './components/home/HomePage';
import { startAppVersionWatcher } from './lib/appVersionWatcher';
import { useAppStore } from './store/useAppStore';

const Workspace = lazy(() => import('./components/workspace/Workspace'));
const AdminShell = lazy(() => import('./components/admin/AdminShell'));
const AdminDashboardPage = lazy(() => import('./components/admin/AdminDashboardPage'));
const AdminTemplatesPage = lazy(() => import('./components/admin/AdminTemplatesPage'));
const AdminRedemptionCodesPage = lazy(() => import('./components/admin/AdminRedemptionCodesPage'));

function App() {
  const bootstrapAuth = useAppStore((state) => state.bootstrapAuth);

  useEffect(() => {
    bootstrapAuth();
  }, [bootstrapAuth]);

  useEffect(() => {
    const stopWatchingVersion = startAppVersionWatcher({
      onUpdateAvailable: (reload) => {
        toast.custom(
          (toastInstance) => (
            <div className="max-w-sm rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-lg">
              <div className="text-sm font-medium text-stone-900">检测到新版本，刷新后可使用最新功能</div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  className="rounded-full bg-stone-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-700"
                  onClick={() => {
                    toast.dismiss(toastInstance.id);
                    reload();
                  }}
                >
                  立即刷新
                </button>
              </div>
            </div>
          ),
          {
            duration: Infinity,
            id: 'app-version-update',
          }
        );
      },
    });

    return stopWatchingVersion;
  }, []);

  return (
    <BrowserRouter>
      <Toaster position="top-center" />
      <Suspense fallback={<div className="grid min-h-[100dvh] place-items-center text-sm" style={{ color: 'var(--text-muted)' }}>加载中...</div>}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/workspace" element={<Workspace />} />
          <Route path="/admin" element={<AdminShell />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<AdminDashboardPage />} />
            <Route path="templates" element={<AdminTemplatesPage />} />
            <Route path="redemption-codes" element={<AdminRedemptionCodesPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
