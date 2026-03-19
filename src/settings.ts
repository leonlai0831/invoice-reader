import * as state from './state';
import * as api from './api';
import { BRANCHES, CUR_INFO } from './constants';
import { esc, showToast } from './utils';

// ── Settings Modal ──────────────────────────────────────────────

export function showModal(): void {
  const fi = document.getElementById('folder-input') as HTMLInputElement | null;
  if (fi) fi.value = state.claimsFolder || '';
  document.getElementById('modal')?.classList.add('show');
  loadBranchAddresses();
  renderMemoryStats();
  loadPortableStatus();
  setTimeout(() => {
    const first = document.querySelector('#modal.show input, #modal.show select, #modal.show button') as HTMLElement | null;
    if (first) first.focus();
  }, 100);
}

export function closeModal(): void {
  document.getElementById('modal')?.classList.remove('show');
}

export async function saveSettings(): Promise<void> {
  try {
    const key = (document.getElementById('api-key-input') as HTMLInputElement)?.value.trim();
    if (key) {
      const r = await api.saveConfig({ api_key: key });
      if (!r.ok) showToast('保存 API Key 失败', 'error');
    }
    await saveBranchAddresses();
    closeModal();
  } catch (e: any) { showToast('保存设置失败: ' + e.message, 'error'); }
}

// ── Portable Mode ───────────────────────────────────────────────

async function loadPortableStatus(): Promise<void> {
  try {
    const d = await api.getPortable();
    state.setPortableMode(d.portable);
    const tog = document.getElementById('portable-toggle') as HTMLInputElement | null;
    if (tog) tog.checked = state.portableMode;
    const lbl = document.getElementById('portable-label');
    if (lbl) lbl.textContent = state.portableMode ? '已开启 — 配置存储在 exe 目录' : '关闭';
  } catch { }
}

export async function togglePortableMode(enabled: boolean): Promise<void> {
  try {
    const d = await api.setPortable(enabled);
    if (d.ok) {
      state.setPortableMode(enabled);
      const lbl = document.getElementById('portable-label');
      if (lbl) lbl.textContent = enabled ? '已开启 — 配置存储在 exe 目录' : '关闭';
      showToast(enabled ? '☁️ 便携模式已开启' : '便携模式已关闭', 'success');
      loadFolderSetting();
    }
  } catch (e: any) { showToast('切换便携模式失败: ' + e.message, 'error'); }
}

// ── Folder ──────────────────────────────────────────────────────

export async function loadFolderSetting(): Promise<void> {
  try {
    const d = await api.getFolder();
    if (d.ok) state.setClaimsFolder(d.path || '');
    const inp = document.getElementById('folder-input') as HTMLInputElement | null;
    if (inp) inp.value = state.claimsFolder || '';
    const scanPath = document.getElementById('scan-path');
    if (scanPath) scanPath.textContent = state.claimsFolder ? state.claimsFolder + '\\New Claim' : '未设置路径 — 请先在设置中选择文件夹';
    const st = document.getElementById('folder-status');
    if (st) st.textContent = state.claimsFolder ? '✅ 已设置' : '';
  } catch { }
}

export async function browseFolderPicker(): Promise<void> {
  try {
    const d = await api.browseFolder();
    if (d.ok) {
      state.setClaimsFolder(d.path);
      const inp = document.getElementById('folder-input') as HTMLInputElement | null;
      if (inp) inp.value = state.claimsFolder;
      const st = document.getElementById('folder-status');
      if (st) st.textContent = '✅ 已设置';
      const scanPath = document.getElementById('scan-path');
      if (scanPath) scanPath.textContent = state.claimsFolder + '\\New Claim';
    }
  } catch (e: any) { showToast('浏览文件夹失败: ' + e.message, 'error'); }
}

// ── Rates ───────────────────────────────────────────────────────

export async function loadRates(): Promise<void> {
  try {
    const d = await api.getRates();
    if (d.ok) { state.setRates(d.rates); state.setRatesLive(d.live); }
  } catch { }
  renderRates();
}

export function renderRates(): void {
  const strip = document.getElementById('rate-strip');
  const detail = document.getElementById('rate-detail-row');
  const loading = document.getElementById('rate-loading');
  if (loading) loading.remove();


  let stripHtml = '';
  let detailHtml = '';
  ['USD', 'CNY', 'SGD', 'EUR', 'GBP'].forEach((c: string) => {
    const info = CUR_INFO[c];
    stripHtml += `<span class="rate-item"><span style="color:${info.color};font-weight:700">${c}</span><span style="color:var(--txt);font-weight:600">= RM ${state.rates[c]?.toFixed(4)}</span></span>`;
    detailHtml += `<div class="rate-item-lg"><span style="font-size:14px">${info.flag}</span><span style="font-weight:600;color:${info.color}">${c}</span><span style="color:var(--muted)">\u2192</span><span style="font-weight:700;color:var(--txt)">RM ${state.rates[c]?.toFixed(4)}</span></div>`;
  });
  if (!state.ratesLive) stripHtml += `<span style="color:#f97316;font-size:10px">\u26A0 估算汇率</span>`;
  if (strip) strip.innerHTML = stripHtml;
  if (detail) detail.innerHTML = detailHtml;
  const banner = document.getElementById('rate-warning-banner');
  if (banner) banner.classList.toggle('visible', !state.ratesLive);
}

// ── Memory ──────────────────────────────────────────────────────

export async function loadMemory(): Promise<void> {
  try {
    const d = await api.getMemory();
    if (d.ok) {
      state.setMemoryData({
        suppliers: d.suppliers || {},
        customSuppliers: d.customSuppliers || [],
        customDescriptions: d.customDescriptions || {},
      });
    }
  } catch (e) { console.error('loadMemory error:', e); }
}

export async function checkApiKey(): Promise<void> {
  try {
    const d = await api.getConfig();
    if (!d.has_key) setTimeout(showModal, 600);
  } catch (e) { console.warn('checkApiKey failed:', e); }
}

// ── Branch Addresses ────────────────────────────────────────────

async function loadBranchAddresses(): Promise<void> {
  try {
    const d = await api.getBranchAddresses();
    if (d.ok) state.setBranchAddresses(d.branchAddresses || {});
  } catch (e) { console.error('loadBranchAddresses error:', e); }
  renderBranchAddresses();
}

function renderBranchAddresses(): void {
  const container = document.getElementById('branch-addr-list');
  if (!container) return;
  const entries = Object.entries(state.branchAddresses);
  if (entries.length === 0) {
    container.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0">尚未设置。点击下方按钮添加分店地址。</div>';
    return;
  }
  container.innerHTML = entries.map(([code, addr]) => `
    <div class="branch-addr-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <select class="branch-addr-code" style="width:80px;flex-shrink:0" data-addr-old-code="${esc(code)}">
        ${BRANCHES.map(b => `<option ${b === code ? 'selected' : ''}>${b}</option>`).join('')}
      </select>
      <input class="branch-addr-val" value="${esc(addr)}" placeholder="分店物理地址..." style="flex:1" data-addr-code="${esc(code)}">
      <button class="btn btn-danger btn-sm" data-addr-remove="${esc(code)}" style="padding:4px 8px;font-size:11px">\u2715</button>
    </div>
  `).join('');

  // Event delegation
  container.addEventListener('change', (e) => {
    const target = e.target as HTMLElement;
    const oldCode = target.getAttribute('data-addr-old-code');
    if (oldCode) {
      const newCode = (target as HTMLSelectElement).value;
      if (newCode !== oldCode) {
        const addr = state.branchAddresses[oldCode] || '';
        delete state.branchAddresses[oldCode];
        state.branchAddresses[newCode] = addr;
        renderBranchAddresses();
      }
      return;
    }
    const addrCode = target.getAttribute('data-addr-code');
    if (addrCode) {
      state.branchAddresses[addrCode] = (target as HTMLInputElement).value;
    }
  });

  container.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('[data-addr-remove]');
    if (target) {
      const code = target.getAttribute('data-addr-remove')!;
      delete state.branchAddresses[code];
      renderBranchAddresses();
    }
  });
}

export function addBranchAddressRow(): void {
  const used = new Set(Object.keys(state.branchAddresses));
  const available = BRANCHES.find(b => !used.has(b)) || BRANCHES[0];
  state.branchAddresses[available] = '';
  renderBranchAddresses();
}

async function saveBranchAddresses(): Promise<void> {
  try {
    await api.saveBranchAddresses(state.branchAddresses);
  } catch (e) { console.error('saveBranchAddresses error:', e); }
}

export async function rebuildMemory(): Promise<void> {
  const btn = document.getElementById('rebuild-memory-btn') as HTMLButtonElement | null;
  const status = document.getElementById('memory-status');
  if (btn) btn.disabled = true;
  if (status) status.textContent = '正在重建...';
  try {
    const d = await api.rebuildMemoryApi();
    if (d.ok) {
      if (status) status.textContent = `✅ 重建完成！处理了 ${d.rowsProcessed} 条记录。`;
      await loadMemory();
    } else {
      if (status) status.textContent = '❌ ' + (d.error || '重建失败');
    }
  } catch (e: any) {
    if (status) status.textContent = '❌ 错误: ' + e.message;
  }
  if (btn) btn.disabled = false;
}

export function renderMemoryStats(): void {
  const el = document.getElementById('memory-stats');
  if (!el) return;
  const s = state.memoryData.suppliers || {};
  const supplierCount = Object.keys(s).length;
  const customCount = (state.memoryData.customSuppliers || []).length;
  const descCount = Object.values(state.memoryData.customDescriptions || {}).reduce((sum, arr) => sum + arr.length, 0);
  if (supplierCount === 0) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted)">暂无学习数据。提交 Claim 后系统将自动学习。</div>';
    return;
  }
  const sorted = Object.entries(s).sort((a, b) => (b[1].count || 0) - (a[1].count || 0)).slice(0, 8);
  let html = `<div style="font-size:12px;color:var(--muted);margin-bottom:8px">已学习 <strong style="color:var(--txt)">${supplierCount}</strong> 个供应商 · <strong style="color:var(--txt)">${customCount}</strong> 个自定义供应商 · <strong style="color:var(--txt)">${descCount}</strong> 个自定义描述</div>`;
  html += '<div style="max-height:200px;overflow-y:auto;border:1px solid var(--bdr);border-radius:8px;padding:8px">';
  sorted.forEach(([name, data]) => {
    const cats = data.categories || {};
    const topCat = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
    const branches = data.branches || {};
    const topBranch = Object.entries(branches).sort((a, b) => b[1] - a[1])[0];
    html += `<div style="padding:4px 0;border-bottom:1px solid var(--bdr);font-size:11px">`;
    html += `<span style="color:var(--txt);font-weight:600">${esc(name)}</span> <span style="color:var(--muted)">×${data.count || 0}</span>`;
    if (topCat) html += ` → <span style="color:var(--acc)">${esc(topCat[0])}</span>`;
    if (topBranch) html += ` @ <span style="color:var(--green)">${esc(topBranch[0])}</span>`;
    html += `</div>`;
  });
  html += '</div>';
  el.innerHTML = html;
}
