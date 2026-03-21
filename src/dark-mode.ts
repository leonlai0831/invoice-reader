// ── Dark/Light Mode ─────────────────────────────────────────────

const THEME_KEY = 'invoice-reader-theme';

export type Theme = 'dark' | 'light';

export function getPreferredTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function setTheme(theme: Theme, persist = true): void {
  document.documentElement.setAttribute('data-theme', theme);
  if (persist) localStorage.setItem(THEME_KEY, theme);
  updateToggleIcon(theme);
}

export function toggleTheme(): void {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'dark') {
    setTheme('light');
  } else if (stored === 'light') {
    // Switch to system mode
    localStorage.removeItem(THEME_KEY);
    const systemTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    setTheme(systemTheme, false);
    updateToggleIcon('system');
  } else {
    // Currently system -> switch to dark
    setTheme('dark');
  }
}

function updateToggleIcon(theme: Theme | 'system'): void {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  if (theme === 'system') {
    btn.textContent = '💻';
    btn.title = '跟随系统 — 点击切换到深色';
  } else if (theme === 'dark') {
    btn.textContent = '☀️';
    btn.title = '深色模式 — 点击切换到浅色';
  } else {
    btn.textContent = '🌙';
    btn.title = '浅色模式 — 点击跟随系统';
  }
}

export function initDarkMode(): void {
  const stored = localStorage.getItem(THEME_KEY);
  const theme = getPreferredTheme();
  setTheme(theme, !!stored);  // only persist if user previously chose manually
  if (!stored) updateToggleIcon('system');

  // Listen for system theme changes (only when user hasn't manually chosen)
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    if (!localStorage.getItem(THEME_KEY)) {
      setTheme(e.matches ? 'light' : 'dark', false);
    }
  });
}

// ── Create theme toggle button ──────────────────────────────────

export function createThemeToggle(): void {
  const actions = document.querySelector('.hdr-actions');
  if (!actions) return;

  const btn = document.createElement('button');
  btn.id = 'theme-toggle';
  btn.className = 'btn btn-ghost btn-sm';
  btn.title = '切换亮/暗色模式';
  btn.addEventListener('click', toggleTheme);

  // Insert before settings button (must be a direct child of actions)
  const settingsBtn = actions.querySelector(':scope > [onclick*="showModal"], :scope > [data-action="settings"]') || actions.firstChild;
  if (settingsBtn && settingsBtn.parentNode === actions) actions.insertBefore(btn, settingsBtn);
  else actions.prepend(btn);

  updateToggleIcon(getPreferredTheme());
}
