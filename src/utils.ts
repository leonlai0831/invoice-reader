import type { ToastType, InvoiceRow } from './types';
import { BANK_LABELS } from './constants';
import * as state from './state';

// ── ID Generation ────────────────────────────────────────────────

export function generateId(): string {
  const ts = Date.now();
  const r = Math.random().toString(36).substring(2, 8);
  return `inv_${ts}_${r}`;
}

// ── HTML Escaping ────────────────────────────────────────────────

export function esc(s: unknown): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Toast Notifications ─────────────────────────────────────────

export function showToast(msg: string, type: ToastType = 'info', duration = 4000): void {
  const icons: Record<string, string> = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span class="toast-msg">${esc(msg)}</span><button class="toast-close" onclick="this.parentElement.remove()">✕</button><div class="toast-progress" style="animation:toastProgress ${duration}ms linear forwards"></div>`;
  container.appendChild(el);
  setTimeout(() => { el.classList.add('removing'); setTimeout(() => el.remove(), 250); }, duration);
}

// ── Confirm Dialog ──────────────────────────────────────────────

export function showConfirm(msg: string, onYes: () => void, title?: string, icon?: string, btnClass?: string): void {
  const msgEl = document.getElementById('confirm-msg');
  const titleEl = document.getElementById('confirm-title');
  const iconEl = document.getElementById('confirm-icon');
  const yesBtn = document.getElementById('confirm-yes-btn');
  if (msgEl) msgEl.innerHTML = msg;
  if (titleEl) titleEl.textContent = title || '确认操作';
  if (iconEl) iconEl.textContent = icon || '⚠️';
  if (yesBtn) yesBtn.className = 'btn btn-sm ' + (btnClass || 'btn-pri');
  state.setConfirmCallback(onYes);
  document.getElementById('confirm-modal')?.classList.add('show');
  // Focus the confirm button for keyboard accessibility
  setTimeout(() => {
    const yesBtn = document.getElementById('confirm-yes-btn');
    if (yesBtn) yesBtn.focus();
  }, 50);
}

export function closeConfirm(yes: boolean): void {
  document.getElementById('confirm-modal')?.classList.remove('show');
  if (yes && state.confirmCallback) state.confirmCallback();
  state.setConfirmCallback(null);
}

// ── Currency Conversion ─────────────────────────────────────────

export function convertToMYR(amount: string | number, currency: string): number {
  const n = parseFloat(String(amount).replace(/[^0-9.]/g, ''));
  if (isNaN(n) || !currency || currency === 'MYR') return n;
  return +(n * (state.rates[currency] || 1)).toFixed(2);
}

// ── Date Helpers ────────────────────────────────────────────────

export function todayStr(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// ── Filename Helpers ────────────────────────────────────────────

export function extractBaseFileName(path: string): string {
  if (!path) return '';
  let name = path.split(/[/\\]/).pop() || '';
  name = name.replace(/^\d{10,}_/, '');
  return name.trim().toLowerCase();
}

// ── Invoice Number Normalization ────────────────────────────────

export function normalizeInvNo(s: string): string {
  return (s || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

// ── Open External Link ──────────────────────────────────────────

export function openExternal(url: string): void {
  // For local file URLs (e.g. /api/file/...), open in browser via backend
  // For absolute URLs, use backend to ensure pywebview compat
  if (url.startsWith('/api/') || url.startsWith('http')) {
    fetch('/api/open-external', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'InvoiceReader' },
      body: JSON.stringify({ url }),
    }).catch(() => {
      // Fallback to window.open if backend route doesn't exist
      window.open(url, '_blank');
    });
  } else {
    window.open(url, '_blank');
  }
}

// ── Image Modal ─────────────────────────────────────────────────

export function closeImgModal(): void {
  document.getElementById('img-modal')?.classList.remove('show');
}

export function showImg(src: string): void {
  const img = document.getElementById('img-preview') as HTMLImageElement | null;
  if (img) img.src = src;
  document.getElementById('img-modal')?.classList.add('show');
}

// ── Validation ──────────────────────────────────────────────────

export function validateAmount(val: string): { valid: boolean; cleaned: string } {
  const cleaned = String(val || '').replace(/,/g, '').trim();
  const n = parseFloat(cleaned);
  if (cleaned === '' || cleaned === '-') return { valid: true, cleaned: '' };
  if (isNaN(n) || n < 0) return { valid: false, cleaned };
  return { valid: true, cleaned: n.toFixed(2) };
}

export function validateDate(val: string): { valid: boolean; normalized: string } {
  const s = (val || '').trim();
  if (!s) return { valid: true, normalized: '' };
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return { valid: false, normalized: s };
  const d = parseInt(m[1]), mo = parseInt(m[2]), y = parseInt(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2099) return { valid: false, normalized: s };
  const dt = new Date(y, mo - 1, d);
  if (dt.getDate() !== d || dt.getMonth() !== mo - 1) return { valid: false, normalized: s };
  return { valid: true, normalized: `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}` };
}

// ── Parse Amount ────────────────────────────────────────────────

export function parseAmt(r: InvoiceRow): number {
  const n = parseFloat(String(r.amount || 0).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ── Bank Label ──────────────────────────────────────────────────

export function bankLabel(bank: string | undefined): string {
  if (!bank) return 'CC';
  return BANK_LABELS[bank.toLowerCase()] || bank;
}

// ── WeChat Related Check ────────────────────────────────────────

export function isWechatRelated(desc: string): boolean {
  if (!desc) return false;
  const d = desc.toLowerCase();
  return d.includes('wechat') || d.includes('weixin') || d.includes('wei xin')
    || d.includes('wx') || d.includes('tenpay') || d.includes('微信');
}
