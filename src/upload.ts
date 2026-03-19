import * as state from './state';
import * as api from './api';
import { generateId, esc, showToast, convertToMYR, todayStr, extractBaseFileName, normalizeInvNo } from './utils';
import { BRANCHES, CATEGORIES, CUR_INFO } from './constants';
import type { InvoiceRow, DuplicateResult } from './types';
import { renderTable, updateCounts } from './records';
import { switchTab } from './main-helpers';
import { pushUndo } from './undo';

// ── Duplicate Detection ─────────────────────────────────────────

export function findDuplicate(newRow: Partial<InvoiceRow>): DuplicateResult | null {
  const newInvNo = normalizeInvNo(newRow.invoiceNo || '');
  const newSupplier = (newRow.supplierName || '').trim().toLowerCase();
  const newAmt = String(newRow.amount || '').trim();
  const newDate = (newRow.invoiceDate || '').trim();
  const newFileName = extractBaseFileName(newRow.fileName || newRow.serverFilePath || newRow.localFilePath || '');
  const newLocalPath = (newRow.localFilePath || '').trim().toLowerCase();

  for (const r of state.rows) {
    if (newInvNo && normalizeInvNo(r.invoiceNo) === newInvNo) {
      return { row: r, reason: 'invoiceNo', source: 'current' };
    }
    const rFileName = extractBaseFileName(r.fileName || r.serverFilePath || r.localFilePath || '');
    if (newFileName && rFileName && newFileName === rFileName) {
      return { row: r, reason: 'fileName', source: 'current' };
    }
    const rLocalPath = (r.localFilePath || '').trim().toLowerCase();
    if (newLocalPath && rLocalPath && newLocalPath === rLocalPath) {
      return { row: r, reason: 'fileName', source: 'current' };
    }
    if (newSupplier && newAmt && newDate
      && (r.supplierName || '').trim().toLowerCase() === newSupplier
      && String(r.amount || '').trim() === newAmt
      && (r.invoiceDate || '').trim() === newDate) {
      return { row: r, reason: 'supplierAmtDate', source: 'current' };
    }
  }

  for (const claim of state.archivedClaims) {
    for (const r of (claim.rows || [])) {
      if (newInvNo && normalizeInvNo(r.invoiceNo) === newInvNo) {
        return { row: r, reason: 'invoiceNo', source: 'archived' };
      }
      const rFileName = extractBaseFileName(r.fileName || r.serverFilePath || r.localFilePath || '');
      if (newFileName && rFileName && newFileName === rFileName) {
        return { row: r, reason: 'fileName', source: 'archived' };
      }
      const rLocalPath = (r.localFilePath || '').trim().toLowerCase();
      if (newLocalPath && rLocalPath && newLocalPath === rLocalPath) {
        return { row: r, reason: 'fileName', source: 'archived' };
      }
    }
  }
  return null;
}

// ── Duplicate Modal ─────────────────────────────────────────────

export function showDupModal(existing: InvoiceRow & { _source?: string }, reason: string): void {
  const info = document.getElementById('dup-info');
  if (!info) return;
  const isHardBlock = reason === 'invoiceNo' || reason === 'fileName';
  const sourceLabel = existing._source === 'archived' ? '（已归档记录）' : '';
  const reasonLabel = reason === 'fileName' ? '🚫 相同文件已录入' + sourceLabel + '：'
    : reason === 'invoiceNo' ? '🚫 发票号重复，无法添加' + sourceLabel + '：'
    : '系统已有相似发票记录：';
  info.innerHTML = `
    <div style="color:${isHardBlock ? 'var(--red)' : 'var(--orange)'};font-weight:600;margin-bottom:8px">
      ${reasonLabel}
    </div>
    <div style="background:rgba(${isHardBlock ? '248,113,113' : '249,115,22'},.06);border:1px solid rgba(${isHardBlock ? '248,113,113' : '249,115,22'},.2);border-radius:8px;padding:12px;font-size:12px;line-height:2">
      <div>📄 <strong>供应商:</strong> ${esc(existing.supplierName)}</div>
      <div>🔢 <strong>发票号:</strong> ${esc(existing.invoiceNo)}</div>
      <div>📅 <strong>日期:</strong> ${esc(existing.invoiceDate)}</div>
      <div>💰 <strong>金额:</strong> RM ${esc(String(existing.amount))}</div>
    </div>
    ${isHardBlock
      ? '<div style="margin-top:10px;font-size:12px;color:var(--red)">相同发票号不允许重复录入。</div>'
      : '<div style="margin-top:10px;font-size:12px;color:var(--muted)">是否仍然添加此发票？</div>'}
  `;
  const addBtn = document.getElementById('dup-add-anyway-btn') as HTMLElement | null;
  if (addBtn) addBtn.style.display = isHardBlock ? 'none' : 'inline-flex';
  document.getElementById('dup-modal')?.classList.add('show');
}

export function cancelDup(): void {
  state.setPendingRow(null);
  document.getElementById('dup-modal')?.classList.remove('show');
}

export function addAnyway(): void {
  document.getElementById('dup-modal')?.classList.remove('show');
  if (state.pendingRow) {
    state.rows.unshift(state.pendingRow);
    state.setPendingRow(null);
    updateCounts();
    renderTable();
    switchTab('records');
    scheduleSave();
  }
}

// ── Drag & Drop ─────────────────────────────────────────────────

export function onDragOver(e: DragEvent): void {
  e.preventDefault();
  document.getElementById('dropzone')?.classList.add('over');
}

export function onDragLeave(): void {
  document.getElementById('dropzone')?.classList.remove('over');
}

export function onDrop(e: DragEvent): void {
  e.preventDefault();
  document.getElementById('dropzone')?.classList.remove('over');
  if (e.dataTransfer?.files) handleFileSelect(e.dataTransfer.files);
}

export function handleFileSelect(files: FileList): void {
  Array.from(files).forEach(processFile);
}

// ── Process file ────────────────────────────────────────────────

export async function processFile(file: File): Promise<void> {
  const valid = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
  if (!valid.includes(file.type)) { showToast('不支持的文件格式', 'warning'); return; }

  // Pre-API duplicate check by filename
  const preCheckName = extractBaseFileName(file.name);
  if (preCheckName) {
    const existingByFile = state.rows.find(r => extractBaseFileName(r.fileName || r.serverFilePath || r.localFilePath || '') === preCheckName);
    if (existingByFile) {
      state.setPendingRow(null);
      showDupModal(Object.assign({}, existingByFile, { _source: 'current' }) as any, 'fileName');
      return;
    }
    for (const claim of state.archivedClaims) {
      for (const r of (claim.rows || [])) {
        if (extractBaseFileName(r.fileName || r.serverFilePath || r.localFilePath || '') === preCheckName) {
          state.setPendingRow(null);
          showDupModal(Object.assign({}, r, { _source: 'archived' }) as any, 'fileName');
          return;
        }
      }
    }
  }

  document.getElementById('loading')?.classList.add('show');
  const loadingText = document.getElementById('loading-text');
  const loadingName = document.getElementById('loading-name');
  if (loadingText) loadingText.textContent = 'AI 正在分析发票...';
  if (loadingName) loadingName.textContent = file.name;

  try {
    const d = await api.processInvoice(file);
    if (!d.ok) { showToast('提取失败: ' + d.error, 'error'); return; }
    if (d.cached) showToast('使用缓存数据，未消耗 API', 'info');

    const p = d.data;
    const detCur = (p.currency || 'MYR').toUpperCase();
    const isForeign = detCur !== 'MYR';
    const origAmt = p.amount || '';
    const myrAmt = isForeign ? convertToMYR(origAmt, detCur) : (parseFloat(origAmt) || 0);
    const baseDesc = p.suggestedDescription || '';
    const desc = (isForeign && origAmt)
      ? `${baseDesc} (${detCur} ${parseFloat(origAmt).toFixed(2)})`
      : baseDesc;

    const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;

    const memBranch = p.memoryBranchFromAddress || p.memoryBranch || '';
    const memCategory = p.memoryCategory || p.suggestedCategory || '';
    const memSupplier = p.memoryCanonicalSupplier || p.supplierName || '';

    const newRow: InvoiceRow = {
      id: generateId(),
      branch: memBranch, supplierName: memSupplier, invoiceNo: p.invoiceNo || '',
      invoiceDate: p.invoiceDate || '', category: memCategory,
      description: desc, amount: isNaN(myrAmt) ? origAmt : myrAmt.toFixed(2),
      originalAmount: origAmt, originalCurrency: detCur,
      claimDate: todayStr(), preview, fileName: file.name,
      serverFilePath: d.serverFilePath || '', localFilePath: '',
      ccMatched: false, ccActualRate: null,
      notes: '',
      createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString(),
    };

    const dup = findDuplicate(newRow);
    if (dup) {
      if (dup.reason === 'invoiceNo' || dup.reason === 'fileName') {
        if (preview) URL.revokeObjectURL(preview);
        state.setPendingRow(null);
        showDupModal(Object.assign({}, dup.row, { _source: dup.source }) as any, dup.reason);
      } else {
        state.setPendingRow(newRow);
        showDupModal(dup.row as any, 'supplierAmtDate');
      }
    } else {
      state.rows.unshift(newRow);
      updateCounts();
      renderTable();
      switchTab('records');
      scheduleSave();
    }
  } catch (e: any) { showToast('错误: ' + e.message, 'error'); }
  finally { document.getElementById('loading')?.classList.remove('show'); }
}

// ── Scan New Claim folder ────────────────────────────────────────

export async function scanNewClaim(): Promise<void> {
  if (!state.claimsFolder) { showToast('请先在设置中选择 Claims Folder', 'warning'); return; }

  const scanBtn = document.getElementById('scan-btn') as HTMLButtonElement | null;
  const progressDiv = document.getElementById('scan-progress');
  const scanFill = document.getElementById('scan-fill');
  const scanText = document.getElementById('scan-text');

  if (scanBtn) { scanBtn.disabled = true; scanBtn.textContent = '⏳ 扫描中...'; }

  try {
    const sd = await api.scanFolder();
    if (!sd.ok) { showToast(sd.error || '扫描失败', 'error'); return; }

    const files = sd.files;
    if (progressDiv) progressDiv.style.display = 'block';
    if (scanText) scanText.textContent = `找到 ${files.length} 个文件，开始 AI 识别...`;
    if (scanFill) scanFill.style.width = '0%';

    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    async function processWithRetry(filename: string, maxRetries = 5): Promise<any> {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const pd = await api.processLocal(filename);
        if (!pd.ok && pd.error && pd.error.includes('429')) {
          const waitSec = Math.min(10 + attempt * 5, 30);
          if (scanText) scanText.textContent = `⏳ API 限速，等待 ${waitSec}s 后重试 (${attempt + 1}/${maxRetries})...`;
          await delay(waitSec * 1000);
          continue;
        }
        return pd;
      }
      return { ok: false, error: '多次重试后仍被限速，请稍后再试' };
    }

    let processed = 0, errors = 0, added = 0, cachedCount = 0;
    const skippedFiles: string[] = [];
    for (const file of files) {
      const shortName = file.name.includes('/') ? file.name.split('/').pop() : file.name;
      if (scanText) scanText.textContent = `正在识别 (${processed + 1}/${files.length}): ${shortName}`;
      if (scanFill) scanFill.style.width = `${((processed) / files.length) * 100}%`;

      let wasCached = false;
      try {
        const pd = await processWithRetry(file.name);
        wasCached = pd.cached || false;
        if (wasCached) cachedCount++;

        if (pd.ok) {
          const p = pd.data;
          const detCur = (p.currency || 'MYR').toUpperCase();
          const isForeign = detCur !== 'MYR';
          const origAmt = p.amount || '';
          const myrAmt = isForeign ? convertToMYR(origAmt, detCur) : (parseFloat(origAmt) || 0);
          const baseDesc = p.suggestedDescription || '';
          const desc = (isForeign && origAmt)
            ? `${baseDesc} (${detCur} ${parseFloat(origAmt).toFixed(2)})`
            : baseDesc;

          const localPath = pd.localFilePath || '';
          const isImg = /\.(jpg|jpeg|png|webp)$/i.test(file.name);
          const preview = isImg && localPath ? `/api/file/${localPath}` : null;

          const memBranch = p.memoryBranchFromAddress || p.memoryBranch || '';
          const memCategory = p.memoryCategory || p.suggestedCategory || '';
          const memSupplier = p.memoryCanonicalSupplier || p.supplierName || '';

          const newRow: InvoiceRow = {
            id: generateId(),
            branch: memBranch, supplierName: memSupplier, invoiceNo: p.invoiceNo || '',
            invoiceDate: p.invoiceDate || '', category: memCategory,
            description: desc, amount: isNaN(myrAmt) ? origAmt : myrAmt.toFixed(2),
            originalAmount: origAmt, originalCurrency: detCur,
            claimDate: todayStr(), preview, fileName: pd.fileName || file.name,
            localFilePath: localPath, serverFilePath: '',
            ccMatched: false, ccActualRate: null,
            notes: '',
            createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString(),
          };

          const dup = findDuplicate(newRow);
          if (!dup) {
            state.rows.unshift(newRow);
            added++;
            updateCounts();
            scheduleSave();
            if (added === 1) { renderTable(); switchTab('records'); }
          } else {
            skippedFiles.push(file.name.includes('/') ? file.name.split('/').pop()! : file.name);
          }
        } else {
          errors++;
        }
      } catch {
        errors++;
      }
      processed++;
      if (processed < files.length && !wasCached) await delay(2000);
    }

    if (scanFill) scanFill.style.width = '100%';
    updateCounts();
    renderTable();

    const skipped = processed - errors - added;
    let msg = errors > 0
      ? `✅ 完成！成功 ${added}/${files.length}，失败 ${errors}，跳过重复 ${skipped}`
      : `✅ 完成！成功识别 ${added} 个发票` + (skipped > 0 ? `，跳过重复 ${skipped}` : '');
    if (cachedCount > 0) msg += `（${cachedCount} 个缓存命中，节省 API）`;
    if (scanText) scanText.textContent = msg;
    if (skippedFiles.length > 0) {
      const names = skippedFiles.slice(0, 5).join(', ');
      const more = skippedFiles.length > 5 ? ` 等 ${skippedFiles.length} 个` : '';
      showToast(`跳过重复文件: ${names}${more}`, 'warning', 8000);
    }
    setTimeout(() => { if (progressDiv) progressDiv.style.display = 'none'; }, 6000);
  } catch (e: any) {
    showToast('扫描错误: ' + e.message, 'error');
  } finally {
    if (scanBtn) { scanBtn.disabled = false; scanBtn.textContent = '📂 读取 New Claim'; }
  }
}

// ── Add manual row ───────────────────────────────────────────────

export function addManualRow(): void {
  const newRow: InvoiceRow = {
    id: generateId(), branch: '', supplierName: '', invoiceNo: '', invoiceDate: '',
    category: '', description: '', amount: '', originalAmount: '', originalCurrency: 'MYR',
    claimDate: todayStr(), preview: null, fileName: '', localFilePath: '', serverFilePath: '',
    ccMatched: false, ccActualRate: null, notes: '',
    createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString(),
  };
  state.rows.unshift(newRow);
  updateCounts();
  renderTable();
  switchTab('records');
  scheduleSave();
}

// ── Save scheduling ─────────────────────────────────────────────

export function scheduleSave(): void {
  if (!state.claimsFolder) return;
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.setSaveTimer(setTimeout(() => {
    const clean = state.rows.map(r => {
      const copy = { ...r };
      if (copy.preview && copy.preview.startsWith('blob:')) delete (copy as any).preview;
      return copy;
    });
    api.saveData(clean).catch(e => console.error('save error:', e));
  }, 500));
}
