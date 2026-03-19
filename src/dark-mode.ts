// ── Dark/Light Mode ─────────────────────────────────────────────

const THEME_KEY = 'invoice-reader-theme';

export type Theme = 'dark' | 'light';

export function getPreferredTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  updateToggleIcon(theme);
}

export function toggleTheme(): void {
  const current = document.documentElement.getAttribute('data-theme') as Theme || 'dark';
  setTheme(current === 'dark' ? 'light' : 'dark');
}

function updateToggleIcon(theme: Theme): void {
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

export function initDarkMode(): void {
  const theme = getPreferredTheme();
  setTheme(theme);

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    if (!localStorage.getItem(THEME_KEY)) {
      setTheme(e.matches ? 'light' : 'dark');
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

  // Insert before settings button
  const settingsBtn = actions.querySelector('[onclick*="showModal"], [data-action="settings"]') || actions.firstChild;
  if (settingsBtn) actions.insertBefore(btn, settingsBtn);
  else actions.appendChild(btn);

  updateToggleIcon(getPreferredTheme());
}
