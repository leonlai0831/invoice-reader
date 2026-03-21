import * as state from './state';
import * as api from './api';
import { BRANCHES, CATEGORIES, CUR_INFO, SUPPLIERS, ALL_DESC, DESC_BY_CAT } from './constants';
import { esc, showToast, showConfirm, convertToMYR, validateAmount, validateDate, parseAmt, openExternal } from './utils';
import type { InvoiceRow, SortDirection, EditableRowKey } from './types';
import { scheduleSave } from './upload';
import { switchTab } from './main-helpers';
import { pushUndo } from './undo';
import { manualAssignCC } from './cc-ledger';

// ── Date Format Converters ────────────────────────────────────────

function ddmmyyyyToIso(d: string): string {
  if (!d) return '';
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function isoToDdmmyyyy(d: string): string {
  if (!d) return '';
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// ── Memory Merge ────────────────────────────────────────────────

export function getMergedSuppliers(): string[] {
  const s = new Set(SUPPLIERS.map(x => x.toUpperCase()));
  Object.keys(state.memoryData.suppliers).forEach(k => s.add(k.toUpperCase()));
  (state.memoryData.customSuppliers || []).forEach(k => s.add(k.toUpperCase()));
  return [...s].sort();
}

export function getMergedDescriptions(category: string): string[] {
  const hardcoded = category && DESC_BY_CAT[category] ? DESC_BY_CAT[category] : ALL_DESC;
  const custom = category && state.memoryData.customDescriptions[category] ? state.memoryData.customDescriptions[category] : [];
  const merged = new Set([...hardcoded, ...custom]);
  return [...merged].sort();
}

// ── Row update helpers ──────────────────────────────────────────

export function updateField(id: string, key: EditableRowKey, val: string): void {
  const row = state.getRow(id);
  if (!row) return;
  const oldVal = row[key];
  row[key] = val;
  row.modifiedAt = new Date().toISOString();

  // Clear validation error highlight when user edits a field
  const rowEl = document.querySelector(`tr[data-id="${id}"]`);
  if (rowEl) rowEl.classList.remove('row-validation-error');

  // Push undo entry
  pushUndo({
    type: 'field',
    description: `${key} → "${val}"`,
    undo: () => { row[key] = oldVal; row.modifiedAt = new Date().toISOString(); renderTable(); scheduleSave(); },
    redo: () => { row[key] = val; row.modifiedAt = new Date().toISOString(); renderTable(); scheduleSave(); },
  });

  if (key === 'category') rerenderDescList(id);
  scheduleSave();
}

export function updateCurrency(id: string, newCur: string): void {
  const row = state.getRow(id);
  if (!row) return;
  const oldCur = row.originalCurrency;
  const oldAmt = row.amount;
  const oldDesc = row.description;

  row.originalCurrency = newCur;
  const isForeign = newCur !== 'MYR';
  const src = row.originalAmount || row.amount;
  const myr = isForeign ? convertToMYR(src, newCur) : parseFloat(String(src).replace(/[^0-9.]/g, '') || '0');
  const base = row.description.replace(/\s*\([A-Z]{3}\s+[\d.]+(?:\s*@\s*[\d.]+)?\)$/, '');
  row.description = (isForeign && src) ? `${base} (${newCur} ${parseFloat(String(src).replace(/[^0-9.]/g, '') || '0').toFixed(2)})` : base;
  row.amount = isNaN(myr) ? row.amount : myr.toFixed(2);

  const amtInp = document.getElementById('amt-' + id) as HTMLInputElement | null;
  const descInp = document.getElementById('desc-' + id) as HTMLInputElement | null;
  const curSel = document.getElementById('cur-' + id) as HTMLSelectElement | null;
  if (amtInp) amtInp.value = row.amount;
  if (descInp) descInp.value = row.description;
  if (curSel) {
    curSel.className = 'cur-select' + (isForeign ? ' foreign' : '');
    curSel.style.color = isForeign ? (CUR_INFO[newCur]?.color || '') : '';
    curSel.style.borderColor = isForeign ? ((CUR_INFO[newCur]?.color || '') + '66') : '';
  }

  pushUndo({
    type: 'field',
    description: `currency → ${newCur}`,
    undo: () => { row.originalCurrency = oldCur; row.amount = oldAmt; row.description = oldDesc; renderTable(); scheduleSave(); },
    redo: () => { updateCurrency(id, newCur); },
  });

  scheduleSave();
}

export function updateOrigAmt(id: string, val: string): void {
  const row = state.getRow(id);
  if (!row) return;
  row.originalAmount = val;
  const isForeign = row.originalCurrency !== 'MYR';
  if (isForeign) {
    const myr = convertToMYR(val, row.originalCurrency);
    row.amount = isNaN(myr) ? row.amount : myr.toFixed(2);
    const base = row.description.replace(/\s*\([A-Z]{3}\s+[\d.]+(?:\s*@\s*[\d.]+)?\)$/, '');
    row.description = val ? `${base} (${row.originalCurrency} ${parseFloat(String(val).replace(/[^0-9.]/g, '') || '0').toFixed(2)})` : base;
    const amtInp = document.getElementById('amt-' + id) as HTMLInputElement | null;
    const descInp = document.getElementById('desc-' + id) as HTMLInputElement | null;
    if (amtInp) amtInp.value = row.amount;
    if (descInp) descInp.value = row.description;
  }
  scheduleSave();
}

function rerenderDescList(id: string): void {
  const row = state.getRow(id);
  if (!row) return;
  const dl = document.getElementById('dl-' + id);
  if (!dl) return;
  const opts = getMergedDescriptions(row.category);
  dl.innerHTML = opts.map(d => `<option value="${d}">`).join('');
}

export function deleteRow(id: string): void {
  const row = state.getRow(id);
  if (!row) return;
  const label = row.supplierName || row.invoiceNo || row.fileName || '此记录';
  showConfirm(
    `确定删除 <b>${esc(label)}</b>？`,
    () => {
      const idx = state.rows.indexOf(row);
      state.setRows(state.rows.filter(r => r.id !== id));
      state.selectedRows.delete(id);
      updateCounts(); renderTable();
      scheduleSave();
      showToast('已删除', 'success', 2000);
      // Undo: re-insert at same position
      pushUndo({
        type: 'delete',
        description: `删除 ${label}`,
        undo: () => { state.spliceRows(idx, 0, row); updateCounts(); renderTable(); scheduleSave(); },
        redo: () => { state.setRows(state.rows.filter(r => r.id !== id)); updateCounts(); renderTable(); scheduleSave(); },
      });
    },
    '删除确认', '🗑', 'btn-danger',
  );
}

export function updateCounts(): void {
  const n = state.rows.length;
  const rc = document.getElementById('row-count');
  const tc = document.getElementById('tab-cnt');
  const sc = document.getElementById('stat-count');
  const eb = document.getElementById('export-btn') as HTMLButtonElement | null;
  if (rc) rc.textContent = n + ' 张';
  if (tc) tc.textContent = String(n);
  if (sc) sc.textContent = String(n);
  if (eb) eb.disabled = n === 0;
}

// ── Sorting ─────────────────────────────────────────────────────

export function toggleSort(col: string): void {
  if (state.sortCol === col) { state.setSortDir(state.sortDir === 'asc' ? 'desc' : 'asc'); }
  else { state.setSortCol(col); state.setSortDir('asc'); }
  renderTable();
}

function sortRows(arr: InvoiceRow[]): InvoiceRow[] {
  if (!state.sortCol) return arr;
  const col = state.sortCol;
  const dir = state.sortDir;
  return [...arr].sort((a, b) => {
    let va: string | number, vb: string | number;
    const k = col as keyof InvoiceRow;
    if (col === 'amount') {
      va = parseAmt(a); vb = parseAmt(b);
    } else if (col === 'invoiceDate' || col === 'claimDate') {
      const parse = (s: string) => { const p = (s || '').split('/'); return p.length === 3 ? `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}` : s || ''; };
      va = parse(String(a[k] || '')); vb = parse(String(b[k] || ''));
    } else {
      va = String(a[k] || '').toLowerCase(); vb = String(b[k] || '').toLowerCase();
    }
    let cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return dir === 'desc' ? -cmp : cmp;
  });
}

function sortIcon(col: string): string {
  if (state.sortCol !== col) return '<span class="sort-icon" style="opacity:.3"> ⇅</span>';
  return state.sortDir === 'asc'
    ? '<span class="sort-icon" style="color:var(--acc)"> ▲</span>'
    : '<span class="sort-icon" style="color:var(--acc)"> ▼</span>';
}

// ── Selection ───────────────────────────────────────────────────

export function toggleSelectAll(): void {
  const fc = (document.getElementById('filter-cat') as HTMLSelectElement)?.value || '';
  const filtered = state.rows.filter(r => {
    if (state.filterBranches.size > 0 && !state.filterBranches.has(r.branch)) return false;
    if (fc && r.category !== fc) return false;
    return true;
  });
  const allChecked = (document.getElementById('select-all-cb') as HTMLInputElement)?.checked;
  if (allChecked) { filtered.forEach(r => state.selectedRows.add(r.id)); }
  else { filtered.forEach(r => state.selectedRows.delete(r.id)); }
  renderTable();
}

export function toggleSelectRow(id: string): void {
  if (state.selectedRows.has(id)) state.selectedRows.delete(id);
  else state.selectedRows.add(id);
  updateSelectionUI();
}

export function updateSelectionUI(): void {
  const fc = (document.getElementById('filter-cat') as HTMLSelectElement)?.value || '';
  const filtered = state.rows.filter(r => {
    if (state.filterBranches.size > 0 && !state.filterBranches.has(r.branch)) return false;
    if (fc && r.category !== fc) return false;
    return true;
  });
  const allCb = document.getElementById('select-all-cb') as HTMLInputElement | null;
  if (allCb) allCb.checked = filtered.length > 0 && filtered.every(r => state.selectedRows.has(r.id));

  const bar = document.getElementById('selection-bar');
  if (state.selectedRows.size > 0) {
    const selTotal = state.rows.filter(r => state.selectedRows.has(r.id)).reduce((s, r) => s + parseAmt(r), 0);
    const sct = document.getElementById('sel-count-text');
    const stt = document.getElementById('sel-total-text');
    if (sct) sct.textContent = `已选 ${state.selectedRows.size} 张`;
    if (stt) stt.textContent = `RM ${selTotal.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (bar) bar.style.display = 'flex';
    // Hide stats bar action buttons when selection bar is visible
    const statsActions = document.getElementById('stats-actions');
    if (statsActions) statsActions.style.display = 'none';
  } else {
    if (bar) bar.style.display = 'none';
    const statsActions = document.getElementById('stats-actions');
    if (statsActions) statsActions.style.display = '';
  }

  document.querySelectorAll('#tbody tr').forEach(tr => {
    const cb = tr.querySelector('input[type=checkbox]') as HTMLInputElement | null;
    if (cb) tr.classList.toggle('row-selected', cb.checked);
  });
}

export function deleteSelected(): void {
  if (!state.selectedRows.size) return;
  const count = state.selectedRows.size;
  const idsToDelete = new Set(state.selectedRows);
  showConfirm(`确定要删除选中的 <strong>${count}</strong> 条记录吗？`, () => {
    const deletedRows = state.rows.filter(r => idsToDelete.has(r.id));
    state.setRows(state.rows.filter(r => !idsToDelete.has(r.id)));
    state.selectedRows.clear();
    updateCounts(); renderTable(); scheduleSave();
    showToast(`已删除 ${count} 条记录`, 'success');
    pushUndo({
      type: 'bulk',
      description: `删除 ${count} 条记录`,
      undo: () => { state.pushRows(...deletedRows); updateCounts(); renderTable(); scheduleSave(); },
      redo: () => { state.setRows(state.rows.filter(r => !idsToDelete.has(r.id))); updateCounts(); renderTable(); scheduleSave(); },
    });
  }, '删除确认', '🗑', 'btn-danger');
}

// ── Search & Filter ─────────────────────────────────────────────

export function searchRecords(q: string): void {
  state.setRecordSearch(q.toLowerCase().trim());
  renderTable();
}

export function resetFilters(): void {
  state.filterBranches.clear();
  updateBranchFilterUI();
  (document.getElementById('filter-cat') as HTMLSelectElement).value = '';
  const searchEl = document.getElementById('search-records') as HTMLInputElement | null;
  if (searchEl) searchEl.value = '';
  state.setRecordSearch('');
  state.selectedRows.clear();
  renderTable();
}

// ── Branch Multi-Select Filter ──────────────────────────────────

export function initBranchFilterDropdown(): void {
  const dd = document.getElementById('filter-branch-dropdown');
  if (!dd) return;
  let html = '<label class="fb-item"><input type="checkbox" id="fb-all"> <b>全选 / 取消</b></label>';
  BRANCHES.forEach(b => {
    html += `<label class="fb-item"><input type="checkbox" value="${b}"> ${b}</label>`;
  });
  dd.innerHTML = html;

  // Event delegation
  dd.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.id === 'fb-all') {
      toggleAllBranchFilters(target.checked);
    } else if (target.value) {
      toggleBranchFilterItem(target.value, target.checked);
    }
  });
}

export function toggleBranchFilter(): void {
  const dd = document.getElementById('filter-branch-dropdown');
  if (!dd) return;
  const show = dd.style.display === 'none';
  dd.style.display = show ? 'block' : 'none';
  if (show) {
    setTimeout(() => document.addEventListener('click', closeBranchFilterOutside), 0);
  } else {
    document.removeEventListener('click', closeBranchFilterOutside);
  }
}

function closeBranchFilterOutside(e: Event): void {
  const wrap = document.getElementById('filter-branch-wrap');
  if (wrap && !wrap.contains(e.target as Node)) {
    const dd = document.getElementById('filter-branch-dropdown');
    if (dd) dd.style.display = 'none';
    document.removeEventListener('click', closeBranchFilterOutside);
  }
}

function toggleBranchFilterItem(branch: string, checked: boolean): void {
  if (checked) state.filterBranches.add(branch);
  else state.filterBranches.delete(branch);
  updateBranchFilterUI();
  state.selectedRows.clear();
  renderTable();
}

function toggleAllBranchFilters(checked: boolean): void {
  if (checked) BRANCHES.forEach(b => state.filterBranches.add(b));
  else state.filterBranches.clear();
  document.querySelectorAll('#filter-branch-dropdown input[type=checkbox][value]').forEach((cb: any) => { cb.checked = checked; });
  updateBranchFilterUI();
  state.selectedRows.clear();
  renderTable();
}

export function updateBranchFilterUI(): void {
  const btn = document.getElementById('filter-branch-btn');
  if (!btn) return;
  const n = state.filterBranches.size;
  if (n === 0 || n === BRANCHES.length) {
    btn.textContent = '所有 Branch ▾';
  } else if (n <= 3) {
    btn.textContent = [...state.filterBranches].join(', ') + ' ▾';
  } else {
    btn.textContent = `已选 ${n} 个 ▾`;
  }
  const allCb = document.getElementById('fb-all') as HTMLInputElement | null;
  if (allCb) allCb.checked = n === BRANCHES.length;
  document.querySelectorAll('#filter-branch-dropdown input[type=checkbox][value]').forEach((cb: any) => {
    cb.checked = state.filterBranches.has(cb.value);
  });
}

// ── Branch History ──────────────────────────────────────────────

export function buildBranchHistoryMap(): void {
  state.setBranchHistoryMap(new Map());
  for (const claim of state.archivedClaims) {
    const claimDate = claim.date || '';
    for (const row of (claim.rows || [])) {
      const supplier = (row.supplierName || '').trim().toUpperCase();
      const branch = (row.branch || '').trim();
      if (!supplier || !branch) continue;
      if (!state.branchHistoryMap.has(supplier)) state.branchHistoryMap.set(supplier, []);
      state.branchHistoryMap.get(supplier)!.push({ branch, claimDate, invoiceDate: row.invoiceDate || '' });
    }
  }
  for (const [key, entries] of state.branchHistoryMap) {
    entries.sort((a, b) => b.claimDate.localeCompare(a.claimDate));
    if (entries.length > 5) state.branchHistoryMap.set(key, entries.slice(0, 5));
  }
}

function findBranchHistory(supplierName: string) {
  const key = (supplierName || '').trim().toUpperCase();
  if (!key) return null;
  if (state.branchHistoryMap.has(key)) return state.branchHistoryMap.get(key)!;
  for (const [canonical, info] of Object.entries(state.memoryData.suppliers || {})) {
    const variants = (info.variants || []).map(v => v.trim().toUpperCase());
    if (canonical.toUpperCase() === key || variants.includes(key)) {
      const ck = canonical.toUpperCase();
      if (state.branchHistoryMap.has(ck)) return state.branchHistoryMap.get(ck)!;
      for (const v of variants) { if (state.branchHistoryMap.has(v)) return state.branchHistoryMap.get(v)!; }
    }
  }
  return null;
}

function getBranchHintHtml(supplierName: string, rowId: string): string {
  const history = findBranchHistory(supplierName);
  if (!history || !history.length) return '';
  const last = history[0];
  const mm = (last.claimDate.match(/^\d{4}-(\d{2})/) || [])[1];
  const monthStr = mm ? mm + '月' : '';
  const key = (supplierName || '').trim().toUpperCase();
  return `<div class="branch-hint" data-row-id="${esc(rowId)}" data-supplier-key="${esc(key)}" title="点击查看分店轮换历史">` +
    `<span class="branch-hint-icon">↻</span>` +
    `<span class="branch-hint-text">上次: ${esc(last.branch)}${monthStr ? ' (' + monthStr + ')' : ''}</span></div>`;
}

export function showBranchHistory(rowId: string, supplierKey: string, evt: MouseEvent): void {
  evt.stopPropagation();
  closeBranchPopover();
  const history = state.branchHistoryMap.get(supplierKey) || findBranchHistory(supplierKey);
  if (!history || !history.length) return;
  const pop = document.createElement('div');
  pop.className = 'branch-hint-popover';
  let html = '<div class="branch-hint-popover-title">' + esc(supplierKey) + ' 分店历史</div>';
  history.forEach(h => {
    const ds = h.claimDate ? h.claimDate.substring(0, 10) : h.invoiceDate;
    html += `<div class="branch-hint-entry">
      <span class="branch-hint-branch">${esc(h.branch)}</span>
      <span class="branch-hint-date">${esc(ds)}</span>
      <button class="branch-hint-apply" data-row-id="${esc(rowId)}" data-branch="${esc(h.branch)}">使用</button></div>`;
  });
  pop.innerHTML = html;
  document.body.appendChild(pop);
  const rect = (evt.currentTarget as HTMLElement).getBoundingClientRect();
  pop.style.left = rect.left + 'px';
  pop.style.top = (rect.bottom + 4) + 'px';
  const pr = pop.getBoundingClientRect();
  if (pr.right > window.innerWidth - 10) pop.style.left = (window.innerWidth - pr.width - 10) + 'px';
  if (pr.bottom > window.innerHeight - 10) pop.style.top = (rect.top - pr.height - 4) + 'px';
  state.setActiveBranchPopover(pop);

  // Event delegation on popover
  pop.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.branch-hint-apply') as HTMLElement | null;
    if (btn) {
      applyBranchFromHistory(btn.dataset.rowId!, btn.dataset.branch!);
    }
  });

  setTimeout(() => document.addEventListener('click', closeBranchPopoverOutside), 0);
}

export function closeBranchPopover(): void {
  if (state.activeBranchPopover) { state.activeBranchPopover.remove(); state.setActiveBranchPopover(null); }
  document.removeEventListener('click', closeBranchPopoverOutside);
}

function closeBranchPopoverOutside(e: Event): void {
  if (state.activeBranchPopover && !state.activeBranchPopover.contains(e.target as Node)) closeBranchPopover();
}

function applyBranchFromHistory(rowId: string, branch: string): void {
  updateField(rowId, 'branch', branch);
  const tr = document.querySelector(`tr[data-id="${rowId}"]`);
  if (tr) { const sel = tr.querySelector('select') as HTMLSelectElement | null; if (sel) sel.value = branch; }
  closeBranchPopover();
  showToast('已设置 Branch: ' + branch, 'success', 2000);
}

// ── Validation handlers ─────────────────────────────────────────

export function validateAmountField(id: string, el: HTMLInputElement): void {
  const v = validateAmount(el.value);
  if (!v.valid) {
    el.classList.add('input-error');
    showToast('金额格式无效，请输入正数', 'warning', 3000);
    return;
  }
  el.classList.remove('input-error');
  const row = state.getRow(id);
  if (row) {
    row.amount = v.cleaned;
    row.modifiedAt = new Date().toISOString();
    scheduleSave();
  }
}

export function validateDateField(id: string, field: string, el: HTMLInputElement): void {
  const v = validateDate(el.value);
  if (!v.valid) {
    el.classList.add('input-error');
    showToast('日期格式无效，请使用 DD/MM/YYYY', 'warning', 3000);
    return;
  }
  el.classList.remove('input-error');
  const row = state.getRow(id);
  if (row) {
    row[field as EditableRowKey] = v.normalized;
    row.modifiedAt = new Date().toISOString();
    el.value = v.normalized;
    scheduleSave();
  }
}

// ── Notes ───────────────────────────────────────────────────────

export function toggleNotes(id: string): void {
  const row = state.getRow(id);
  if (!row) return;
  state.setNotesTargetId(id);
  const inp = document.getElementById('notes-input') as HTMLTextAreaElement | null;
  if (inp) inp.value = row.notes || '';
  document.getElementById('notes-modal')?.classList.add('show');
  setTimeout(() => inp?.focus(), 50);
}

export function closeNotesModal(save: boolean): void {
  document.getElementById('notes-modal')?.classList.remove('show');
  if (save && state.notesTargetId) {
    const row = state.getRow(state.notesTargetId);
    if (row) {
      row.notes = (document.getElementById('notes-input') as HTMLTextAreaElement)?.value || '';
      row.modifiedAt = new Date().toISOString();
      renderTable(); scheduleSave();
      if (row.notes) showToast('备注已保存', 'success', 2000);
    }
  }
  state.setNotesTargetId(null);
}

// ── Bulk Edit ───────────────────────────────────────────────────

export function applyBulkBranch(): void {
  const val = (document.getElementById('bulk-branch') as HTMLSelectElement)?.value;
  if (!val || !state.selectedRows.size) return;
  const count = state.selectedRows.size;
  const affectedRows = state.rows.filter(r => state.selectedRows.has(r.id));
  const oldVals = affectedRows.map(r => ({ id: r.id, branch: r.branch }));

  affectedRows.forEach(r => { r.branch = val; r.modifiedAt = new Date().toISOString(); });
  (document.getElementById('bulk-branch') as HTMLSelectElement).value = '';
  renderTable(); scheduleSave();
  showToast(`已将 ${count} 条记录的 Branch 设为 ${val}`, 'success');

  pushUndo({
    type: 'bulk',
    description: `${count} 条 Branch → ${val}`,
    undo: () => { oldVals.forEach(o => { const r = state.getRow(o.id); if (r) r.branch = o.branch; }); renderTable(); scheduleSave(); },
    redo: () => { affectedRows.forEach(r => { r.branch = val; }); renderTable(); scheduleSave(); },
  });
}

export function applyBulkCategory(): void {
  const val = (document.getElementById('bulk-category') as HTMLSelectElement)?.value;
  if (!val || !state.selectedRows.size) return;
  const count = state.selectedRows.size;
  const affectedRows = state.rows.filter(r => state.selectedRows.has(r.id));
  const oldVals = affectedRows.map(r => ({ id: r.id, category: r.category }));

  affectedRows.forEach(r => { r.category = val; r.modifiedAt = new Date().toISOString(); });
  (document.getElementById('bulk-category') as HTMLSelectElement).value = '';
  renderTable(); scheduleSave();
  showToast(`已将 ${count} 条记录的 Category 设为 ${val}`, 'success');

  pushUndo({
    type: 'bulk',
    description: `${count} 条 Category → ${val}`,
    undo: () => { oldVals.forEach(o => { const r = state.getRow(o.id); if (r) r.category = o.category; }); renderTable(); scheduleSave(); },
    redo: () => { affectedRows.forEach(r => { r.category = val; }); renderTable(); scheduleSave(); },
  });
}

export function applyBulkDescription(): void {
  const inp = document.getElementById('bulk-description') as HTMLInputElement | null;
  const val = inp?.value.trim();
  if (!val || !state.selectedRows.size) return;
  const count = state.selectedRows.size;
  const affectedRows = state.rows.filter(r => state.selectedRows.has(r.id));
  const oldVals = affectedRows.map(r => ({ id: r.id, description: r.description }));

  affectedRows.forEach(r => { r.description = val; r.modifiedAt = new Date().toISOString(); });
  if (inp) inp.value = '';
  renderTable(); scheduleSave();
  showToast(`已将 ${count} 条记录的 Description 设为 "${val}"`, 'success');

  pushUndo({
    type: 'bulk',
    description: `${count} 条 Description → ${val}`,
    undo: () => { oldVals.forEach(o => { const r = state.getRow(o.id); if (r) r.description = o.description; }); renderTable(); scheduleSave(); },
    redo: () => { affectedRows.forEach(r => { r.description = val; }); renderTable(); scheduleSave(); },
  });
}

export function applyBulkClaimDate(): void {
  if (!state.selectedRows.size) return;
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
  const count = state.selectedRows.size;
  state.rows.filter(r => state.selectedRows.has(r.id)).forEach(r => {
    r.claimDate = dateStr;
    r.modifiedAt = new Date().toISOString();
  });
  renderTable(); scheduleSave();
  showToast(`已将 ${count} 条记录的 Claim Date 设为 ${dateStr}`, 'success');
}

export function setAllClaimDateToday(): void {
  if (!state.rows.length) return;
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
  const empty = state.rows.filter(r => !r.claimDate);
  const target = empty.length > 0 ? empty : state.rows;
  target.forEach(r => {
    r.claimDate = dateStr;
    r.modifiedAt = new Date().toISOString();
  });
  renderTable(); scheduleSave();
  showToast(`已将 ${target.length} 条记录的 Claim Date 设为 ${dateStr}`, 'success');
}

// ── Render table ────────────────────────────────────────────────

export function renderTable(): void {
  closeBranchPopover();
  const fc = (document.getElementById('filter-cat') as HTMLSelectElement)?.value || '';
  let filtered = state.rows.filter(r => {
    if (state.filterBranches.size > 0 && !state.filterBranches.has(r.branch)) return false;
    if (fc && r.category !== fc) return false;
    return true;
  });
  if (state.recordSearch) {
    const q = state.recordSearch;
    filtered = filtered.filter(r =>
      (r.supplierName || '').toLowerCase().includes(q) ||
      (r.invoiceNo || '').toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q) ||
      (r.invoiceDate || '').toLowerCase().includes(q) ||
      (r.branch || '').toLowerCase().includes(q) ||
      (r.category || '').toLowerCase().includes(q) ||
      String(r.amount || '').includes(q),
    );
  }
  const sorted = sortRows(filtered);

  const total = sorted.reduce((s, r) => s + parseAmt(r), 0);
  const statTotal = document.getElementById('stat-total');
  if (statTotal) statTotal.textContent = 'RM ' + total.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Foreign currency stats
  const fsDiv = document.getElementById('foreign-stats');
  let fsHtml = '';
  ['USD', 'CNY', 'SGD'].forEach(cur => {
    const sub = sorted.filter(r => r.originalCurrency === cur);
    if (!sub.length) return;
    const ot = sub.reduce((s, r) => s + (parseFloat(String(r.originalAmount || 0).replace(/[^0-9.]/g, '')) || 0), 0);
    const info = CUR_INFO[cur];
    fsHtml += `<div class="stat-card" style="border-color:${info.color}33"><div class="stat-val" style="color:${info.color};font-size:16px">${cur} ${ot.toFixed(2)}</div><div class="stat-label">${sub.length} 张 ${info.flag}</div></div>`;
  });
  if (fsDiv) fsDiv.innerHTML = fsHtml;

  if (sorted.length === 0) {
    const tw = document.getElementById('table-wrap');
    if (tw) tw.style.display = 'none';
    const fe = document.getElementById('filter-empty-state');
    if (state.rows.length === 0) {
      const es = document.getElementById('empty-state');
      if (es) es.style.display = 'block';
      if (fe) fe.style.display = 'none';
    } else {
      const es = document.getElementById('empty-state');
      if (es) es.style.display = 'none';
      if (fe) fe.style.display = 'block';
    }
    updateSelectionUI();
    return;
  }

  const es = document.getElementById('empty-state');
  if (es) es.style.display = 'none';
  const fe2 = document.getElementById('filter-empty-state');
  if (fe2) fe2.style.display = 'none';
  const tw = document.getElementById('table-wrap');
  if (tw) tw.style.display = 'block';

  const tbody = document.getElementById('tbody');
  if (!tbody) return;
  const cachedSuppliers = getMergedSuppliers();
  tbody.innerHTML = sorted.map(row => {
    const isForeign = row.originalCurrency && row.originalCurrency !== 'MYR';
    const curInfo = CUR_INFO[row.originalCurrency] || CUR_INFO.MYR;
    const curColor = curInfo.color;
    const descOpts = getMergedDescriptions(row.category);
    const mergedSuppliers = cachedSuppliers;
    const rid = row.id;
    const isChecked = state.selectedRows.has(rid);

    const filePath = row.localFilePath || (row.serverFilePath ? `working/${row.serverFilePath}` : '');
    const fileUrl = filePath ? `/api/file/${filePath}` : '';
    const previewSrc = row.preview || (fileUrl || '');
    const isImage = previewSrc && /\.(jpg|jpeg|png|webp)$/i.test(previewSrc) || (row.preview && row.preview.startsWith('blob:'));
    const isPdf = /\.pdf$/i.test(row.fileName || filePath || '');
    const openUrl = fileUrl || previewSrc;

    const assignClick = state.pendingCCAssign ? ` data-assign-id="${rid}"` : '';
    const assignClass = state.pendingCCAssign ? ' cc-assign-target' : '';
    return `<tr class="${isChecked ? 'row-selected' : ''}${assignClass}" data-id="${rid}"${assignClick}>
      <td style="width:28px;text-align:center;padding:0">
        <input type="checkbox" ${isChecked ? 'checked' : ''} data-select-row="${rid}" style="cursor:pointer;accent-color:var(--acc)">
      </td>
      <td style="width:34px;text-align:center">
        ${isImage && previewSrc
          ? `<img src="${previewSrc}" data-open-url="${openUrl}" style="width:26px;height:26px;object-fit:cover;border-radius:4px;cursor:pointer;border:1px solid var(--bdr)">`
          : isPdf && openUrl
            ? `<span data-open-url="${openUrl}" style="font-size:16px;cursor:pointer" title="打开 PDF">📄</span>`
            : `<span style="opacity:.3;font-size:16px">\u{1F4C4}</span>`}
      </td>
      <td style="width:100px">
        <select data-field="branch" data-row="${rid}">
          <option value="">-</option>
          ${BRANCHES.map(b => `<option ${row.branch === b ? 'selected' : ''}>${b}</option>`).join('')}
        </select>
        ${getBranchHintHtml(row.supplierName, rid)}
      </td>
      <td style="min-width:220px">
        <input value="${esc(row.supplierName)}" data-field="supplierName" data-row="${rid}" list="sl-${rid}" placeholder="Supplier name">
        <datalist id="sl-${rid}">${mergedSuppliers.map(s => `<option value="${s}">`).join('')}</datalist>
      </td>
      <td style="min-width:150px">
        <input value="${esc(row.invoiceNo)}" data-field="invoiceNo" data-row="${rid}" placeholder="INV-0001">
      </td>
      <td style="width:120px">
        <input type="date" value="${ddmmyyyyToIso(row.invoiceDate)}" data-field="invoiceDate" data-row="${rid}" data-date-convert="true" style="font-size:11px">
      </td>
      <td style="width:140px">
        <select id="cat-${rid}" data-field="category" data-row="${rid}">
          <option value="">Select...</option>
          ${CATEGORIES.map(c => `<option ${row.category === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </td>
      <td style="min-width:260px">
        <input id="desc-${rid}" value="${esc(row.description)}" data-field="description" data-row="${rid}" list="dl-${rid}" placeholder="Description">
        <datalist id="dl-${rid}">${descOpts.map(d => `<option value="${d}">`).join('')}</datalist>
      </td>
      <td style="width:96px">
        <select id="cur-${rid}"
          class="cur-select${isForeign ? ' foreign' : ''}"
          style="color:${isForeign ? curColor : ''};border-color:${isForeign ? curColor + '66' : ''}"
          data-currency-row="${rid}">
          ${Object.entries(CUR_INFO).map(([c, i]) => `<option value="${c}" ${row.originalCurrency === c ? 'selected' : ''}>${i.flag} ${c}</option>`).join('')}
        </select>
      </td>
      <td style="width:100px">
        ${isForeign
          ? `<input style="text-align:right;color:${curColor}" value="${esc(row.originalAmount)}" data-orig-amt="${rid}" placeholder="0.00">`
          : `<span style="font-size:11px;color:var(--muted);padding:5px 8px;display:block">\u2014</span>`}
      </td>
      <td style="width:106px">
        <input id="amt-${rid}" class="amt-input" value="${esc(row.amount)}" data-field="amount" data-row="${rid}" data-validate="amount" placeholder="0.00"
          style="text-align:right;color:var(--green)${isForeign ? ';padding-right:18px' : ''}">
      </td>
      <td style="width:120px">
        <input type="date" value="${ddmmyyyyToIso(row.claimDate)}" data-field="claimDate" data-row="${rid}" data-date-convert="true" style="font-size:11px">
      </td>
      <td style="width:50px;text-align:center;white-space:nowrap">
        <button class="notes-btn ${row.notes ? 'has-notes' : ''}" data-notes="${rid}" title="${row.notes ? esc(row.notes) : '添加备注'}">📝</button>
        <button class="del-btn" data-delete="${rid}" title="删除">\u2715</button>
      </td>
    </tr>`;
  }).join('');

  // Update sort indicators
  ['branch', 'supplierName', 'invoiceNo', 'invoiceDate', 'category', 'amount', 'claimDate'].forEach(col => {
    const el = document.getElementById('sort-' + col);
    if (el) el.innerHTML = sortIcon(col);
  });

  updateSelectionUI();

  // Legend
  const hasForeign = sorted.some(r => r.originalCurrency && r.originalCurrency !== 'MYR');
  const legend = document.getElementById('legend');
  if (legend) {
    legend.innerHTML = hasForeign
      ? `<span>\u{1F4B1} 当前汇率：</span>${Object.entries(CUR_INFO).filter(([c]) => c !== 'MYR').map(([c, i]) => `<span>${i.flag} <span style="color:${i.color};font-weight:600">${c}</span> = RM ${state.rates[c]?.toFixed(4)}</span>`).join('')}${!state.ratesLive ? ` <span style="color:#f97316">\u26A0 使用估算汇率</span>` : ''}`
      : '';
  }
}

// ── Event delegation for table ──────────────────────────────────

export function initTableEvents(): void {
  const tbody = document.getElementById('tbody');
  if (!tbody) return;

  // Change events (inputs, selects)
  tbody.addEventListener('change', (e) => {
    const target = e.target as HTMLElement;

    // Row selection checkbox
    const selectRow = target.getAttribute('data-select-row');
    if (selectRow) { toggleSelectRow(selectRow); return; }

    // Field updates
    const field = target.getAttribute('data-field');
    const rowId = target.getAttribute('data-row');
    if (field && rowId) {
      let val = (target as HTMLInputElement).value;
      // Convert date picker ISO format back to DD/MM/YYYY
      if (target.getAttribute('data-date-convert') === 'true') {
        val = isoToDdmmyyyy(val);
      }
      updateField(rowId, field as EditableRowKey, val);
      return;
    }

    // Currency change
    const currencyRow = target.getAttribute('data-currency-row');
    if (currencyRow) { updateCurrency(currencyRow, (target as HTMLSelectElement).value); return; }

    // Original amount
    const origAmt = target.getAttribute('data-orig-amt');
    if (origAmt) { updateOrigAmt(origAmt, (target as HTMLInputElement).value); return; }
  });

  // Blur events (validation)
  tbody.addEventListener('blur', (e) => {
    const target = e.target as HTMLInputElement;
    const validate = target.getAttribute('data-validate');
    const rowId = target.getAttribute('data-row');
    if (!validate || !rowId) return;
    if (validate === 'amount') validateAmountField(rowId, target);
    if (validate === 'date') {
      const field = target.getAttribute('data-field');
      if (field) validateDateField(rowId, field, target);
    }
  }, true);

  // Click events
  tbody.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    // Open file
    const openUrl = target.getAttribute('data-open-url');
    if (openUrl) { openExternal(openUrl); return; }

    // Notes
    const notesId = target.getAttribute('data-notes');
    if (notesId) { e.stopPropagation(); toggleNotes(notesId); return; }

    // Delete
    const deleteId = target.getAttribute('data-delete');
    if (deleteId) { deleteRow(deleteId); return; }

    // Branch hint
    const hint = target.closest('.branch-hint') as HTMLElement | null;
    if (hint) {
      const rowId = hint.getAttribute('data-row-id');
      const supplierKey = hint.getAttribute('data-supplier-key');
      if (rowId && supplierKey) showBranchHistory(rowId, supplierKey, e as MouseEvent);
      return;
    }

    // CC Assign
    const assignId = target.closest('[data-assign-id]')?.getAttribute('data-assign-id');
    if (assignId && state.pendingCCAssign) {
      manualAssignCC(assignId);
      return;
    }
  });

  // Fix 14: Enter key navigation in table (next row, same column)
  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const target = e.target as HTMLElement;
    if (target.tagName !== 'INPUT') return;
    e.preventDefault();
    const tr = target.closest('tr');
    if (!tr) return;
    const cells = Array.from(tr.children);
    const cellIndex = cells.findIndex(td => td.contains(target));
    const nextTr = tr.nextElementSibling;
    if (nextTr && cellIndex >= 0) {
      const nextCell = nextTr.children[cellIndex];
      const nextInput = nextCell?.querySelector('input, select') as HTMLElement | null;
      if (nextInput) nextInput.focus();
    }
  });

  // Sort headers
  document.querySelectorAll('th[onclick]').forEach(th => {
    // Remove old onclick, add event listener
    const onclickStr = th.getAttribute('onclick') || '';
    const m = onclickStr.match(/toggleSort\('(\w+)'\)/);
    if (m) {
      th.removeAttribute('onclick');
      th.addEventListener('click', () => toggleSort(m[1]));
    }
  });
}
