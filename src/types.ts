// ── Core Data Types ─────────────────────────────────────────────

export interface InvoiceRow {
  id: string;
  branch: string;
  supplierName: string;
  invoiceNo: string;
  invoiceDate: string;
  category: string;
  description: string;
  amount: string;
  originalAmount: string;
  originalCurrency: string;
  claimDate: string;
  preview: string | null;
  fileName: string;
  localFilePath: string;
  serverFilePath: string;
  ccMatched: boolean;
  ccActualRate: number | null;
  ccAssignedTxnId?: string;
  ccAssignedSource?: string;
  notes: string;
  createdAt: string;
  modifiedAt: string;
}

/** Keys of InvoiceRow that can be edited via the table UI */
export type EditableRowKey = 'branch' | 'supplierName' | 'invoiceNo' | 'invoiceDate'
  | 'category' | 'description' | 'amount' | 'claimDate' | 'notes';

export interface CurrencyInfo {
  flag: string;
  color: string;
}

export interface MemoryData {
  suppliers: Record<string, SupplierMemory>;
  customSuppliers: string[];
  customDescriptions: Record<string, string[]>;
}

export interface SupplierMemory {
  count?: number;
  categories?: Record<string, number>;
  branches?: Record<string, number>;
  variants?: string[];
}

export interface ArchivedClaim {
  id: string;
  date: string;
  archivePath: string;
  excelFile: string;
  fileCount: number;
  invoiceCount: number;
  totalAmount: number;
  rows: InvoiceRow[];
}

export interface CCTransaction {
  id: string;
  date: string;
  dateISO?: string;
  description: string;
  amount: number;
  detectedBank?: string;
  paymentMethod?: string;
  source?: string;
  crossRefId?: string;
  crossRefRate?: number;
  manualCrossRef?: boolean;
  assignedToInvoiceId?: string;
}

export interface DuplicateResult {
  row: InvoiceRow;
  reason: 'invoiceNo' | 'fileName' | 'supplierAmtDate';
  source: 'current' | 'archived';
}

export interface AutoLinkProposal {
  wx: CCTransaction;
  cc: CCTransaction;
  rate: number;
  refRate: number;
  accepted: boolean;
}

export interface AutoLinkState {
  proposals: AutoLinkProposal[];
  rateMin?: number;
  rateMax?: number;
  rateTolerance?: number;
}

export type SortDirection = 'asc' | 'desc';
export type TabName = 'upload' | 'records' | 'cc' | 'dash';
export type RecordSubTab = 'current' | 'archived';
export type CCSubTab = 'cc' | 'wx';
export type ToastType = 'success' | 'error' | 'warning' | 'info';

// ── Undo/Redo Types ─────────────────────────────────────────────

export type UndoActionType = 'field' | 'delete' | 'bulk';

export interface UndoEntry {
  type: UndoActionType;
  description: string;
  undo: () => void;
  redo: () => void;
}

// ── API Response Types ──────────────────────────────────────────

export interface ExtractionData {
  currency: string;
  amount: string;
  invoiceNo: string;
  invoiceDate: string;
  supplierName: string;
  suggestedCategory: string;
  suggestedDescription: string;
  memoryBranch: string;
  memoryBranchFromAddress: string;
  memoryCategory: string;
  memoryCanonicalSupplier: string;
}

export interface ProcessInvoiceResponse {
  ok: boolean;
  data: ExtractionData;
  cached?: boolean;
  serverFilePath?: string;
  fileName?: string;
  localFilePath?: string;
  error?: string;
}

export interface CCParseResponse {
  ok: boolean;
  transactions: CCTransaction[];
  source?: string;
  method?: string;
  error?: string;
}

export interface MergeLedgerResponse {
  ok: boolean;
  added?: number;
  duplicates?: number;
  error?: string;
}

export interface SaveResponse {
  ok: boolean;
  error?: string;
}

export interface CompleteClaimResponse {
  ok: boolean;
  archivePath?: string;
  excelFile?: string;
  fileCount?: number;
  error?: string;
}
