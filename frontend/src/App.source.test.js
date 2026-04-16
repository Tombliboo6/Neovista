import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');

test('App lazy-loads non-home routes', () => {
  assert.match(appSource, /const Workspace = lazy\(\(\) => import\('.\/components\/workspace\/Workspace'\)\);/);
  assert.match(appSource, /const AdminPage = lazy\(\(\) => import\('.\/components\/admin\/AdminPage'\)\);/);
  assert.match(appSource, /<Suspense fallback=/);
  assert.doesNotMatch(appSource, /import Workspace from '\.\/components\/workspace\/Workspace';/);
  assert.doesNotMatch(appSource, /import AdminPage from '\.\/components\/admin\/AdminPage';/);
});

test('App bootstraps auth state on startup', () => {
  assert.match(appSource, /const bootstrapAuth = useAppStore\(\(state\) => state\.bootstrapAuth\);/);
  assert.match(appSource, /useEffect\(\(\) => \{\s*bootstrapAuth\(\);/);
});
