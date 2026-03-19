import type { InvoiceRow, ArchivedClaim, CCTransaction, MemoryData, SortDirection, AutoLinkProposal } from './types';

// ── State ────────────────────────────────────────────────────────

export let rows: InvoiceRow[] = [];
export let rates: Record<string, number> = { USD: 4.45, CNY: 0.62, SGD: 3.35, EUR: 4.85, GBP: 5.75, MYR: 1 };
export let ratesLive = false;
export let claimsFolder = '';

export let pendingRow: InvoiceRow | null = null;

export let chartInstances: Record<string, any> = {};

export let saveTimer: ReturnType<typeof setTimeout> | null = null;

export let selectedRows = new Set<string>();

export let sortCol: string | null = null;
export let sortDir: SortDirection = 'asc';

export let archivedClaims: ArchivedClaim[] = [];
export let activeRecordTab: 'current' | 'archived' = 'current';
export let archiveSearch = '';

export let memoryData: MemoryData = { suppliers: {}, customSuppliers: [], customDescriptions: {} };

export let branchHistoryMap = new Map<string, Array<{ branch: string; claimDate: string; invoiceDate: string }>>();
export let activeBranchPopover: HTMLElement | null = null;

export let recordSearch = '';
export let filterBranches = new Set<string>();

export let ccLedgerCC: CCTransaction[] = [];
export let ccLedgerWX: CCTransaction[] = [];
export let activeCCTab: 'cc' | 'wx' = 'cc';
export let portableMode = false;
export let pendingCCAssign: { txnId: string; source: string } | null = null;
export let pendingCrossRef: { txnId: string; source: string; description: string; amount: number } | null = null;

export let confirmCallback: (() => void) | null = null;

export let lastArchivePath = '';

export let branchAddresses: Record<string, string> = {};

export let notesTargetId: string | null = null;

export let autoLinkProposals: AutoLinkProposal[] & { _rateMin?: number; _rateMax?: number; _rateTolerance?: number } = [] as any;

// ── Setters (for external modules to mutate shared state) ────────

export function setRows(val: InvoiceRow[]) { rows = val; }
export function setRates(val: Record<string, number>) { rates = val; }
export function setRatesLive(val: boolean) { ratesLive = val; }
export function setClaimsFolder(val: string) { claimsFolder = val; }
export function setPendingRow(val: InvoiceRow | null) { pendingRow = val; }
export function setSaveTimer(val: ReturnType<typeof setTimeout> | null) { saveTimer = val; }
export function setSortCol(val: string | null) { sortCol = val; }
export function setSortDir(val: SortDirection) { sortDir = val; }
export function setArchivedClaims(val: ArchivedClaim[]) { archivedClaims = val; }
export function setActiveRecordTab(val: 'current' | 'archived') { activeRecordTab = val; }
export function setArchiveSearch(val: string) { archiveSearch = val; }
export function setMemoryData(val: MemoryData) { memoryData = val; }
export function setBranchHistoryMap(val: typeof branchHistoryMap) { branchHistoryMap = val; }
export function setActiveBranchPopover(val: HTMLElement | null) { activeBranchPopover = val; }
export function setRecordSearch(val: string) { recordSearch = val; }
export function setCcLedgerCC(val: CCTransaction[]) { ccLedgerCC = val; }
export function setCcLedgerWX(val: CCTransaction[]) { ccLedgerWX = val; }
export function setActiveCCTab(val: 'cc' | 'wx') { activeCCTab = val; }
export function setPortableMode(val: boolean) { portableMode = val; }
export function setPendingCCAssign(val: typeof pendingCCAssign) { pendingCCAssign = val; }
export function setPendingCrossRef(val: typeof pendingCrossRef) { pendingCrossRef = val; }
export function setConfirmCallback(val: (() => void) | null) { confirmCallback = val; }
export function setLastArchivePath(val: string) { lastArchivePath = val; }
export function setBranchAddresses(val: Record<string, string>) { branchAddresses = val; }
export function setNotesTargetId(val: string | null) { notesTargetId = val; }
export function setAutoLinkProposals(val: typeof autoLinkProposals) { autoLinkProposals = val; }

// ── Helper to get a row by ID ────────────────────────────────────
export function getRow(id: string): InvoiceRow | undefined {
  return rows.find(r => r.id === id);
}
