import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Globe, Crown, PanelsTopLeft, LogOut } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import AuthModal from '../auth/AuthModal';
import RedeemModal from '../billing/RedeemModal';

export default function TopNav() {
  const [showAuth, setShowAuth] = useState(false);
  const { user, logout, showRedeemModal, setShowRedeemModal, theme, setTheme } = useAppStore();

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 flex h-16 items-center justify-between border-b border-white/[0.06] bg-surface-0/80 px-4 backdrop-blur-md sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="font-display text-xl font-semibold text-white/90">NeoVista</div>
          <Link
            to="/workspace"
            data-testid="professional-canvas-entry"
            aria-label="进入专业画布"
            title="专业画布"
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition hover:bg-white/[0.08] active:scale-[0.98] sm:px-3 sm:text-sm"
            style={{
              borderColor: 'var(--border-strong)',
              background: 'var(--surface-1)',
              color: 'var(--text-primary)',
            }}
          >
            <PanelsTopLeft size={15} />
            <span className="sm:hidden">画布</span>
            <span className="hidden sm:inline">专业画布</span>
          </Link>
          <div className="hidden text-[11px] uppercase text-white/30 lg:block">AIGC Analysis Studio</div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <div
            className="hidden items-center gap-1 rounded-full p-1 sm:flex"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            {[
              { value: 'dark', label: '黑' },
              { value: 'light', label: '白' },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setTheme(option.value)}
                className="px-3 py-1 rounded-full text-xs transition"
                style={{
                  background: theme === option.value ? 'var(--accent-primary)' : 'transparent',
                  color: theme === option.value ? '#ffffff' : 'var(--text-muted)',
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button className="hidden items-center gap-2 text-sm text-white/50 transition hover:text-white/80 md:flex">
            <Globe size={16} />
            <span>EN / 中文</span>
          </button>
          <button
            onClick={() => {
              if (user) {
                setShowRedeemModal(true);
              } else {
                setShowAuth(true);
              }
            }}
            className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition active:scale-[0.98] sm:px-4"
            style={{ borderColor: 'rgba(200,148,69,0.42)', color: 'var(--accent-premium)', background: 'var(--accent-premium-soft)' }}
          >
            <Crown size={15} />
            <span className="hidden sm:inline">升级会员</span>
          </button>

          {user ? (
            <div className="flex items-center gap-3">
              <div className="hidden text-right text-sm sm:block">
                <div className="max-w-32 truncate text-white/80">{user.email}</div>
                <div className="text-xs text-white/40">算力点: {user.credits}</div>
              </div>
              <button onClick={logout} className="rounded-full p-2 transition hover:bg-white/10" title="退出登录">
                <LogOut size={16} className="text-white/50" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAuth(true)}
              className="rounded-full px-4 py-1.5 text-sm text-white transition active:scale-[0.98]"
              style={{ background: 'var(--accent-primary)' }}
            >
              登录/注册
            </button>
          )}
        </div>
      </nav>

      <AuthModal isOpen={showAuth} onClose={() => setShowAuth(false)} />
      <RedeemModal isOpen={showRedeemModal} onClose={() => setShowRedeemModal(false)} />
    </>
  );
}
