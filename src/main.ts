// ── Main Entry Point ─────────────────────────────────────────────
// Wires all modules together, registers global handlers, runs init.

import * as state from './state';
import * as api from './api';
import { showToast, closeConfirm, openExternal, closeImgModal, showImg } from './utils';
import { registerSwitchTab } from './main-helpers';
import { initShortcuts, createShortcutBar, registerShortcut } from './shortcuts';
import { initDarkMode, createThemeToggle } from './dark-mode';
import { renderDashboard, resetDashDates } from './dashboard';
import { renderTable, updateCounts, initTableEvents, buildBranchHistoryMap,
  toggleSort, toggleSelectAll, toggleSelectRow, deleteSelected,
  searchRecords, resetFilters, toggleBranchFilter, initBranchFilterDropdown,
  showBranchHistory, closeBranchPopover, toggleNotes, closeNotesModal,
  applyBulkBranch, applyBulkCategory, applyBulkDescription, applyBulkClaimDate, setAllClaimDateToday,
  updateField, updateCurrency, updateOrigAmt, deleteRow,
  validateAmountField, validateDateField,
  updateBranchFilterUI } from './records';
import { onDragOver, onDragLeave, onDrop, handleFileSelect, processFile,
  scanNewClaim, addManualRow, scheduleSave,
  showDupModal, cancelDup, addAnyway, cancelScan } from './upload';
import { loadArchive, switchRecordTab, renderArchive, exportExcel,
  completeClaim, closeCompleteModal, openArchiveFolder } from './archive';
import { showModal, closeModal, saveSettings, loadFolderSetting,
  browseFolderPicker, loadRates, renderRates, loadMemory, checkApiKey,
  addBranchAddressRow, rebuildMemory, togglePortableMode } from './settings';
import { switchCCTab, ccDragOver, ccDragLeave, ccDrop, handleCCFile,
  loadFromLedger, saveLedger, runLedgerCrossRef,
  startLedgerAssign, cancelCCAssign, manualAssignCC,
  startManualCrossRef, confirmManualCrossRef, cancelManualCrossRef,
  unlinkCrossRef, showWxDetail, showCcDetail, clearLedgerSource,
  deleteLedgerTxnAction, autoLinkWxCc, unlinkAllCrossRef,
  renderCCLedgerCC, renderCCLedgerWX } from './cc-ledger';
import type { TabName } from './types';

// ── Tab switching ───────────────────────────────────────────────

function switchTabImpl(tab: string): void {
  const tabs: TabName[] = ["upload", "records", "cc", "dash"];
  tabs.forEach(t => {
    const btn = document.getElementById("tab-" + t);
    const pane = document.getElementById("pane-" + t);
    if (btn) {
      btn.className = "tab" + (t === tab ? " active" : "");
      btn.setAttribute("aria-selected", t === tab ? "true" : "false");
    }
    if (pane) pane.style.display = t === tab ? "block" : "none";
  });
  if (tab === "records") {
    renderTable();
    initBranchFilterDropdown();
  }
  if (tab === "dash") renderDashboard();
}

registerSwitchTab(switchTabImpl);

// ── Expose functions to global scope (for inline HTML handlers) ──

const W = window as any;

// Tab switching
W.switchTab = switchTabImpl;

// Utils
W.closeConfirm = closeConfirm;
W.openExternal = openExternal;
W.closeImgModal = closeImgModal;
W.showImg = showImg;

// Settings
W.showModal = showModal;
W.closeModal = closeModal;
W.saveSettings = saveSettings;
W.browseFolderPicker = browseFolderPicker;
W.addBranchAddressRow = addBranchAddressRow;
W.rebuildMemory = rebuildMemory;
W.togglePortableMode = togglePortableMode;

// Upload
W.onDragOver = onDragOver;
W.onDragLeave = onDragLeave;
W.onDrop = onDrop;
W.handleFileSelect = handleFileSelect;
W.scanNewClaim = scanNewClaim;
W.addManualRow = addManualRow;
W.cancelDup = cancelDup;
W.addAnyway = addAnyway;
W.cancelScan = cancelScan;

// Onboarding
W.closeOnboarding = () => {
  const el = document.getElementById('onboarding-overlay');
  if (el) el.style.display = 'none';
  showModal();
};

// Records
W.toggleSort = toggleSort;
W.toggleSelectAll = toggleSelectAll;
W.toggleSelectRow = toggleSelectRow;
W.deleteSelected = deleteSelected;
W.searchRecords = searchRecords;
W.resetFilters = resetFilters;
W.toggleBranchFilter = toggleBranchFilter;
W.applyBulkBranch = applyBulkBranch;
W.applyBulkCategory = applyBulkCategory;
W.applyBulkDescription = applyBulkDescription;
W.applyBulkClaimDate = applyBulkClaimDate;
W.setAllClaimDateToday = setAllClaimDateToday;
W.toggleNotes = toggleNotes;
W.closeNotesModal = closeNotesModal;
W.updateField = updateField;
W.updateCurrency = updateCurrency;
W.updateOrigAmt = updateOrigAmt;
W.deleteRow = deleteRow;
W.validateAmountField = validateAmountField;
W.validateDateField = validateDateField;
W.showBranchHistory = showBranchHistory;
W.closeBranchPopover = closeBranchPopover;

// Archive
W.exportExcel = exportExcel;
W.completeClaim = completeClaim;
W.closeCompleteModal = closeCompleteModal;
W.openArchiveFolder = openArchiveFolder;
W.switchRecordTab = switchRecordTab;
W.renderArchive = renderArchive;

// Dashboard
W.renderDashboard = renderDashboard;
W.resetDashDates = resetDashDates;

// CC Ledger
W.switchCCTab = switchCCTab;
W.ccDragOver = ccDragOver;
W.ccDragLeave = ccDragLeave;
W.ccDrop = ccDrop;
W.handleCCFile = handleCCFile;
W.cancelCCAssign = cancelCCAssign;
W.manualAssignCC = manualAssignCC;
W.startManualCrossRef = startManualCrossRef;
W.confirmManualCrossRef = confirmManualCrossRef;
W.cancelManualCrossRef = cancelManualCrossRef;
W.unlinkCrossRef = unlinkCrossRef;
W.showWxDetail = showWxDetail;
W.showCcDetail = showCcDetail;
W.clearLedgerSource = clearLedgerSource;
W.deleteLedgerTxnAction = deleteLedgerTxnAction;
W.autoLinkWxCc = autoLinkWxCc;
W.unlinkAllCrossRef = unlinkAllCrossRef;
W.startLedgerAssign = startLedgerAssign;
W.saveLedger = saveLedger;
W.runLedgerCrossRef = runLedgerCrossRef;

// Upload details collapse (fix 6)
W.toggleUploadDetails = () => {
  const body = document.getElementById('upload-details-body');
  const chevron = document.getElementById('upload-details-chevron');
  if (!body) return;
  const isOpen = !body.classList.contains('collapsed');
  body.classList.toggle('collapsed', isOpen);
  if (chevron) chevron.textContent = isOpen ? '▶' : '▼';
  // Remember preference
  localStorage.setItem('upload-details-collapsed', isOpen ? '1' : '0');
};

// Auto-collapse for returning users
setTimeout(() => {
  const wasCollapsed = localStorage.getItem('upload-details-collapsed');
  if (wasCollapsed === '1') {
    const body = document.getElementById('upload-details-body');
    const chevron = document.getElementById('upload-details-chevron');
    if (body) body.classList.add('collapsed');
    if (chevron) chevron.textContent = '▶';
  }
}, 0);

// Header more-menu (fix 19)
W.toggleHeaderMore = () => {
  const menu = document.getElementById('hdr-more-menu');
  if (!menu) return;
  const isOpen = menu.classList.contains('show');
  menu.classList.toggle('show', !isOpen);
  if (!isOpen) {
    const close = (e: Event) => {
      if (!menu.contains(e.target as Node) && !(e.target as HTMLElement).closest('.hdr-more-btn')) {
        menu.classList.remove('show');
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  }
};

// State access (for inline handlers that reference state directly)
W.selectedRows = state.selectedRows;
W.archiveSearch = "";
Object.defineProperty(W, "archiveSearch", {
  get: () => state.archiveSearch,
  set: (v: string) => { state.setArchiveSearch(v); },
});

// ── Register dynamic shortcuts ──────────────────────────────────

registerShortcut("e", true, (e) => {
  e.preventDefault();
  exportExcel();
});

registerShortcut("a", true, (e) => {
  e.preventDefault();
  toggleSelectAll();
});

registerShortcut("Delete", false, () => {
  if (state.selectedRows.size > 0) deleteSelected();
});

// ── Init ────────────────────────────────────────────────────────

async function init(): Promise<void> {
  // Dark mode first (avoid flash)
  initDarkMode();
  createThemeToggle();

  // Keyboard shortcuts
  initShortcuts();
  createShortcutBar();

  // Load settings & data
  await loadFolderSetting();
  loadRates();

  try {
    const d = await api.getData();
    if (d.rows) {
      state.setRows(d.rows);
      updateCounts();
      renderTable();
    }
  } catch (e) {
    console.error('loadData error:', e);
    showToast('加载数据失败，请检查 Claims Folder 设置', 'error');
  }

  loadMemory();
  loadArchive().then(() => buildBranchHistoryMap());
  loadFromLedger();
  checkApiKey();

  // Table event delegation
  initTableEvents();

  // Archive search binding
  const archiveSearchInput = document.getElementById("archive-search") as HTMLInputElement | null;
  if (archiveSearchInput) {
    archiveSearchInput.addEventListener("input", () => {
      state.setArchiveSearch(archiveSearchInput.value);
      renderArchive();
    });
  }

  // Filter category binding
  const filterCat = document.getElementById("filter-cat") as HTMLSelectElement | null;
  if (filterCat) {
    filterCat.addEventListener("change", () => {
      state.selectedRows.clear();
      renderTable();
    });
  }
}

document.addEventListener("DOMContentLoaded", init);
