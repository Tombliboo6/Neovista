import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');

test('App lazy-loads non-home routes', () => {
  assert.match(appSource, /const Workspace = lazy\(\(\) => import\('.\/components\/workspace\/Workspace'\)\);/);
  assert.match(appSource, /const AdminShell = lazy\(\(\) => import\('.\/components\/admin\/AdminShell'\)\);/);
  assert.match(appSource, /const AdminDashboardPage = lazy\(\(\) => import\('.\/components\/admin\/AdminDashboardPage'\)\);/);
  assert.match(appSource, /const AdminTemplatesPage = lazy\(\(\) => import\('.\/components\/admin\/AdminTemplatesPage'\)\);/);
  assert.match(appSource, /<Suspense fallback=/);
  assert.doesNotMatch(appSource, /import Workspace from '\.\/components\/workspace\/Workspace';/);
  assert.doesNotMatch(appSource, /import AdminShell from '\.\/components\/admin\/AdminShell';/);
});

test('App bootstraps auth state on startup', () => {
  assert.match(appSource, /const bootstrapAuth = useAppStore\(\(state\) => state\.bootstrapAuth\);/);
  assert.match(appSource, /useEffect\(\(\) => \{\s*bootstrapAuth\(\);/);
});

test('App starts a version watcher and prompts for refresh when a new bundle is deployed', () => {
  assert.match(appSource, /import toast, \{ Toaster \} from 'react-hot-toast';/);
  assert.match(appSource, /import \{ startAppVersionWatcher \} from '\.\/lib\/appVersionWatcher';/);
  assert.match(appSource, /const stopWatchingVersion = startAppVersionWatcher\(\{/);
  assert.match(appSource, /onUpdateAvailable: \(reload\) => \{/);
  assert.match(appSource, /检测到新版本，刷新后可使用最新功能/);
  assert.match(appSource, /reload\(\);/);
  assert.match(appSource, /return stopWatchingVersion;/);
});

test('App exposes nested admin dashboard and templates routes', () => {
  assert.match(appSource, /<Route path="\/admin" element=\{<AdminShell \/>\}>/);
  assert.match(appSource, /<Route index element=\{<Navigate to="dashboard" replace \/>\} \/>/);
  assert.match(appSource, /<Route path="dashboard" element=\{<AdminDashboardPage \/>\} \/>/);
  assert.match(appSource, /<Route path="templates" element=\{<AdminTemplatesPage \/>\} \/>/);
});
