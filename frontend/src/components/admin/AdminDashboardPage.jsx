import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Clock,
  FileWarning,
  Gauge,
  MousePointerClick,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';

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

const numberFormatter = new Intl.NumberFormat('zh-CN');

async function fetchDashboardSection(url, adminToken) {
  const token = localStorage.getItem('token');
  const response = await fetch(url, {
    headers: {
      'x-admin-token': adminToken,
      'Authorization': `Bearer ${token || ''}`,
    },
  });

  if ([401, 403].includes(response.status)) {
    localStorage.removeItem('adminToken');
    window.location.reload();
    throw new Error('管理员令牌无效');
  }

  if (!response.ok) {
    throw new Error(`Dashboard request failed: ${response.status}`);
  }

  return response.json();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatNumber(value, fallback = '--') {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const number = Number(value);
  if (Number.isFinite(number)) {
    return numberFormatter.format(number);
  }

  return String(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return `${Math.round(value * 100)}%`;
}

function formatDateTime(value) {
  if (!value) {
    return '--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getRankingLabel(item, index) {
  return (
    item?.label ||
    item?.path ||
    item?.page ||
    item?.url ||
    item?.referrer ||
    item?.source ||
    item?.device ||
    item?.name ||
    item?.x ||
    `项目 ${index + 1}`
  );
}

function getRankingCount(item) {
  return toFiniteNumber(
    item?.count ?? item?.views ?? item?.visits ?? item?.pageviews ?? item?.sessions ?? item?.value ?? item?.y,
  );
}

function normalizeRanking(items) {
  return asArray(items).map((item, index) => ({
    label: getRankingLabel(item, index),
    count: getRankingCount(item),
  }));
}

function normalizeTrafficSeries(series) {
  return asArray(series).map((item, index) => {
    const rawLabel = item?.date || item?.day || item?.timestamp || item?.label || item?.x;
    const label = rawLabel ? String(rawLabel).slice(0, 10) : `T${index + 1}`;
    const primary = toFiniteNumber(item?.pv ?? item?.pageviews ?? item?.views ?? item?.count ?? item?.value ?? item?.y);
    const secondary = item?.uv ?? item?.visitors ?? item?.sessions;

    return {
      label,
      value: primary,
      meta: secondary === undefined ? 'PV' : `UV ${formatNumber(secondary, '0')}`,
    };
  });
}

function buildGenerationTrend(records) {
  const buckets = new Map();

  asArray(records).forEach((record) => {
    const label = record?.created_at ? String(record.created_at).slice(5, 10) : '未知';
    const current = buckets.get(label) || { label, value: 0, failed: 0 };
    current.value += 1;
    if (record?.status === 'FAILED') {
      current.failed += 1;
    }
    buckets.set(label, current);
  });

  return Array.from(buckets.values())
    .slice(0, 7)
    .reverse()
    .map((item) => ({
      label: item.label,
      value: item.value,
      meta: item.failed > 0 ? `失败 ${item.failed}` : '全部成功',
    }));
}

function EmptyState({ title, detail = '当前没有可展示的数据。' }) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <p className="mt-2 max-w-sm text-xs leading-5 text-slate-400">{detail}</p>
    </div>
  );
}

function DashboardErrorState({ message }) {
  return (
    <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-700">
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold">Dashboard 加载失败</p>
          <p className="mt-2 text-sm text-rose-600">{message || '请求返回异常'}</p>
          <p className="mt-3 text-xs text-rose-500">请检查管理员密钥或稍后重试。</p>
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-32 animate-pulse rounded-3xl border border-slate-200 bg-slate-50" />
      ))}
    </div>
  );
}

function SectionPanel({ title, subtitle, children, className = '' }) {
  return (
    <section className={`rounded-3xl border border-slate-200 bg-slate-50 p-5 ${className}`}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{title}</p>
          {subtitle ? <p className="mt-2 text-sm leading-6 text-slate-500">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function KpiGrid({ overview, traffic, users, generations, errors }) {
  const generationTotal = generations?.summary?.total ?? 0;
  const generationSuccess = generations?.summary?.success ?? 0;
  const successRate = generationTotal > 0 ? generationSuccess / generationTotal : Number.NaN;
  const frontendErrors = asArray(errors?.frontend_errors).length;

  const cards = [
    {
      label: '今日 UV',
      value: overview?.kpis?.today_uv ?? traffic?.summary?.today?.uv,
      meta: traffic?.summary?.available ? 'Umami 在线' : 'Umami 未配置',
      icon: Users,
    },
    {
      label: '今日 PV',
      value: overview?.kpis?.today_pv ?? traffic?.summary?.today?.pv,
      meta: '访问总量',
      icon: MousePointerClick,
    },
    {
      label: '今日生图',
      value: overview?.kpis?.today_generations,
      meta: `近 50 条成功率 ${formatPercent(successRate)}`,
      icon: Sparkles,
    },
    {
      label: '今日错误',
      value: overview?.kpis?.today_errors,
      meta: `前端近期 ${formatNumber(frontendErrors, '0')} 条`,
      icon: FileWarning,
      tone: 'rose',
    },
    {
      label: '今日注册',
      value: overview?.kpis?.today_registrations,
      meta: `30 天新增 ${formatNumber(users?.totals?.new_30d, '0')}`,
      icon: TrendingUp,
    },
    {
      label: '今日登录',
      value: overview?.kpis?.today_logins,
      meta: `7 天登录 ${formatNumber(users?.totals?.logins_7d, '0')}`,
      icon: Activity,
    },
    {
      label: '注册用户',
      value: users?.totals?.registered_users,
      meta: `7 天新增 ${formatNumber(users?.totals?.new_7d, '0')}`,
      icon: Gauge,
    },
    {
      label: '激活告警',
      value: overview?.kpis?.active_alerts,
      meta: overview?.status?.service_health === 'ok' ? '服务状态正常' : '服务状态待查',
      icon: ShieldAlert,
      tone: overview?.kpis?.active_alerts > 0 ? 'amber' : 'slate',
    },
  ];

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        const toneClass =
          card.tone === 'rose'
            ? 'bg-rose-50 text-rose-600'
            : card.tone === 'amber'
              ? 'bg-amber-50 text-amber-600'
              : 'bg-white text-slate-500';

        return (
          <div key={card.label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{card.label}</p>
                <p className="mt-3 text-3xl font-semibold text-slate-900">{formatNumber(card.value)}</p>
              </div>
              <span className={`rounded-2xl p-2 ${toneClass}`}>
                <Icon size={18} />
              </span>
            </div>
            <p className="mt-4 text-xs text-slate-500">{card.meta}</p>
          </div>
        );
      })}
    </section>
  );
}

function TrendPanel({ title, subtitle, points, emptyTitle = '暂无趋势数据' }) {
  const maxValue = Math.max(...points.map((point) => point.value), 0);

  return (
    <SectionPanel title={title} subtitle={subtitle}>
      {points.length === 0 ? (
        <EmptyState title={emptyTitle} detail="接口已返回，但暂时没有可绘制的时间序列。" />
      ) : (
        <div className="space-y-4">
          {points.map((point) => {
            const width = maxValue > 0 ? Math.max((point.value / maxValue) * 100, 8) : 8;
            return (
              <div key={`${point.label}-${point.meta}`} className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-slate-700">{point.label}</span>
                  <span className="text-xs text-slate-400">{point.meta}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white">
                    <div className="h-full rounded-full bg-slate-900" style={{ width: `${width}%` }} />
                  </div>
                  <span className="w-14 text-right text-sm font-semibold text-slate-900">{formatNumber(point.value, '0')}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionPanel>
  );
}

function RankingPanel({ title, subtitle, items, emptyTitle = '暂无热门页面' }) {
  const rankings = normalizeRanking(items);
  const maxCount = Math.max(...rankings.map((item) => item.count), 0);

  return (
    <SectionPanel title={title} subtitle={subtitle}>
      {rankings.length === 0 ? (
        <EmptyState title={emptyTitle} detail="监控接口暂未返回排行数据。" />
      ) : (
        <div className="space-y-3">
          {rankings.slice(0, 8).map((item, index) => {
            const width = maxCount > 0 ? Math.max((item.count / maxCount) * 100, 10) : 10;
            return (
              <div key={`${item.label}-${index}`} className="rounded-2xl bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-slate-700">{item.label}</span>
                  <span className="text-sm font-semibold text-slate-900">{formatNumber(item.count, '0')}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-slate-900" style={{ width: `${width}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionPanel>
  );
}

function SummaryMetric({ label, value, tone = 'slate' }) {
  const toneClass = tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-600' : 'text-slate-900';

  return (
    <div className="rounded-2xl bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${toneClass}`}>{formatNumber(value, '0')}</p>
    </div>
  );
}

function StatusPill({ status }) {
  const isFailed = status === 'FAILED' || status === 'ACTIVE';
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
        isFailed ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
      }`}
    >
      {status || 'UNKNOWN'}
    </span>
  );
}

function GenerationOverview({ generations }) {
  const records = asArray(generations?.records);

  return (
    <SectionPanel title="Generations" subtitle="近 50 条生成记录、成功率、模型与模板热度。" className="xl:col-span-2">
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryMetric label="总请求" value={generations?.summary?.total} />
        <SummaryMetric label="成功" value={generations?.summary?.success} tone="emerald" />
        <SummaryMetric label="失败" value={generations?.summary?.failed} tone="rose" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <RankingPanel title="Model Ranking" subtitle="最近生成使用的模型。" items={generations?.model_ranking} emptyTitle="暂无模型排行" />
        <RankingPanel title="Template Ranking" subtitle="最近触发的分析图模板。" items={generations?.template_ranking} emptyTitle="暂无模板排行" />
      </div>

      <div className="mt-5 rounded-2xl bg-white p-4">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-900">最近生成记录</p>
          <Clock size={16} className="text-slate-400" />
        </div>
        {records.length === 0 ? (
          <EmptyState title="暂无生成记录" detail="生成监控接口暂无近期记录。" />
        ) : (
          <div className="space-y-3">
            {records.slice(0, 6).map((record, index) => (
              <div key={`${record?.request_id || 'generation'}-${index}`} className="grid gap-3 rounded-2xl border border-slate-100 p-3 md:grid-cols-[1fr_auto] md:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{record?.template_id || '未指定模板'}</p>
                  <p className="mt-1 truncate text-xs text-slate-400">
                    {record?.selected_model || 'unknown model'} · {record?.provider_name || 'unknown provider'} · {formatDateTime(record?.created_at)}
                  </p>
                </div>
                <StatusPill status={record?.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionPanel>
  );
}

function RecentUsersPanel({ users }) {
  const recentUsers = asArray(users?.recent_registrations);

  return (
    <SectionPanel title="Users" subtitle="新注册用户与登录活跃度。">
      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryMetric label="7 天新增" value={users?.totals?.new_7d} />
        <SummaryMetric label="7 天登录" value={users?.totals?.logins_7d} />
      </div>

      <div className="mt-5 space-y-3">
        {recentUsers.length === 0 ? (
          <EmptyState title="暂无新用户" detail="用户接口暂未返回最近注册用户。" />
        ) : (
          recentUsers.slice(0, 6).map((user) => (
            <div key={user.id || user.email} className="rounded-2xl bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-medium text-slate-800">{user.email || `用户 ${user.id}`}</p>
                <span className="text-xs font-semibold text-slate-500">{formatNumber(user.credits, '0')} 点</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">注册 {formatDateTime(user.created_at)} · 登录 {formatDateTime(user.last_login_at)}</p>
            </div>
          ))
        )}
      </div>
    </SectionPanel>
  );
}

function ErrorSummary({ errors }) {
  const frontendErrors = asArray(errors?.frontend_errors);
  const backendSummary = asArray(errors?.backend_summary);
  const upstreamFailures = asArray(errors?.upstream_failures);
  const hasErrors = frontendErrors.length > 0 || backendSummary.length > 0 || upstreamFailures.length > 0;

  return (
    <SectionPanel title="Errors" subtitle="前端异常、生成失败摘要和上游失败记录。" className="xl:col-span-2">
      {!hasErrors ? (
        <EmptyState title="暂无错误记录" detail="最近没有前端错误或上游失败。" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-3">
            <SummaryMetric label="前端错误" value={frontendErrors.length} tone={frontendErrors.length > 0 ? 'rose' : 'slate'} />
            <SummaryMetric label="上游失败" value={upstreamFailures.length} tone={upstreamFailures.length > 0 ? 'rose' : 'slate'} />
            <div className="rounded-2xl bg-white p-4">
              <p className="text-sm font-semibold text-slate-900">后端错误码</p>
              <div className="mt-3 space-y-2">
                {backendSummary.length === 0 ? (
                  <p className="text-xs text-slate-400">暂无后端错误摘要</p>
                ) : (
                  backendSummary.map((item) => (
                    <div key={item.error_code} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-slate-600">{item.error_code || 'UNKNOWN'}</span>
                      <span className="font-semibold text-slate-900">{formatNumber(item.count, '0')}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {[...frontendErrors, ...upstreamFailures].slice(0, 6).map((item, index) => (
              <div key={`${item?.request_id || item?.route || 'error'}-${index}`} className="rounded-2xl bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{item?.error_code || item?.route || 'Frontend Error'}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{item?.error_message || item?.message || 'No message'}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{formatDateTime(item?.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionPanel>
  );
}

function AlertList({ alerts }) {
  const activeAlerts = asArray(alerts?.active_alerts);
  const history = asArray(alerts?.recent_history);

  return (
    <SectionPanel title="Alerts" subtitle="激活告警与近期恢复历史。">
      {activeAlerts.length === 0 ? (
        <EmptyState title="暂无激活告警" detail="当前监控没有需要处理的激活告警。" />
      ) : (
        <div className="space-y-3">
          {activeAlerts.map((alert, index) => (
            <div key={`${alert.type}-${index}`} className="rounded-2xl border border-rose-100 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{alert.type || 'Alert'}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{alert.message || '无详细信息'}</p>
                </div>
                <StatusPill status={alert.status} />
              </div>
              <p className="mt-3 text-xs text-slate-400">触发 {formatDateTime(alert.triggered_at)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 border-t border-slate-200 pt-5">
        <p className="mb-3 text-sm font-semibold text-slate-900">最近历史</p>
        {history.length === 0 ? (
          <p className="text-xs text-slate-400">暂无历史告警</p>
        ) : (
          <div className="space-y-2">
            {history.slice(0, 5).map((alert, index) => (
              <div key={`${alert.type}-history-${index}`} className="flex items-center justify-between gap-3 rounded-2xl bg-white px-3 py-2">
                <span className="min-w-0 truncate text-sm text-slate-600">{alert.message || alert.type || 'Alert'}</span>
                <span className="shrink-0 text-xs text-slate-400">{formatDateTime(alert.resolved_at || alert.triggered_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionPanel>
  );
}

export default function AdminDashboardPage() {
  const [dashboardData, setDashboardData] = useState(emptyDashboardState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const adminToken = localStorage.getItem('adminToken');
    if (!adminToken) {
      setLoading(false);
      setError('缺少管理员密钥');
      return undefined;
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

  const trafficTrend = useMemo(
    () => normalizeTrafficSeries(dashboardData.traffic?.summary?.series),
    [dashboardData.traffic],
  );
  const generationTrend = useMemo(
    () => buildGenerationTrend(dashboardData.generations?.records),
    [dashboardData.generations],
  );

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-slate-900 px-6 py-7 text-white">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">Dashboard</p>
            <h3 className="mt-2 text-3xl font-semibold">运营与排障总览</h3>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              汇总流量、用户、生成、错误与告警，直接用于日常运营巡检。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-right sm:min-w-72">
            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
              <p className="text-xs text-slate-300">服务状态</p>
              <p className="mt-1 text-sm font-semibold">{dashboardData.overview?.status?.service_health || 'checking'}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
              <p className="text-xs text-slate-300">监控来源</p>
              <p className="mt-1 text-sm font-semibold">{dashboardData.traffic?.summary?.available ? 'Umami' : 'Local fallback'}</p>
            </div>
          </div>
        </div>
      </div>

      {loading ? <LoadingState /> : null}
      {!loading && error ? <DashboardErrorState message={error} /> : null}

      {!loading && !error ? (
        <>
          <KpiGrid
            overview={dashboardData.overview}
            traffic={dashboardData.traffic}
            users={dashboardData.users}
            generations={dashboardData.generations}
            errors={dashboardData.errors}
          />

          <div className="grid gap-6 xl:grid-cols-2">
            <TrendPanel title="Traffic Trend" subtitle="PV / UV 时间序列，优先展示 Umami 返回的趋势。" points={trafficTrend} />
            <TrendPanel title="Generation Trend" subtitle="按日期聚合最近 50 条生成记录。" points={generationTrend} />
            <RankingPanel title="Top Pages" subtitle="访问最多的页面路径。" items={dashboardData.traffic?.top_pages} emptyTitle="暂无热门页面" />
            <RankingPanel title="Sources" subtitle="主要访问来源与设备入口。" items={dashboardData.traffic?.sources} emptyTitle="暂无来源排行" />
            <RecentUsersPanel users={dashboardData.users} />
            <AlertList alerts={dashboardData.alerts} />
            <GenerationOverview generations={dashboardData.generations} />
            <ErrorSummary errors={dashboardData.errors} />
          </div>
        </>
      ) : null}
    </div>
  );
}
