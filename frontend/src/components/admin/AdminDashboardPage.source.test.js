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

test('frontendErrorReporter registers global error listeners', () => {
  assert.match(reporterSource, /window\.addEventListener\('error'/);
  assert.match(reporterSource, /window\.addEventListener\('unhandledrejection'/);
  assert.match(reporterSource, /fetch\('\/api\/v1\/frontend-errors'/);
});
