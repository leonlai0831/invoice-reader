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
