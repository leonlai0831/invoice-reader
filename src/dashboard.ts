import * as state from './state';
import { CHART_COLORS } from './constants';
import { parseAmt } from './utils';
import type { InvoiceRow } from './types';

declare const Chart: any;

// ── Dashboard ───────────────────────────────────────────────────

export function resetDashDates(): void {
  (document.getElementById('dash-from') as HTMLInputElement).value = '';
  (document.getElementById('dash-to') as HTMLInputElement).value = '';
  renderDashboard();
}

function getFilteredDashRows(): InvoiceRow[] {
  const from = (document.getElementById('dash-from') as HTMLInputElement)?.value;
  const to = (document.getElementById('dash-to') as HTMLInputElement)?.value;
  return state.rows.filter(r => {
    if (!from && !to) return true;
    const parts = (r.invoiceDate || '').split('/');
    if (parts.length !== 3) return !from && !to;
    const d = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function destroyChart(id: string): void {
  if (state.chartInstances[id]) { state.chartInstances[id].destroy(); delete state.chartInstances[id]; }
}

// Theme-aware chart colors
function getChartTextColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--txt').trim() || '#e2e8f0';
}

function getChartMutedColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#64748b';
}

function getChartGridColor(): string {
  const theme = document.documentElement.getAttribute('data-theme');
  return theme === 'light' ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.05)';
}

export function renderDashboard(): void {
  const data = getFilteredDashRows();
  const textColor = getChartTextColor();
  const mutedColor = getChartMutedColor();
  const gridColor = getChartGridColor();

  const totalAmt = data.reduce((s, r) => s + parseAmt(r), 0);
  const cats = new Set(data.map(r => r.category).filter(Boolean));
  const avg = data.length ? totalAmt / data.length : 0;

  const dashStats = document.getElementById('dash-stats');
  if (dashStats) {
    dashStats.innerHTML = data.length === 0
      ? `<div class="dash-empty" style="width:100%"><div class="icon">📊</div><h3>暂无数据</h3><p>上传发票后即可查看统计</p></div>`
      : `
      <div class="dash-stat-card accent"><div class="dash-stat-val">${data.length}</div><div class="dash-stat-label">张发票</div></div>
      <div class="dash-stat-card green"><div class="dash-stat-val">RM ${totalAmt.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div class="dash-stat-label">总金额</div></div>
      <div class="dash-stat-card blue"><div class="dash-stat-val">RM ${avg.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div class="dash-stat-label">平均每张</div></div>
      <div class="dash-stat-card purple"><div class="dash-stat-val">${cats.size}</div><div class="dash-stat-label">类别数</div></div>
    `;
  }

  if (data.length === 0) {
    ['chart-category', 'chart-branch', 'chart-monthly', 'chart-suppliers'].forEach(id => {
      const c = document.getElementById(id);
      if (c?.parentElement?.parentElement) c.parentElement.parentElement.style.display = 'none';
    });
    return;
  }

  ['chart-category', 'chart-branch', 'chart-monthly', 'chart-suppliers'].forEach(id => {
    const c = document.getElementById(id);
    if (c?.parentElement?.parentElement) c.parentElement.parentElement.style.display = '';
  });

  renderCategoryChart(data, textColor, mutedColor, gridColor);
  renderBranchChart(data, textColor, mutedColor, gridColor);
  renderMonthlyChart(data, textColor, mutedColor, gridColor);
  renderSuppliersChart(data, textColor, mutedColor, gridColor);
}

function renderCategoryChart(data: InvoiceRow[], textColor: string, mutedColor: string, gridColor: string): void {
  destroyChart('category');
  const agg: Record<string, number> = {};
  data.forEach(r => { const cat = r.category || '未分类'; agg[cat] = (agg[cat] || 0) + parseAmt(r); });
  const sorted = Object.entries(agg).sort((a, b) => b[1] - a[1]);
  const ctx = (document.getElementById('chart-category') as HTMLCanvasElement)?.getContext('2d');
  if (!ctx) return;
  state.chartInstances['category'] = new Chart(ctx, {
    type: 'bar',
    data: { labels: sorted.map(e => e[0]), datasets: [{ data: sorted.map(e => e[1]), backgroundColor: CHART_COLORS.slice(0, sorted.length), borderRadius: 4 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => 'RM ' + c.raw.toLocaleString('en-MY', { minimumFractionDigits: 2 }) } } },
      scales: { x: { ticks: { callback: (v: number) => 'RM ' + v.toLocaleString(), color: mutedColor, font: { size: 10 } }, grid: { color: gridColor } }, y: { ticks: { color: textColor, font: { size: 11 } }, grid: { display: false } } },
    },
  });
}

function renderBranchChart(data: InvoiceRow[], textColor: string, mutedColor: string, gridColor: string): void {
  destroyChart('branch');
  const agg: Record<string, number> = {};
  data.forEach(r => { const br = r.branch || '未分配'; agg[br] = (agg[br] || 0) + parseAmt(r); });
  const sorted = Object.entries(agg).sort((a, b) => b[1] - a[1]);
  const ctx = (document.getElementById('chart-branch') as HTMLCanvasElement)?.getContext('2d');
  if (!ctx) return;
  state.chartInstances['branch'] = new Chart(ctx, {
    type: 'bar',
    data: { labels: sorted.map(e => e[0]), datasets: [{ data: sorted.map(e => e[1]), backgroundColor: CHART_COLORS.slice(0, sorted.length), borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => 'RM ' + c.raw.toLocaleString('en-MY', { minimumFractionDigits: 2 }) } } },
      scales: { y: { ticks: { callback: (v: number) => 'RM ' + v.toLocaleString(), color: mutedColor, font: { size: 10 } }, grid: { color: gridColor } }, x: { ticks: { color: textColor, font: { size: 11 } }, grid: { display: false } } },
    },
  });
}

function renderMonthlyChart(data: InvoiceRow[], textColor: string, _mutedColor: string, gridColor: string): void {
  destroyChart('monthly');
  const agg: Record<string, number> = {};
  data.forEach(r => {
    const parts = (r.invoiceDate || '').split('/');
    if (parts.length !== 3) return;
    const key = `${parts[2]}-${parts[1].padStart(2, '0')}`;
    agg[key] = (agg[key] || 0) + parseAmt(r);
  });
  const sorted = Object.entries(agg).sort((a, b) => a[0].localeCompare(b[0]));
  const ctx = (document.getElementById('chart-monthly') as HTMLCanvasElement)?.getContext('2d');
  if (!ctx) return;
  state.chartInstances['monthly'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: sorted.map(e => e[0]),
      datasets: [{ data: sorted.map(e => e[1]), borderColor: '#4f6ef7', backgroundColor: 'rgba(79,110,247,.15)', fill: true, tension: .3, pointRadius: 4, pointBackgroundColor: '#4f6ef7' }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => 'RM ' + c.raw.toLocaleString('en-MY', { minimumFractionDigits: 2 }) } } },
      scales: { y: { ticks: { callback: (v: number) => 'RM ' + v.toLocaleString(), color: _mutedColor, font: { size: 10 } }, grid: { color: gridColor } }, x: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } } },
    },
  });
}

function renderSuppliersChart(data: InvoiceRow[], textColor: string, mutedColor: string, gridColor: string): void {
  destroyChart('suppliers');
  const agg: Record<string, number> = {};
  data.forEach(r => { const s = r.supplierName || '未知'; agg[s] = (agg[s] || 0) + parseAmt(r); });
  const sorted = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const ctx = (document.getElementById('chart-suppliers') as HTMLCanvasElement)?.getContext('2d');
  if (!ctx) return;
  state.chartInstances['suppliers'] = new Chart(ctx, {
    type: 'bar',
    data: { labels: sorted.map(e => e[0].length > 25 ? e[0].substring(0, 25) + '…' : e[0]), datasets: [{ data: sorted.map(e => e[1]), backgroundColor: CHART_COLORS.slice(0, sorted.length), borderRadius: 4 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => 'RM ' + c.raw.toLocaleString('en-MY', { minimumFractionDigits: 2 }) } } },
      scales: { x: { ticks: { callback: (v: number) => 'RM ' + v.toLocaleString(), color: mutedColor, font: { size: 10 } }, grid: { color: gridColor } }, y: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } } },
    },
  });
}
