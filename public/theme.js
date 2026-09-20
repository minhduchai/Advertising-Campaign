export const THEME_STORAGE_KEY = 'meta-campaign-theme';

const THEME_COLORS = {
  dark: '#0f172a',
  light: '#f6f8fc'
};

export function resolveTheme({ storedTheme, prefersDark }) {
  if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme;
  return prefersDark ? 'dark' : 'light';
}

export function applyTheme(theme, { root, themeColorMeta } = {}) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  if (root) root.dataset.theme = nextTheme;
  if (themeColorMeta) themeColorMeta.content = THEME_COLORS[nextTheme];
  return nextTheme;
}

function readStoredTheme(storage) {
  try {
    return storage?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStoredTheme(storage, theme) {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The selected theme still applies for this page when storage is blocked.
  }
}

function updateButton(button, theme) {
  if (!button) return;
  const nextThemeLabel = theme === 'dark' ? 'sáng' : 'tối';
  const label = `Chuyển sang chế độ ${nextThemeLabel}`;
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  const icon = button.querySelector('[data-theme-icon]');
  if (icon) {
    icon.innerHTML = theme === 'dark'
      ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"></path></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M20.4 14.7A8 8 0 0 1 9.3 3.6 8.5 8.5 0 1 0 20.4 14.7Z"></path></svg>';
  }
  button.querySelector('[data-theme-label]').textContent = label;
}

export function initializeThemeToggle({ root, button, storage, mediaQuery, themeColorMeta }) {
  let storedTheme = readStoredTheme(storage);
  let currentTheme = applyTheme(resolveTheme({ storedTheme, prefersDark: Boolean(mediaQuery?.matches) }), {
    root,
    themeColorMeta
  });
  updateButton(button, currentTheme);

  const handleClick = () => {
    currentTheme = applyTheme(currentTheme === 'dark' ? 'light' : 'dark', { root, themeColorMeta });
    storedTheme = currentTheme;
    writeStoredTheme(storage, currentTheme);
    updateButton(button, currentTheme);
  };
  const handleSystemChange = (event) => {
    if (storedTheme === 'light' || storedTheme === 'dark') return;
    currentTheme = applyTheme(event.matches ? 'dark' : 'light', { root, themeColorMeta });
    updateButton(button, currentTheme);
  };

  button?.addEventListener('click', handleClick);
  mediaQuery?.addEventListener?.('change', handleSystemChange);

  return () => {
    button?.removeEventListener('click', handleClick);
    mediaQuery?.removeEventListener?.('change', handleSystemChange);
  };
}
