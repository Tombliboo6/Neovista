import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

export default function AdminShell() {
  const location = useLocation();
  const adminToken = localStorage.getItem('adminToken');

  useEffect(() => {
    if (adminToken) {
      return;
    }

    const token = window.prompt('请输入管理员密钥：');
    if (token) {
      localStorage.setItem('adminToken', token);
      window.location.reload();
      return;
    }

    window.location.href = '/';
  }, [adminToken]);

  const currentItem = location.pathname.startsWith('/admin/templates')
    ? 'Templates'
    : location.pathname.startsWith('/admin/redemption-codes')
      ? '兑换码'
      : 'Dashboard';

  const navItems = [
    { to: '/admin/dashboard', label: 'Dashboard' },
    { to: '/admin/templates', label: 'Templates' },
    { to: '/admin/redemption-codes', label: '兑换码' },
  ];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 md:px-6 lg:flex-row lg:gap-6">
        <aside className="mb-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm lg:mb-0 lg:w-72 lg:p-6">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">NeoVista Admin</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">Operations Console</h1>
            <p className="mt-2 text-sm text-slate-500">复用现有管理员密钥，分离运营 Dashboard 与模板管理。</p>
          </div>

          <nav className="space-y-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `block rounded-2xl px-4 py-3 text-sm font-medium transition ${
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`
                }
              >{item.label}</NavLink>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
          <div className="mb-6 flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Current Page</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">{currentItem}</h2>
            </div>
            <button
              onClick={() => {
                window.location.href = '/';
              }}
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-900 hover:text-slate-900"
            >
              返回首页
            </button>
          </div>

          <Outlet />
        </main>
      </div>
    </div>
  );
}
