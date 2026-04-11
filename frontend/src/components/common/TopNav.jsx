import { useState } from 'react';
import { Globe, Crown, User, LogOut } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import AuthModal from '../auth/AuthModal';
import RedeemModal from '../billing/RedeemModal';

export default function TopNav() {
  const [showAuth, setShowAuth] = useState(false);
  const { user, logout, showRedeemModal, setShowRedeemModal, theme, setTheme } = useAppStore();

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 h-16 bg-surface-0/80 backdrop-blur-md border-b border-white/[0.06] px-6 flex items-center justify-between z-50">
        <div className="text-2xl font-display font-bold text-white tracking-tight">NeoVista</div>

        <div className="flex items-center gap-5">
          <div
            className="flex items-center gap-1 rounded-full p-1"
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
                  background: theme === option.value ? 'var(--brand-blue)' : 'transparent',
                  color: theme === option.value ? '#ffffff' : 'var(--text-muted)',
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button className="flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition">
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
            className="flex items-center gap-2 px-4 py-1.5 border border-brand-gold/50 text-brand-gold text-sm rounded-full hover:bg-brand-gold/10 transition"
          >
            <Crown size={15} />
            <span>升级会员</span>
          </button>

          {user ? (
            <div className="flex items-center gap-3">
              <div className="text-sm text-right">
                <div className="text-white/80">{user.email}</div>
                <div className="text-white/40 text-xs">算力点: {user.credits}</div>
              </div>
              <button onClick={logout} className="p-2 rounded-full hover:bg-white/10 transition">
                <LogOut size={16} className="text-white/50" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAuth(true)}
              className="px-4 py-1.5 bg-brand-blue text-white text-sm rounded-full hover:bg-blue-500 transition"
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
