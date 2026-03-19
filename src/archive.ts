import * as state from './state';
import * as api from './api';
import { esc, showToast, showConfirm } from './utils';
import { renderTable, updateCounts, buildBranchHistoryMap } from './records';
import { scheduleSave } from './upload';
import { switchTab } from './main-helpers';

// ── Archive ─────────────────────────────────────────────────────

export async function loadArchive(): Promise<void> {
  try {
    const d = await api.getArchive();
    if (d.claims) state.setArchivedClaims(d.claims);
  } catch (e) { console.error('loadArchive error:', e); }
}

export function switchRecordTab(tab: 'current' | 'archived'): void {
  state.setActiveRecordTab(tab);
  const sc = document.getElementById('subtab-current');
  const sa = document.getElementById('subtab-archived');
  if (sc) sc.className = 'subtab' + (tab === 'current' ? ' active' : '');
  if (sa) sa.className = 'subtab' + (tab === 'archived' ? ' active' : '');
  const cp = document.getElementById('current-records-pane');
  const ap = document.getElementById('archived-records-pane');
  if (cp) cp.style.display = tab === 'current' ? 'block' : 'none';
  if (ap) ap.style.display = tab === 'archived' ? 'block' : 'none';
  if (tab === 'archived') renderArchive();
}

export function renderArchive(): void {
  const container = document.getElementById('archive-body');
  const countEl = document.getElementById('archive-count-text');
  if (!container) return;
  if (!state.archivedClaims.length) {
    container.innerHTML = '<div class="empty"><div class="icon">📦</div><h3>暂无归档记录</h3><p style="font-size:12px;color:var(--muted)">提交 Claim 后记录会显示在这里</p></div>';
    if (countEl) countEl.textContent = '';
    return;
  }

  const q = state.archiveSearch.toLowerCase();
  const filtered = q ? state.archivedClaims.filter(c =>
    c.rows.some(r =>
      (r.supplierName || '').toLowerCase().includes(q) ||
      (r.invoiceNo || '').toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q),
    ),
  ) : state.archivedClaims;

  if (countEl) countEl.textContent = `共 ${state.archivedClaims.length} 次归档`;

  container.innerHTML = filtered.slice().reverse().map(claim => {
    const total = claim.rows.reduce((s, r) => {
      const n = parseFloat(String(r.amount || 0).replace(/[^0-9.]/g, ''));
      return s + (isNaN(n) ? 0 : n);
    }, 0);

    return `<div class="archive-claim-card">
      <div class="archive-claim-header">
        <div>
          <span style="font-weight:700;color:var(--txt)">📅 ${esc(claim.date)}</span>
          <span style="color:var(--muted);font-size:12px;margin-left:12px">${claim.invoiceCount} 张发票</span>
        </div>
        <div style="font-weight:700;color:var(--green)">RM ${total.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      </div>
      <div style="font-size:11px;color:var(--muted);margin:4px 0">📁 ${esc(claim.archivePath || '')} &nbsp;|&nbsp; 📊 ${esc(claim.excelFile || '')}</div>
      <table class="archive-table">
        <thead><tr>
          <th>BRANCH</th><th>SUPPLIER</th><th>INVOICE NO.</th><th>DATE</th><th>CATEGORY</th><th>DESCRIPTION</th><th style="text-align:right">AMOUNT (RM)</th>
        </tr></thead>
        <tbody>${claim.rows.map(r => `<tr>
          <td>${esc(r.branch || '-')}</td>
          <td>${esc(r.supplierName)}</td>
          <td>${esc(r.invoiceNo)}</td>
          <td>${esc(r.invoiceDate)}</td>
          <td>${esc(r.category)}</td>
          <td>${esc(r.description)}</td>
          <td style="text-align:right;color:var(--green)">${esc(String(r.amount))}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
  }).join('');
}

// ── Export Excel ─────────────────────────────────────────────────

export async function exportExcel(): Promise<void> {
  if (!state.rows.length) return;
  try {
    const blob = await api.exportExcel(state.rows);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Claim_Master_Sheet_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e: any) { showToast('导出错误: ' + e.message, 'error'); }
}

// ── Complete Claim ──────────────────────────────────────────────

export async function completeClaim(): Promise<void> {
  if (!state.rows.length) { showToast('没有发票可以提交', 'warning'); return; }
  if (!state.claimsFolder) { showToast('请先在设置中选择 Claims Folder', 'warning'); return; }

  const isPartial = state.selectedRows.size > 0;
  const claimRows = isPartial ? state.rows.filter(r => state.selectedRows.has(r.id)) : state.rows;
  const remainingRows = isPartial ? state.rows.filter(r => !state.selectedRows.has(r.id)) : [];

  // Validation
  const missing: Array<{ supplier: string; errors: string[] }> = [];
  claimRows.forEach((r, i) => {
    const errs: string[] = [];
    if (!r.branch) errs.push('Branch');
    if (!(r.supplierName || '').trim()) errs.push('Supplier');
    const amt = parseFloat(String(r.amount || 0).replace(/[^0-9.]/g, ''));
    if (isNaN(amt) || amt <= 0) errs.push('Amount');
    if (errs.length) missing.push({ supplier: r.supplierName || `第${i + 1}行`, errors: errs });
  });
  if (missing.length > 0) {
    showToast('有 ' + missing.length + ' 条记录信息不完整，请补全后再提交', 'error', 6000);
    missing.forEach(m => {
      const row = claimRows.find(r => (r.supplierName || `第${claimRows.indexOf(r) + 1}行`) === m.supplier);
      if (row) {
        const el = document.querySelector(`tr[data-id="${row.id}"]`);
        if (el) el.classList.add('row-flash-error');
        setTimeout(() => { if (el) el.classList.remove('row-flash-error'); }, 2500);
      }
    });
    return;
  }

  const claimTotal = claimRows.reduce((s, r) => {
    const n = parseFloat(String(r.amount || 0).replace(/[^0-9.]/g, ''));
    return s + (isNaN(n) ? 0 : n);
  }, 0);
  const totalStr = 'RM ' + claimTotal.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const msg = isPartial
    ? `确定要提交选中的 <strong>${claimRows.length}</strong> 张发票吗？<br><br>总金额: <strong>${totalStr}</strong><br>剩余 ${remainingRows.length} 张将保留。`
    : `确定要提交全部 <strong>${claimRows.length}</strong> 张发票吗？<br><br>总金额: <strong>${totalStr}</strong><br>提交后当前记录将被清空。`;

  showConfirm(msg, async () => {
    try {
      const cleanRows = claimRows.map(r => {
        const c = { ...r };
        if (c.preview && c.preview.startsWith('blob:')) c.preview = '';
        return c;
      });
      const cleanRemaining = remainingRows.map(r => {
        const c = { ...r };
        if (c.preview && c.preview.startsWith('blob:')) c.preview = '';
        return c;
      });

      const d = await api.completeClaim(cleanRows, cleanRemaining);
      if (!d.ok) { showToast('提交失败: ' + d.error, 'error'); return; }

      state.setLastArchivePath(d.archivePath || '');

      const completeInfo = document.getElementById('complete-info');
      if (completeInfo) {
        completeInfo.innerHTML = `
          <div>📁 存储路径: <strong style="color:var(--txt)">${esc(d.archivePath)}</strong></div>
          <div>📊 Excel: <strong style="color:var(--txt)">${esc(d.excelFile)}</strong></div>
          <div>📄 文件数: <strong style="color:var(--txt)">${d.fileCount} 个</strong></div>
          <div>💰 总金额: <strong style="color:var(--green)">${totalStr}</strong></div>
          ${remainingRows.length > 0 ? `<div>📋 剩余: <strong style="color:var(--txt)">${remainingRows.length} 张待处理</strong></div>` : ''}
        `;
      }
      document.getElementById('complete-modal')?.classList.add('show');

      state.setRows(remainingRows);
      state.selectedRows.clear();
      updateCounts();
      renderTable();
      scheduleSave();

      await loadArchive();
      buildBranchHistoryMap();
      const memResult = await api.getMemory();
      if (memResult.ok) {
        state.setMemoryData({
          suppliers: memResult.suppliers || {},
          customSuppliers: memResult.customSuppliers || [],
          customDescriptions: memResult.customDescriptions || {},
        });
      }
    } catch (e: any) { showToast('提交错误: ' + e.message, 'error'); }
  }, '提交确认', '📋', 'btn-pri');
}

export function closeCompleteModal(): void {
  document.getElementById('complete-modal')?.classList.remove('show');
  if (state.rows.length === 0) switchTab('upload');
}

export async function openArchiveFolder(): Promise<void> {
  if (!state.lastArchivePath) return;
  try { await api.openFolder(state.lastArchivePath); } catch { }
}
