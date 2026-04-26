import { useEffect, useState } from 'react';

const dashboardEndpoints = {
  overview: '/api/v1/admin/dashboard/overview',
  traffic: '/api/v1/admin/dashboard/traffic',
  users: '/api/v1/admin/dashboard/users',
  generations: '/api/v1/admin/dashboard/generations',
  errors: '/api/v1/admin/dashboard/errors',
  alerts: '/api/v1/admin/dashboard/alerts',
};

const emptyDashboardState = {
  overview: null,
  traffic: null,
  users: null,
  generations: null,
  errors: null,
  alerts: null,
};

async function fetchDashboardSection(url, adminToken) {
  const response = await fetch(url, {
    headers: { 'x-admin-token': adminToken },
  });

  if (response.status === 403) {
    localStorage.removeItem('adminToken');
    window.location.reload();
    throw new Error('管理员令牌无效');
  }

  if (!response.ok) {
    throw new Error(`Dashboard request failed: ${response.status}`);
  }

  return response.json();
}

function OverviewCards({ overview }) {
  const cards = [
    { label: '今日 UV', value: overview?.kpis?.today_uv ?? '--' },
    { label: '今日 PV', value: overview?.kpis?.today_pv ?? '--' },
    { label: '今日注册', value: overview?.kpis?.today_registrations ?? 0 },
    { label: '今日登录', value: overview?.kpis?.today_logins ?? 0 },
    { label: '今日生图', value: overview?.kpis?.today_generations ?? 0 },
    { label: '今日错误', value: overview?.kpis?.today_errors ?? 0 },
    { label: '激活告警', value: overview?.kpis?.active_alerts ?? 0 },
  ];

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{card.label}</p>
          <p className="mt-3 text-3xl font-semibold text-slate-900">{card.value}</p>
        </div>
      ))}
    </section>
  );
}

function Panel({ title, subtitle, children }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{title}</p>
        <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

export default function AdminDashboardPage() {
  const [dashboardData, setDashboardData] = useState(emptyDashboardState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const adminToken = localStorage.getItem('adminToken');
    if (!adminToken) {
      return;
    }

    let cancelled = false;

    async function loadDashboard() {
      setLoading(true);
      setError('');

      try {
        const [
          overview,
          traffic,
          users,
          generations,
          errors,
          alerts,
        ] = await Promise.all([
          fetchDashboardSection(dashboardEndpoints.overview, adminToken),
          fetchDashboardSection(dashboardEndpoints.traffic, adminToken),
          fetchDashboardSection(dashboardEndpoints.users, adminToken),
          fetchDashboardSection(dashboardEndpoints.generations, adminToken),
          fetchDashboardSection(dashboardEndpoints.errors, adminToken),
          fetchDashboardSection(dashboardEndpoints.alerts, adminToken),
        ]);

        if (cancelled) {
          return;
        }

        setDashboardData({
          overview,
          traffic,
          users,
          generations,
          errors,
          alerts,
        });
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(loadError.message || 'Dashboard 加载失败');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-slate-900 px-6 py-7 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">Dashboard</p>
        <h3 className="mt-2 text-3xl font-semibold">运营与排障总览</h3>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
          统一查看流量、用户、生成记录、错误和告警，保留模板管理页作为独立工作区。
        </p>
      </div>

      {loading ? <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Dashboard 加载中...</div> : null}
      {error ? <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-600">{error}</div> : null}

      {!loading && !error ? (
        <>
          <OverviewCards overview={dashboardData.overview} />

          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title="Traffic" subtitle="PV / UV、热门页面、来源与设备。">
              <pre className="overflow-x-auto rounded-2xl bg-white p-4 text-xs text-slate-600">
                {JSON.stringify(dashboardData.traffic, null, 2)}
              </pre>
            </Panel>

            <Panel title="Users" subtitle="注册趋势、登录活跃与最近注册用户。">
              <pre className="overflow-x-auto rounded-2xl bg-white p-4 text-xs text-slate-600">
                {JSON.stringify(dashboardData.users, null, 2)}
              </pre>
            </Panel>

            <Panel title="Generations" subtitle="生成成功率、模型 / 模板排行和最近记录。">
              <pre className="overflow-x-auto rounded-2xl bg-white p-4 text-xs text-slate-600">
                {JSON.stringify(dashboardData.generations, null, 2)}
              </pre>
            </Panel>

            <Panel title="Errors" subtitle="前端错误、后端摘要和上游失败。">
              <pre className="overflow-x-auto rounded-2xl bg-white p-4 text-xs text-slate-600">
                {JSON.stringify(dashboardData.errors, null, 2)}
              </pre>
            </Panel>

            <Panel title="Alerts" subtitle="当前激活告警和近期恢复记录。">
              <pre className="overflow-x-auto rounded-2xl bg-white p-4 text-xs text-slate-600">
                {JSON.stringify(dashboardData.alerts, null, 2)}
              </pre>
            </Panel>
          </div>
        </>
      ) : null}
    </div>
  );
}
