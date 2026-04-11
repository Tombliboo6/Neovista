export const THEME_STORAGE_KEY = 'neovista-theme';
export const DEFAULT_THEME = 'dark';

export function normalizeThemePreference(theme) {
  return theme === 'light' ? 'light' : DEFAULT_THEME;
}

export function getStoredThemePreference(storage = globalThis?.localStorage) {
  try {
    return normalizeThemePreference(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function persistThemePreference(theme, storage = globalThis?.localStorage) {
  const normalizedTheme = normalizeThemePreference(theme);

  try {
    storage?.setItem(THEME_STORAGE_KEY, normalizedTheme);
  } catch {
    return normalizedTheme;
  }

  return normalizedTheme;
}

export function applyThemePreference(theme, root = globalThis?.document?.documentElement) {
  const normalizedTheme = normalizeThemePreference(theme);

  if (!root) {
    return normalizedTheme;
  }

  root.dataset.theme = normalizedTheme;
  root.style.colorScheme = normalizedTheme;
  return normalizedTheme;
}
