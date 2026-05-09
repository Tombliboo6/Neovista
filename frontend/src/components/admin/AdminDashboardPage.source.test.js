import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboardSource = readFileSync(new URL('./AdminDashboardPage.jsx', import.meta.url), 'utf8');
const reporterSource = readFileSync(new URL('../../lib/frontendErrorReporter.js', import.meta.url), 'utf8');

test('AdminDashboardPage fetches overview, traffic, users, generations, errors, and alerts', () => {
  assert.match(dashboardSource, /\/api\/v1\/admin\/dashboard\/overview/);
  assert.match(dashboardSource, /\/api\/v1\/admin\/dashboard\/traffic/);
  assert.match(dashboardSource, /\/api\/v1\/admin\/dashboard\/users/);
  assert.match(dashboardSource, /\/api\/v1\/admin\/dashboard\/generations/);
  assert.match(dashboardSource, /\/api\/v1\/admin\/dashboard\/errors/);
  assert.match(dashboardSource, /\/api\/v1\/admin\/dashboard\/alerts/);
});

test('AdminDashboardPage renders an operational dashboard instead of raw JSON panels', () => {
  assert.doesNotMatch(dashboardSource, /JSON\.stringify/);
  assert.doesNotMatch(dashboardSource, /<pre className=/);
  assert.match(dashboardSource, /function KpiGrid/);
  assert.match(dashboardSource, /function TrendPanel/);
  assert.match(dashboardSource, /function RankingPanel/);
  assert.match(dashboardSource, /function ErrorSummary/);
  assert.match(dashboardSource, /function AlertList/);
});

test('AdminDashboardPage includes empty and request error states for key sections', () => {
  assert.match(dashboardSource, /function EmptyState/);
  assert.match(dashboardSource, /暂无趋势数据/);
  assert.match(dashboardSource, /暂无热门页面/);
  assert.match(dashboardSource, /暂无错误记录/);
  assert.match(dashboardSource, /暂无激活告警/);
  assert.match(dashboardSource, /请检查管理员密钥或稍后重试/);
});

test('frontendErrorReporter registers global error listeners', () => {
  assert.match(reporterSource, /window\.addEventListener\('error'/);
  assert.match(reporterSource, /window\.addEventListener\('unhandledrejection'/);
  assert.match(reporterSource, /fetch\('\/api\/v1\/frontend-errors'/);
});
