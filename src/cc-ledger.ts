import * as state from './state';
import * as api from './api';
import { esc, showToast, showConfirm, bankLabel, isWechatRelated } from './utils';
import { renderTable } from './records';
import { scheduleSave } from './upload';
import { switchTab } from './main-helpers';
import type { CCTransaction, AutoLinkProposal } from './types';

// ── CC Tab switching ────────────────────────────────────────────

export function switchCCTab(tab: 'cc' | 'wx'): void {
  state.setActiveCCTab(tab);
  const scc = document.getElementById('cc-subtab-cc');
  const swx = document.getElementById('cc-subtab-wx');
  if (scc) scc.className = 'subtab' + (tab === 'cc' ? ' active' : '');
  if (swx) swx.className = 'subtab' + (tab === 'wx' ? ' active' : '');
  const pcc = document.getElementById('cc-pane-cc');
  const pwx = document.getElementById('cc-pane-wx');
  if (pcc) pcc.style.display = tab === 'cc' ? 'block' : 'none';
  if (pwx) pwx.style.display = tab === 'wx' ? 'block' : 'none';
  if (tab === 'cc') renderCCLedgerCC();
  if (tab === 'wx') renderCCLedgerWX();
}

// ── CC Drag & Drop ──────────────────────────────────────────────

export function ccDragOver(e: DragEvent, src: string): void {
  e.preventDefault();
  document.getElementById('cc-upload-zone-' + src)?.classList.add('over');
}

export function ccDragLeave(src: string): void {
  document.getElementById('cc-upload-zone-' + src)?.classList.remove('over');
}

export function ccDrop(e: DragEvent, src: string): void {
  e.preventDefault();
  document.getElementById('cc-upload-zone-' + src)?.classList.remove('over');
  if (e.dataTransfer?.files[0]) handleCCFile(e.dataTransfer.files[0], src === 'wx' ? 'wechat' : 'cc');
}

// ── CC File handling ────────────────────────────────────────────

export async function handleCCFile(file: File, source: string): Promise<void> {
  if (!file) return;
  source = source || 'cc';
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = /\.(jpg|jpeg|png|webp)$/i.test(file.name);
  const validTypes = ['text/csv', 'application/pdf', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/jpeg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type) && !/\.(csv|xlsx|xls|pdf|jpg|jpeg|png|webp)$/i.test(file.name)) {
    showToast('请上传 CSV、XLSX、PDF 或图片文件', 'warning'); return;
  }

  if (isPdf || isImage) {
    document.getElementById('loading')?.classList.add('show');
    const ln = document.getElementById('loading-name');
    const lt = document.getElementById('loading-text');
    if (ln) ln.textContent = file.name;
    if (lt) lt.textContent = isPdf ? '正在解析 PDF 账单...' : (source === 'wechat' ? 'AI 正在解析微信支付账单...' : 'AI 正在解析信用卡账单...');
  }

  try {
    const d = await api.parseCCFile(file, source);
    if (!d.ok) { showToast('解析失败: ' + d.error, 'error'); return; }
    const newSource = d.source || source || 'cc';
    const srcLabel = newSource === 'wechat' ? '微信支付' : '信用卡';
    const methodLabel = d.method === 'local' ? ' (本地解析，未用 API)' : '';

    try {
      const md = await api.mergeLedger(d.transactions, newSource);
      if (!md.ok) { showToast('合并失败: ' + (md.error || ''), 'error'); return; }
      showToast(`${srcLabel}: 新增 ${md.added} 条，重复 ${md.duplicates} 条${methodLabel}`, 'success');
    } catch (e: any) { showToast('合并错误: ' + e.message, 'error'); return; }

    await loadFromLedger();
    await runLedgerCrossRef();
    if (newSource === 'wechat') renderCCLedgerWX();
    else renderCCLedgerCC();
  } catch (e: any) { showToast('错误: ' + e.message, 'error'); }
  finally {
    if (isPdf || isImage) {
      document.getElementById('loading')?.classList.remove('show');
      const lt = document.getElementById('loading-text');
      if (lt) lt.textContent = 'AI 正在分析发票...';
    }
  }
}

// ── Date ISO backfill ───────────────────────────────────────────

function backfillDateISO(txns: CCTransaction[]): number {
  let changed = 0;
  for (const t of txns) {
    if (!t.dateISO && t.date) {
      let m = t.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) { t.dateISO = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; changed++; continue; }
      m = t.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})(?:\s|$)/);
      if (m) { const yr = parseInt(m[3]) > 50 ? '19' + m[3] : '20' + m[3]; t.dateISO = `${yr}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; changed++; continue; }
      m = t.date.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) { t.dateISO = `${m[1]}-${m[2]}-${m[3]}`; changed++; continue; }
      m = t.date.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
      if (m) { t.dateISO = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; changed++; continue; }
    }
  }
  return changed;
}

// ── Ledger Load/Save ────────────────────────────────────────────

export async function loadFromLedger(): Promise<void> {
  try {
    const d = await api.getLedger();
    if (!d.ok) return;
    state.setCcLedgerCC(d.cc || []);
    state.setCcLedgerWX(d.wx || []);
    const c1 = backfillDateISO(state.ccLedgerCC);
    const c2 = backfillDateISO(state.ccLedgerWX);
    if (c1 || c2) await saveLedger();
  } catch (e) { console.error('loadFromLedger:', e); }
}

export async function saveLedger(): Promise<void> {
  try { await api.saveLedgerApi(state.ccLedgerCC, state.ccLedgerWX); }
  catch (e) { console.error('saveLedger:', e); }
}

// ── Cross-reference ─────────────────────────────────────────────

export async function runLedgerCrossRef(): Promise<void> {
  if (!state.ccLedgerCC.length || !state.ccLedgerWX.length) return;
  try {
    const d = await api.crossReference(state.ccLedgerWX, state.ccLedgerCC);
    if (!d.ok) return;
    for (const t of state.ccLedgerCC) { if (!t.manualCrossRef) { delete t.crossRefId; delete t.crossRefRate; } }
    for (const t of state.ccLedgerWX) { if (!t.manualCrossRef) { delete t.crossRefId; delete t.crossRefRate; } }
    for (const pair of (d.pairs || [])) {
      const wx = state.ccLedgerWX.find(t => t.id === pair.wxId);
      const cc = state.ccLedgerCC.find(t => t.id === pair.ccId);
      if (wx && !wx.manualCrossRef) { wx.crossRefId = pair.ccId; wx.crossRefRate = pair.impliedRate; }
      if (cc && !cc.manualCrossRef) { cc.crossRefId = pair.wxId; cc.crossRefRate = pair.impliedRate; }
    }
  } catch (e) { console.error('runLedgerCrossRef:', e); }
}

// ── Ledger Assign ───────────────────────────────────────────────

export function startLedgerAssign(txnId: string, source: string): void {
  const ledger = source === 'wx' ? state.ccLedgerWX : state.ccLedgerCC;
  const txn = ledger.find(t => t.id === txnId);
  if (!txn) return;
  state.setPendingCCAssign({ txnId, source });
  const cur = source === 'wx' ? '\u00a5' : 'RM';
  const banner = document.getElementById('cc-assign-banner');
  if (banner) {
    const desc = banner.querySelector('.cc-assign-desc');
    if (desc) desc.textContent = `正在为 ${txn.description} (${cur} ${txn.amount.toFixed(2)}) 指定发票… 请在记录中点击要关联的行`;
    banner.style.display = 'flex';
  }
  switchTab('records');
  renderTable();
  document.addEventListener('keydown', ccAssignEscHandler);
}

function ccAssignEscHandler(e: KeyboardEvent): void {
  if (e.key === 'Escape') cancelCCAssign();
}

export function cancelCCAssign(): void {
  state.setPendingCCAssign(null);
  const banner = document.getElementById('cc-assign-banner');
  if (banner) banner.style.display = 'none';
  document.removeEventListener('keydown', ccAssignEscHandler);
  renderTable();
}

export function manualAssignCC(invoiceId: string): void {
  if (!state.pendingCCAssign) return;
  const { txnId, source } = state.pendingCCAssign;
  const ledger = source === 'wx' ? state.ccLedgerWX : state.ccLedgerCC;
  const txn = ledger.find(t => t.id === txnId);
  const inv = state.rows.find(r => r.id === invoiceId);
  if (!txn || !inv) return;

  inv.ccMatched = true;
  inv.ccAssignedTxnId = txnId;
  inv.ccAssignedSource = source === 'wx' ? 'wechat' : 'cc';

  if (source === 'wx') {
    if (txn.crossRefRate) {
      inv.amount = (txn.amount * txn.crossRefRate).toFixed(2);
      inv.ccActualRate = txn.crossRefRate;
    } else {
      inv.ccActualRate = null;
    }
  } else {
    const origAmt = parseFloat(String(inv.originalAmount || '').replace(/[^0-9.]/g, '')) || 0;
    const isForeign = inv.originalCurrency && inv.originalCurrency !== 'MYR' && origAmt > 0;
    if (isForeign) {
      const actualRate = txn.amount / origAmt;
      inv.ccActualRate = parseFloat(actualRate.toFixed(6));
      inv.amount = txn.amount.toFixed(2);
      const base = inv.description.replace(/\s*\([A-Z]{3}\s+[\d.]+(?:\s*@\s*[\d.]+)?\)$/, '');
      inv.description = `${base} (${inv.originalCurrency} ${origAmt.toFixed(2)} @ ${inv.ccActualRate})`;
    } else {
      inv.amount = txn.amount.toFixed(2);
    }
  }

  inv.modifiedAt = new Date().toISOString();
  txn.assignedToInvoiceId = invoiceId;

  state.setPendingCCAssign(null);
  const banner = document.getElementById('cc-assign-banner');
  if (banner) banner.style.display = 'none';
  document.removeEventListener('keydown', ccAssignEscHandler);

  showToast(`已将交易关联到 ${inv.supplierName || '发票'}`, 'success');
  renderTable();
  switchTab('cc');
  if (state.activeCCTab === 'wx') renderCCLedgerWX();
  else renderCCLedgerCC();
  scheduleSave();
  saveLedger();
}

// ── Manual cross-ref ────────────────────────────────────────────

export function startManualCrossRef(txnId: string, source: string): void {
  const list = source === 'cc' ? state.ccLedgerCC : state.ccLedgerWX;
  const txn = list.find(t => t.id === txnId);
  if (!txn) return;
  state.setPendingCrossRef({ txnId, source, description: txn.description, amount: txn.amount });
  const targetTab = source === 'cc' ? 'wx' : 'cc';
  const banner = document.getElementById('crossref-banner');
  if (banner) {
    const label = source === 'cc' ? '💳 信用卡' : '💬 微信';
    const cur = source === 'cc' ? 'RM' : '¥';
    banner.innerHTML = `<span>🔗 已选择 ${label}: <b>${esc(txn.description)}</b> (${cur} ${txn.amount.toFixed(2)}) — 请在下方选择要关联的交易</span>
      <button class="btn btn-ghost btn-sm" id="cancel-crossref-btn" style="margin-left:8px;font-size:11px">✕ 取消</button>`;
    banner.style.display = 'flex';
    document.getElementById('cancel-crossref-btn')?.addEventListener('click', cancelManualCrossRef);
  }
  switchCCTab(targetTab);
}

export function confirmManualCrossRef(targetTxnId: string): void {
  if (!state.pendingCrossRef) return;
  const { txnId, source } = state.pendingCrossRef;
  const srcList = source === 'cc' ? state.ccLedgerCC : state.ccLedgerWX;
  const tgtList = source === 'cc' ? state.ccLedgerWX : state.ccLedgerCC;
  const srcTxn = srcList.find(t => t.id === txnId);
  const tgtTxn = tgtList.find(t => t.id === targetTxnId);
  if (!srcTxn || !tgtTxn) return;
  srcTxn.crossRefId = targetTxnId;
  tgtTxn.crossRefId = txnId;
  srcTxn.manualCrossRef = true;
  tgtTxn.manualCrossRef = true;
  const ccTxn = source === 'cc' ? srcTxn : tgtTxn;
  const wxTxn = source === 'cc' ? tgtTxn : srcTxn;
  if (wxTxn.amount > 0) {
    const rate = ccTxn.amount / wxTxn.amount;
    srcTxn.crossRefRate = rate;
    tgtTxn.crossRefRate = rate;
  }
  saveLedger();
  cancelManualCrossRef();
  showToast('✅ 手动关联成功');
  renderCCLedgerCC();
  renderCCLedgerWX();
}

export function cancelManualCrossRef(): void {
  state.setPendingCrossRef(null);
  const banner = document.getElementById('crossref-banner');
  if (banner) banner.style.display = 'none';
  renderCCLedgerCC();
  renderCCLedgerWX();
}

export function unlinkCrossRef(txnId: string, source: string): void {
  const srcList = source === 'cc' ? state.ccLedgerCC : state.ccLedgerWX;
  const tgtList = source === 'cc' ? state.ccLedgerWX : state.ccLedgerCC;
  const srcTxn = srcList.find(t => t.id === txnId);
  if (!srcTxn || !srcTxn.crossRefId) return;
  const tgtTxn = tgtList.find(t => t.id === srcTxn.crossRefId);
  if (tgtTxn) { delete tgtTxn.crossRefId; delete tgtTxn.crossRefRate; delete tgtTxn.manualCrossRef; }
  delete srcTxn.crossRefId; delete srcTxn.crossRefRate; delete srcTxn.manualCrossRef;
  saveLedger();
  showToast('已取消关联');
  renderCCLedgerCC();
  renderCCLedgerWX();
}

// ── Group by month ──────────────────────────────────────────────

function groupByMonth(txns: CCTransaction[]): Array<[string, CCTransaction[]]> {
  const groups: Record<string, CCTransaction[]> = {};
  for (const t of txns) {
    let key = (t.dateISO || '').slice(0, 7);
    if (!key && t.date) {
      let m = t.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) { key = m[3] + '-' + m[2].padStart(2, '0'); }
      else {
        m = t.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})(?:\s|$)/);
        if (m) key = (parseInt(m[3]) > 50 ? '19' : '20') + m[3] + '-' + m[2].padStart(2, '0');
      }
      if (!key) { m = t.date.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) key = m[1] + '-' + m[2]; }
    }
    if (!key) key = 'unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }
  return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]))
    .map(([k, arr]) => [k, arr.sort((a, b) => (b.dateISO || '').localeCompare(a.dateISO || ''))]);
}

function formatMonth(key: string): string {
  if (!key || key === 'unknown') return '未知月份';
  const [y, m] = key.split('-');
  return `${y}年${parseInt(m)}月`;
}

// ── Detail modals ───────────────────────────────────────────────

export function showWxDetail(wxId: string): void {
  const wx = state.ccLedgerWX.find(t => t.id === wxId);
  if (!wx) return;
  const linkedCc = wx.crossRefId ? state.ccLedgerCC.find(t => t.id === wx.crossRefId) : null;
  let html = `<div style="padding:18px;max-width:100%;overflow:hidden">
    <h4 style="margin:0 0 14px;font-size:15px">💬 微信支付交易明细</h4>
    <div style="display:grid;grid-template-columns:80px 1fr;gap:6px 12px;font-size:13px">
      <span style="color:var(--muted)">交易时间</span><span>${esc(wx.date || wx.dateISO || '')}</span>
      <span style="color:var(--muted)">描述</span><span style="word-break:break-all">${esc(wx.description)}</span>
      <span style="color:var(--muted)">金额</span><span style="color:var(--green);font-weight:700">¥ ${wx.amount.toFixed(2)}</span>
      ${wx.paymentMethod ? `<span style="color:var(--muted)">支付方式</span><span>${esc(wx.paymentMethod)}</span>` : ''}
    </div>`;
  if (linkedCc || wx.crossRefRate) {
    html += `<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--bdr)">
      <h5 style="margin:0 0 10px;font-size:12px;color:var(--blue)">🔗 对应信用卡扣款</h5>
      <div style="display:grid;grid-template-columns:80px 1fr;gap:6px 12px;font-size:13px">`;
    if (linkedCc) {
      html += `<span style="color:var(--muted)">银行</span><span>${esc(bankLabel(linkedCc.detectedBank))}</span>
        <span style="color:var(--muted)">日期</span><span>${esc(linkedCc.date || linkedCc.dateISO || '')}</span>
        <span style="color:var(--muted)">描述</span><span style="word-break:break-all">${esc(linkedCc.description)}</span>
        <span style="color:var(--muted)">金额</span><span style="color:var(--green);font-weight:700">RM ${linkedCc.amount.toFixed(2)}</span>`;
    }
    if (wx.crossRefRate) html += `<span style="color:var(--muted)">汇率</span><span style="color:var(--blue);font-weight:600">¥ 1 = RM ${wx.crossRefRate.toFixed(4)}</span>`;
    html += '</div></div>';
  }
  html += `<div style="text-align:right;margin-top:14px"><button class="btn btn-ghost btn-sm" onclick="this.closest('.modal').classList.remove('show')">关闭</button></div></div>`;
  showDetailModal('wx-detail-modal', html);
}

export function showCcDetail(ccId: string): void {
  const cc = state.ccLedgerCC.find(t => t.id === ccId);
  if (!cc) return;
  const bk = bankLabel(cc.detectedBank);
  const linkedWx = cc.crossRefId ? state.ccLedgerWX.find(t => t.id === cc.crossRefId) : null;
  const wxAmt = linkedWx ? linkedWx.amount : (cc.crossRefRate ? (cc.amount / cc.crossRefRate) : null);
  let html = `<div style="padding:18px"><h4 style="margin:0 0 14px;font-size:15px">💳 信用卡交易明细</h4>
    <div style="display:grid;grid-template-columns:90px 1fr;gap:6px 12px;font-size:13px">
      <span style="color:var(--muted)">交易日期</span><span>${esc(cc.date || cc.dateISO || '')}</span>
      <span style="color:var(--muted)">银行</span><span>${esc(bk)}</span>
      <span style="color:var(--muted)">描述</span><span style="word-break:break-all">${esc(cc.description)}</span>
      <span style="color:var(--muted)">金额</span><span style="color:var(--green);font-weight:700">RM ${cc.amount.toFixed(2)}</span>
    </div>`;
  if (linkedWx || cc.crossRefRate) {
    html += `<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--bdr)">
      <h5 style="margin:0 0 10px;font-size:12px;color:#07c160">🔗 关联微信支付交易</h5>
      <div style="display:grid;grid-template-columns:90px 1fr;gap:6px 12px;font-size:13px">`;
    if (linkedWx) {
      html += `<span style="color:var(--muted)">交易时间</span><span>${esc(linkedWx.date || linkedWx.dateISO || '')}</span>
        <span style="color:var(--muted)">描述</span><span style="word-break:break-all">${esc(linkedWx.description)}</span>
        <span style="color:var(--muted)">金额</span><span style="color:var(--green);font-weight:700">¥ ${linkedWx.amount.toFixed(2)}</span>
        ${linkedWx.paymentMethod ? `<span style="color:var(--muted)">支付方式</span><span>${esc(linkedWx.paymentMethod)}</span>` : ''}`;
    } else if (wxAmt) {
      html += `<span style="color:var(--muted)">微信金额</span><span style="color:var(--green);font-weight:700">¥ ${wxAmt.toFixed(2)}</span>`;
    }
    if (cc.crossRefRate) html += `<span style="color:var(--muted)">汇率</span><span style="color:var(--blue);font-weight:600">¥ 1 = RM ${cc.crossRefRate.toFixed(4)}</span>`;
    html += '</div></div>';
  }
  html += `<div style="text-align:right;margin-top:14px"><button class="btn btn-ghost btn-sm" onclick="this.closest('.modal').classList.remove('show')">关闭</button></div></div>`;
  showDetailModal('cc-detail-modal', html);
}

function showDetailModal(id: string, html: string): void {
  let modal = document.getElementById(id);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = id;
    modal.className = 'modal';
    modal.innerHTML = '<div class="modal-box" style="width:480px;max-width:90vw;overflow:hidden"></div>';
    modal.addEventListener('click', e => { if (e.target === modal) modal!.classList.remove('show'); });
    document.body.appendChild(modal);
  }
  modal.querySelector('.modal-box')!.innerHTML = html;
  modal.classList.add('show');
}

// ── Clear / Delete ──────────────────────────────────────────────

export function clearLedgerSource(source: string): void {
  const label = source === 'wx' ? '微信支付' : '信用卡';
  showConfirm(`确定要清空${label}账本吗？此操作不可恢复。`, async () => {
    try {
      const d = await api.clearLedger(source);
      if (d.ok) {
        showToast(`已清空${label}账本`, 'success');
        await loadFromLedger();
        if (state.activeCCTab === 'wx') renderCCLedgerWX(); else renderCCLedgerCC();
      }
    } catch (e: any) { showToast('清空失败: ' + e.message, 'error'); }
  }, '清空确认', '🗑', 'btn-danger');
}

export async function deleteLedgerTxnAction(txnId: string): Promise<void> {
  showConfirm('确定要删除此交易记录吗？', async () => {
    try {
      const d = await api.deleteLedgerTxn(txnId);
      if (d.ok) {
        showToast('交易已删除', 'success');
        await loadFromLedger();
        if (state.activeCCTab === 'wx') renderCCLedgerWX(); else renderCCLedgerCC();
      }
    } catch (e: any) { showToast('删除失败: ' + e.message, 'error'); }
  });
}

// ── Auto-link ───────────────────────────────────────────────────

async function fetchHistoricalRates(dates: string[]): Promise<Record<string, number>> {
  if (!dates.length) return {};
  const sorted = [...dates].sort();
  try {
    const d = await api.getHistoricalRates(sorted[0], sorted[sorted.length - 1]);
    return (d.ok && d.rates) ? d.rates : {};
  } catch { return {}; }
}

function lookupDailyRate(historicalRates: Record<string, number>, dateISO: string): number | null {
  if (historicalRates[dateISO]) return historicalRates[dateISO];
  const allDates = Object.keys(historicalRates).sort();
  let best: string | null = null;
  for (const d of allDates) {
    if (d <= dateISO) best = d;
    else break;
  }
  return best ? historicalRates[best] : null;
}

export async function autoLinkWxCc(): Promise<void> {
  const MAX_DAY_DIFF = 2;
  const RATE_TOLERANCE_UP = 0.02;
  const RATE_TOLERANCE_DOWN = 0.01;
  const unlinkedWx = state.ccLedgerWX.filter(t => !t.crossRefId);
  const unlinkedCc = state.ccLedgerCC.filter(t => !t.crossRefId && isWechatRelated(t.description));
  if (!unlinkedWx.length || !unlinkedCc.length) { showToast('没有可匹配的未关联交易'); return; }

  // Collect unique dates and fetch historical rates
  const allDates = new Set<string>();
  for (const t of [...unlinkedWx, ...unlinkedCc]) {
    if (t.dateISO) allDates.add(t.dateISO.slice(0, 10));
  }
  showToast('正在获取历史汇率...', 'info');
  const historicalRates = await fetchHistoricalRates([...allDates]);
  if (!Object.keys(historicalRates).length) {
    showToast('无法获取历史汇率，请检查网络连接', 'error');
    return;
  }

  const usedCcIds = new Set<string>();
  const proposals: AutoLinkProposal[] = [];
  let globalRateMin = Infinity, globalRateMax = -Infinity;
  const sortedWx = [...unlinkedWx].sort((a, b) => b.amount - a.amount);

  for (const wx of sortedWx) {
    if (wx.amount <= 0) continue;
    const wxDate = wx.dateISO || '';
    if (!wxDate) continue;
    const refRate = lookupDailyRate(historicalRates, wxDate.slice(0, 10));
    if (!refRate) continue;
    const rMin = refRate - RATE_TOLERANCE_DOWN, rMax = refRate + RATE_TOLERANCE_UP;
    let bestCc: CCTransaction | null = null, bestScore = Infinity;
    for (const cc of unlinkedCc) {
      if (usedCcIds.has(cc.id) || cc.amount <= 0) continue;
      const ccDate = cc.dateISO || '';
      if (!ccDate) continue;
      const daysDiff = Math.abs((new Date(ccDate).getTime() - new Date(wxDate).getTime()) / 86400000);
      if (daysDiff > MAX_DAY_DIFF) continue;
      const rate = cc.amount / wx.amount;
      if (rate < rMin || rate > rMax) continue;
      const score = Math.abs(rate - refRate) + daysDiff * 0.01;
      if (score < bestScore) { bestScore = score; bestCc = cc; }
    }
    if (bestCc) {
      const rate = bestCc.amount / wx.amount;
      proposals.push({ wx, cc: bestCc, rate, accepted: true, refRate });
      usedCcIds.add(bestCc.id);
      if (rate < globalRateMin) globalRateMin = rate;
      if (rate > globalRateMax) globalRateMax = rate;
    }
  }
  if (!proposals.length) {
    const sampleDate = sortedWx[0]?.dateISO?.slice(0, 10) || '';
    const sampleRate = lookupDailyRate(historicalRates, sampleDate);
    const rateStr = sampleRate ? `${(sampleRate - RATE_TOLERANCE_DOWN).toFixed(4)}-${(sampleRate + RATE_TOLERANCE_UP).toFixed(4)}` : 'N/A';
    showToast(`未找到符合条件的匹配（日期±2天，汇率${rateStr}）`);
    return;
  }
  const ap = proposals as typeof state.autoLinkProposals;
  ap._rateMin = globalRateMin;
  ap._rateMax = globalRateMax;
  ap._rateTolerance = RATE_TOLERANCE_UP;
  state.setAutoLinkProposals(ap);
  showAutoLinkReview();
}

// Auto-link review modal (simplified — uses innerHTML like original)
function showAutoLinkReview(): void {
  const proposals = state.autoLinkProposals;
  const acceptedCount = proposals.filter(p => p.accepted).length;
  // Build HTML (simplified from original but functionally identical)
  let rowsHtml = '';
  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i];
    const rr = p.refRate; const rTol = proposals._rateTolerance || 0.02;
    const rateColor = p.rate >= (rr - rTol) && p.rate <= (rr + rTol) ? 'var(--blue)' : 'var(--orange)';
    rowsHtml += `<tr class="autolink-row ${p.accepted ? '' : 'autolink-rejected'}" id="autolink-row-${i}">
      <td style="width:30px;text-align:center"><input type="checkbox" ${p.accepted ? 'checked' : ''} data-autolink-idx="${i}" style="accent-color:var(--blue);width:16px;height:16px;cursor:pointer"></td>
      <td><div style="font-size:12px">${esc(p.wx.description)}</div><div style="font-size:10px;color:var(--muted)">${esc(p.wx.date)} · ${esc(p.wx.paymentMethod || '')}</div></td>
      <td style="text-align:right;white-space:nowrap;font-weight:600;color:var(--green)">¥ ${p.wx.amount.toFixed(2)}</td>
      <td style="text-align:center;font-size:16px">↔</td>
      <td><div style="font-size:12px">${esc(p.cc.description)}</div><div style="font-size:10px;color:var(--muted)">${esc(p.cc.date)} · ${esc(bankLabel(p.cc.detectedBank))} · 参考汇率:${(p.refRate || 0).toFixed(3)}</div></td>
      <td style="text-align:right;white-space:nowrap;font-weight:600;color:var(--green)">RM ${p.cc.amount.toFixed(2)}</td>
      <td style="text-align:center;font-weight:600;color:${rateColor};font-size:12px">${p.rate.toFixed(4)}</td>
    </tr>`;
  }
  const html = `<div style="padding:24px;max-width:100%">
    <h3 style="margin:0 0 6px;font-size:16px">🔗 一键关联预览</h3>
    <p style="margin:0 0 16px;font-size:12px;color:var(--muted)">
      找到 <b style="color:var(--blue)">${proposals.length}</b> 组匹配（日期±2天，汇率范围 ¥1 = RM ${(proposals._rateMin || 0).toFixed(2)}-${(proposals._rateMax || 0).toFixed(2)}）。请逐条检查，取消不正确的关联。
    </p>
    <div style="max-height:55vh;overflow-y:auto;border:1px solid var(--bdr);border-radius:8px">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:var(--surf2);position:sticky;top:0">
          <th style="padding:8px 4px;width:30px"><input type="checkbox" checked id="autolink-all-cb" style="accent-color:var(--blue);width:16px;height:16px;cursor:pointer" title="全选/取消全选"></th>
          <th style="padding:8px;text-align:left">微信交易</th><th style="padding:8px;text-align:right">微信金额</th>
          <th style="padding:8px;width:30px"></th>
          <th style="padding:8px;text-align:left">信用卡交易</th><th style="padding:8px;text-align:right">CC金额</th>
          <th style="padding:8px;text-align:center">汇率</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px">
      <span style="font-size:12px;color:var(--muted)" id="autolink-count">已选 ${acceptedCount} / ${proposals.length} 条</span>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" id="autolink-cancel-btn">取消</button>
        <button class="btn btn-pri btn-sm" id="autolink-confirm-btn">✅ 确认关联 (${acceptedCount})</button>
      </div>
    </div>
  </div>`;

  let modal = document.getElementById('autolink-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'autolink-modal';
    modal.className = 'modal';
    modal.innerHTML = '<div class="modal-box" style="width:900px;max-width:95vw;padding:0;overflow:hidden"></div>';
    modal.addEventListener('click', e => { if (e.target === modal) closeAutoLinkReview(); });
    document.body.appendChild(modal);
  }
  modal.querySelector('.modal-box')!.innerHTML = html;
  modal.classList.add('show');

  // Wire up events
  modal.querySelector('#autolink-cancel-btn')?.addEventListener('click', closeAutoLinkReview);
  modal.querySelector('#autolink-confirm-btn')?.addEventListener('click', confirmAutoLink);
  modal.querySelector('#autolink-all-cb')?.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    for (let i = 0; i < state.autoLinkProposals.length; i++) {
      state.autoLinkProposals[i].accepted = checked;
      const row = document.getElementById('autolink-row-' + i);
      if (row) { row.className = 'autolink-row ' + (checked ? '' : 'autolink-rejected'); const cb = row.querySelector('input[type=checkbox]') as HTMLInputElement | null; if (cb) cb.checked = checked; }
    }
    updateAutoLinkCount();
  });
  modal.querySelectorAll('[data-autolink-idx]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const idx = parseInt((e.target as HTMLElement).getAttribute('data-autolink-idx')!);
      const checked = (e.target as HTMLInputElement).checked;
      state.autoLinkProposals[idx].accepted = checked;
      const row = document.getElementById('autolink-row-' + idx);
      if (row) row.className = 'autolink-row ' + (checked ? '' : 'autolink-rejected');
      updateAutoLinkCount();
    });
  });
}

function updateAutoLinkCount(): void {
  const accepted = state.autoLinkProposals.filter(p => p.accepted).length;
  const total = state.autoLinkProposals.length;
  const countEl = document.getElementById('autolink-count');
  if (countEl) countEl.textContent = `已选 ${accepted} / ${total} 条`;
  const btn = document.getElementById('autolink-confirm-btn');
  if (btn) btn.textContent = '✅ 确认关联 (' + accepted + ')';
}

function confirmAutoLink(): void {
  const accepted = state.autoLinkProposals.filter(p => p.accepted);
  if (!accepted.length) { showToast('没有选择任何关联'); return; }
  for (const p of accepted) {
    const wx = state.ccLedgerWX.find(t => t.id === p.wx.id);
    const cc = state.ccLedgerCC.find(t => t.id === p.cc.id);
    if (!wx || !cc) continue;
    wx.crossRefId = cc.id; cc.crossRefId = wx.id;
    wx.manualCrossRef = true; cc.manualCrossRef = true;
    wx.crossRefRate = p.rate; cc.crossRefRate = p.rate;
  }
  saveLedger();
  closeAutoLinkReview();
  showToast(`✅ 已关联 ${accepted.length} 条交易`);
  renderCCLedgerCC(); renderCCLedgerWX();
}

function closeAutoLinkReview(): void {
  state.setAutoLinkProposals([] as any);
  document.getElementById('autolink-modal')?.classList.remove('show');
}

export function unlinkAllCrossRef(): void {
  const linked = state.ccLedgerWX.filter(t => t.crossRefId);
  if (!linked.length) { showToast('没有已关联的微信交易'); return; }
  showConfirm(`确定要取消全部 <b>${linked.length}</b> 条微信↔信用卡关联吗？`, () => {
    for (const wx of linked) {
      const cc = state.ccLedgerCC.find(t => t.id === wx.crossRefId);
      if (cc) { delete cc.crossRefId; delete cc.crossRefRate; delete cc.manualCrossRef; }
      delete wx.crossRefId; delete wx.crossRefRate; delete wx.manualCrossRef;
    }
    saveLedger();
    showToast(`✅ 已取消 ${linked.length} 条关联`);
    renderCCLedgerCC(); renderCCLedgerWX();
  }, '取消关联确认', '⚠️', 'btn-danger');
}

// ── Render CC Ledger ────────────────────────────────────────────
// These are large render functions — kept as innerHTML for performance

export function renderCCLedgerCC(): void {
  const container = document.getElementById('cc-ledger-body-cc');
  if (!container) return;
  if (!state.ccLedgerCC.length) {
    container.innerHTML = '<div class="empty"><div class="icon">💳</div><h3>账本为空</h3><p style="font-size:12px;color:var(--muted)">上传信用卡账单，数据会自动保存到账本</p></div>';
    return;
  }
  const ccMonths = groupByMonth(state.ccLedgerCC);
  const ccTotal = state.ccLedgerCC.reduce((s, t) => s + t.amount, 0);
  const ccLinked = state.ccLedgerCC.filter(t => t.crossRefId).length;

  const banks: Record<string, { count: number; total: number }> = {};
  for (const t of state.ccLedgerCC) { const b = bankLabel(t.detectedBank); if (!banks[b]) banks[b] = { count: 0, total: 0 }; banks[b].count++; banks[b].total += t.amount; }
  const bankEntries = Object.entries(banks).sort((a, b) => b[1].count - a[1].count);

  let html = `<div class="ledger-section"><div class="ledger-section-head"><div>
    <span style="font-size:15px;font-weight:700">💳 信用卡交易</span>
    <span style="font-size:12px;color:var(--muted);margin-left:8px">${ccMonths.length} 个月 / ${state.ccLedgerCC.length} 条</span>
    ${ccLinked ? `<span style="font-size:11px;color:var(--blue);margin-left:8px">🔗 ${ccLinked} 条已关联微信</span>` : ''}
    </div><span style="font-weight:700;color:var(--green)">RM ${ccTotal.toLocaleString('en-MY', { minimumFractionDigits: 2 })}</span></div>`;

  if (bankEntries.length > 0) {
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px">';
    for (const [bk, bv] of bankEntries) html += `<span class="bank-chip">💳 ${esc(bk)}: ${bv.count} 条 (RM ${bv.total.toFixed(2)})</span>`;
    html += '</div>';
  }

  for (const [monthKey, txns] of ccMonths) {
    const mTotal = txns.reduce((s, t) => s + t.amount, 0);
    html += `<div class="ledger-month"><div class="ledger-month-header" onclick="this.parentElement.classList.toggle('collapsed')">
      <span>📅 ${formatMonth(monthKey)}</span><span class="ledger-month-meta">${txns.length} 条 · RM ${mTotal.toFixed(2)} <span class="ledger-chevron">▼</span></span></div>
      <div class="ledger-month-body"><table class="ledger-txn-table"><thead><tr><th>日期</th><th>银行</th><th>描述</th><th style="text-align:right">金额</th><th style="width:120px"></th></tr></thead><tbody>`;
    for (const t of txns) {
      if (state.pendingCrossRef && state.pendingCrossRef.source === 'wx' && (t.crossRefId || !isWechatRelated(t.description))) continue;
      const bk = bankLabel(t.detectedBank);
      let wxLink = '';
      if (t.crossRefId) {
        wxLink = `<button class="btn btn-ghost" style="font-size:10px;padding:2px 6px" data-show-wx="${t.crossRefId}" title="查看关联微信交易">💬🔗</button><button class="btn btn-ghost" style="font-size:9px;padding:1px 4px;color:var(--orange)" data-unlink-cc="${t.id}" title="取消关联">⛓‍💥</button>`;
      } else if (state.pendingCrossRef && state.pendingCrossRef.source === 'wx') {
        wxLink = `<button class="btn" style="font-size:10px;padding:2px 8px;background:var(--blue);color:#fff;border:none;border-radius:4px" data-confirm-crossref="${t.id}" title="选择关联">✓ 关联</button>`;
      } else {
        wxLink = `<button class="btn btn-ghost" style="font-size:10px;padding:2px 6px;color:var(--blue)" data-manual-crossref-cc="${t.id}" title="手动关联微信">🔗</button>`;
      }
      const assignBtn = `<button class="cc-assign-btn" style="font-size:10px;padding:2px 6px" data-ledger-assign-cc="${t.id}" title="指定到发票">📌</button>`;
      const assigned = t.assignedToInvoiceId ? `<span style="font-size:10px;color:var(--green)">✅</span>` : assignBtn;
      html += `<tr class="${state.pendingCrossRef && state.pendingCrossRef.source === 'wx' && !t.crossRefId ? 'crossref-selectable' : ''}">
        <td style="white-space:nowrap">${esc(t.date)}</td>
        <td><span class="bank-chip" style="font-size:9px;padding:1px 6px">${esc(bk)}</span></td>
        <td>${esc(t.description)}${t.crossRefRate ? `<div style="font-size:10px;color:var(--muted)">🔗 ¥${(t.amount / t.crossRefRate).toFixed(2)}</div>` : ''}</td>
        <td style="text-align:right;font-weight:600;color:var(--green)">RM ${t.amount.toFixed(2)}</td>
        <td style="text-align:right">${assigned}${wxLink}<button class="btn btn-ghost" style="font-size:10px;padding:2px 6px;color:var(--orange)" data-delete-txn="${t.id}" title="删除">✕</button></td>
      </tr>`;
    }
    html += '</tbody></table></div></div>';
  }
  html += `<div style="margin-top:10px"><button class="btn btn-danger btn-sm" style="font-size:11px" data-clear-ledger="cc">🗑 清空信用卡账本</button></div></div>`;
  container.innerHTML = html;
  wireUpCCLedgerEvents(container);
}

export function renderCCLedgerWX(): void {
  const container = document.getElementById('cc-ledger-body-wx');
  if (!container) return;
  if (!state.ccLedgerWX.length) {
    container.innerHTML = '<div class="empty"><div class="icon">💬</div><h3>账本为空</h3><p style="font-size:12px;color:var(--muted)">上传微信支付账单，数据会自动保存到账本</p></div>';
    return;
  }
  const wxMonths = groupByMonth(state.ccLedgerWX);
  const wxTotal = state.ccLedgerWX.reduce((s, t) => s + t.amount, 0);
  const wxLinked = state.ccLedgerWX.filter(t => t.crossRefId).length;

  let html = `<div class="ledger-section"><div class="ledger-section-head"><div>
    <span style="font-size:15px;font-weight:700">💬 微信支付交易</span>
    <span style="font-size:12px;color:var(--muted);margin-left:8px">${wxMonths.length} 个月 / ${state.ccLedgerWX.length} 条</span>
    ${wxLinked ? `<span style="font-size:11px;color:var(--blue);margin-left:8px">🔗 ${wxLinked} 条已关联信用卡</span>` : ''}
    <button class="btn btn-sm" style="margin-left:10px;font-size:11px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;padding:3px 10px;border-radius:6px" data-autolink>🔗 一键关联</button>
    <button class="btn btn-sm" style="margin-left:6px;font-size:11px;background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3);padding:3px 10px;border-radius:6px" data-unlink-all>⛓️ 一键取消</button>
    </div><span style="font-weight:700;color:var(--green)">¥ ${wxTotal.toLocaleString('en-MY', { minimumFractionDigits: 2 })}</span></div>`;

  for (const [monthKey, txns] of wxMonths) {
    const mTotal = txns.reduce((s, t) => s + t.amount, 0);
    html += `<div class="ledger-month"><div class="ledger-month-header" onclick="this.parentElement.classList.toggle('collapsed')">
      <span>📅 ${formatMonth(monthKey)}</span><span class="ledger-month-meta">${txns.length} 条 · ¥ ${mTotal.toFixed(2)} <span class="ledger-chevron">▼</span></span></div>
      <div class="ledger-month-body"><table class="ledger-txn-table"><thead><tr><th>日期</th><th>描述</th><th>支付方式</th><th style="text-align:right">金额</th><th style="width:120px"></th></tr></thead><tbody>`;
    for (const t of txns) {
      let ccLink = '';
      if (t.crossRefId) {
        ccLink = `<button class="btn btn-ghost" style="font-size:10px;padding:2px 6px" data-show-cc="${t.crossRefId}" title="查看关联信用卡交易">💳🔗</button><button class="btn btn-ghost" style="font-size:9px;padding:1px 4px;color:var(--orange)" data-unlink-wx="${t.id}" title="取消关联">⛓‍💥</button>`;
      } else if (state.pendingCrossRef && state.pendingCrossRef.source === 'cc') {
        ccLink = `<button class="btn" style="font-size:10px;padding:2px 8px;background:var(--blue);color:#fff;border:none;border-radius:4px" data-confirm-crossref="${t.id}" title="选择关联">✓ 关联</button>`;
      } else {
        ccLink = `<button class="btn btn-ghost" style="font-size:10px;padding:2px 6px;color:var(--blue)" data-manual-crossref-wx="${t.id}" title="手动关联信用卡">🔗</button>`;
      }
      const assignBtn = `<button class="cc-assign-btn" style="font-size:10px;padding:2px 6px" data-ledger-assign-wx="${t.id}" title="指定到发票">📌</button>`;
      const assigned = t.assignedToInvoiceId ? `<span style="font-size:10px;color:var(--green)">✅</span>` : assignBtn;
      html += `<tr class="${state.pendingCrossRef && state.pendingCrossRef.source === 'cc' && !t.crossRefId ? 'crossref-selectable' : ''}">
        <td style="white-space:nowrap">${esc(t.date)}</td>
        <td>${esc(t.description)}${t.crossRefRate ? `<div style="font-size:10px;color:var(--muted)">🔗 RM ${(t.amount * t.crossRefRate).toFixed(2)}</div>` : ''}</td>
        <td style="font-size:11px;color:var(--muted)">${esc(t.paymentMethod || '')}</td>
        <td style="text-align:right;font-weight:600;color:var(--green)">¥ ${t.amount.toFixed(2)}</td>
        <td style="text-align:right">${assigned}${ccLink}<button class="btn btn-ghost" style="font-size:10px;padding:2px 6px;color:var(--orange)" data-delete-txn="${t.id}" title="删除">✕</button></td>
      </tr>`;
    }
    html += '</tbody></table></div></div>';
  }
  html += `<div style="margin-top:10px"><button class="btn btn-danger btn-sm" style="font-size:11px" data-clear-ledger="wx">🗑 清空微信支付账本</button></div></div>`;
  container.innerHTML = html;
  wireUpCCLedgerEvents(container);
}

// ── Event delegation for CC ledger ──────────────────────────────

function wireUpCCLedgerEvents(container: HTMLElement): void {
  container.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('button, [data-show-wx], [data-show-cc]') as HTMLElement | null;
    if (!target) return;

    const showWx = target.getAttribute('data-show-wx');
    if (showWx) { showWxDetail(showWx); return; }
    const showCc = target.getAttribute('data-show-cc');
    if (showCc) { showCcDetail(showCc); return; }
    const unlinkCc = target.getAttribute('data-unlink-cc');
    if (unlinkCc) { unlinkCrossRef(unlinkCc, 'cc'); return; }
    const unlinkWx = target.getAttribute('data-unlink-wx');
    if (unlinkWx) { unlinkCrossRef(unlinkWx, 'wx'); return; }
    const confirmCr = target.getAttribute('data-confirm-crossref');
    if (confirmCr) { confirmManualCrossRef(confirmCr); return; }
    const manualCrCc = target.getAttribute('data-manual-crossref-cc');
    if (manualCrCc) { startManualCrossRef(manualCrCc, 'cc'); return; }
    const manualCrWx = target.getAttribute('data-manual-crossref-wx');
    if (manualCrWx) { startManualCrossRef(manualCrWx, 'wx'); return; }
    const assignCc = target.getAttribute('data-ledger-assign-cc');
    if (assignCc) { startLedgerAssign(assignCc, 'cc'); return; }
    const assignWx = target.getAttribute('data-ledger-assign-wx');
    if (assignWx) { startLedgerAssign(assignWx, 'wx'); return; }
    const deleteTxn = target.getAttribute('data-delete-txn');
    if (deleteTxn) { deleteLedgerTxnAction(deleteTxn); return; }
    const clearLedgerSrc = target.getAttribute('data-clear-ledger');
    if (clearLedgerSrc) { clearLedgerSource(clearLedgerSrc); return; }
    if (target.hasAttribute('data-autolink')) { autoLinkWxCc(); return; }
    if (target.hasAttribute('data-unlink-all')) { unlinkAllCrossRef(); return; }
  });
}
