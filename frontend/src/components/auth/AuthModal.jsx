import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAppStore } from '../../store/useAppStore';

const API_BASE = '/api';

export default function AuthModal({ isOpen, onClose }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');
  const { setToken, setUser, refreshBilling, authModalContext, setAuthModalContext } = useAppStore();

  if (!isOpen) return null;

  const sendCode = async () => {
    if (!email) {
      setError('请输入邮箱');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/v1/auth/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || '发送失败');
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (mode === 'register') {
      if (password.length < 8 || password.length > 24) {
        setError('密码长度必须为8-24位');
        return;
      }
      if (!/[a-zA-Z]/.test(password)) {
        setError('密码必须包含至少一个字母');
        return;
      }
    }

    try {
      const endpoint = mode === 'login'
        ? `${API_BASE}/v1/auth/login`
        : `${API_BASE}/v1/auth/register`;

      const body = mode === 'login'
        ? { email, password }
        : { email, password, code };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || '操作失败');

      setToken(data.access_token);
      setUser(data.user);
      refreshBilling().catch(() => null);
      if (mode === 'register') {
        toast.success(`注册成功，已获得 ${data.user?.credits ?? 0} 算力点`);
      }
      setAuthModalContext(null);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-xl font-bold">{mode === 'login' ? '登录' : '注册'}</h2>
            {authModalContext?.message && (
              <p className="mt-1 text-sm text-gray-500">
                当前操作需要登录。{authModalContext?.message || '登录后可继续当前操作'}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        {error && <div className="bg-red-50 text-red-600 p-2 rounded mb-4 text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border rounded"
            required
          />

          <input
            type="password"
            placeholder="密码（8-24位，需包含字母）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border rounded"
            minLength={8}
            maxLength={24}
            required
          />

          {mode === 'register' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="验证码"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="flex-1 px-3 py-2 border rounded"
                  required
                />
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={countdown > 0}
                  className="px-4 py-2 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
                >
                  {countdown > 0 ? `${countdown}s` : '获取验证码'}
                </button>
              </div>
              <div className="rounded bg-indigo-50 px-3 py-2 text-xs text-indigo-600">
                注册成功后系统会自动赠送 200 算力点，可直接用于首次测试和出图。
              </div>
            </div>
          )}

          <button
            type="submit"
            className="w-full py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            {mode === 'login' ? '登录' : '注册'}
          </button>
        </form>

        <div className="mt-4 text-center text-sm">
          <button
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="text-indigo-600 hover:underline"
          >
            {mode === 'login' ? '没有账号？立即注册' : '已有账号？立即登录'}
          </button>
        </div>
      </div>
    </div>
  );
}
