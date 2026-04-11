import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_THEME,
  applyThemePreference,
  getStoredThemePreference,
  normalizeThemePreference,
  persistThemePreference,
} from './themeState.js';

test('normalizeThemePreference falls back to the default dark theme', () => {
  assert.equal(DEFAULT_THEME, 'dark');
  assert.equal(normalizeThemePreference('light'), 'light');
  assert.equal(normalizeThemePreference('dark'), 'dark');
  assert.equal(normalizeThemePreference('unknown'), 'dark');
});

test('getStoredThemePreference reads and normalizes persisted values', () => {
  const storage = {
    value: 'light',
    getItem(key) {
      assert.equal(key, 'neovista-theme');
      return this.value;
    },
  };

  assert.equal(getStoredThemePreference(storage), 'light');
  storage.value = 'nope';
  assert.equal(getStoredThemePreference(storage), 'dark');
});

test('persistThemePreference stores the normalized theme and applyThemePreference updates the document root', () => {
  const writes = [];
  const storage = {
    setItem(key, value) {
      writes.push([key, value]);
    },
  };
  const root = {
    dataset: {},
    style: {},
  };

  persistThemePreference('light', storage);
  applyThemePreference('light', root);

  assert.deepEqual(writes, [['neovista-theme', 'light']]);
  assert.equal(root.dataset.theme, 'light');
  assert.equal(root.style.colorScheme, 'light');
});
