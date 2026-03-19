// ── API Layer ────────────────────────────────────────────────────
// All fetch calls to the Flask backend are centralized here.

export async function fetchJson<T = any>(url: string, options?: RequestInit): Promise<T> {
  const r = await fetch(url, options);
  return r.json() as Promise<T>;
}

export async function postJson<T = any>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Config
export const getConfig = () => fetchJson<{ has_key: boolean; masked: string }>('/api/config');
export const saveConfig = (data: Record<string, string>) => postJson('/api/config', data);

// Folder
export const getFolder = () => fetchJson<{ ok: boolean; path: string }>('/api/config/folder');
export const setFolder = (path: string) => postJson('/api/config/folder', { path });
export const browseFolder = () => fetchJson<{ ok: boolean; path: string; error?: string }>('/api/config/browse-folder', { method: 'POST' });

// Portable
export const getPortable = () => fetchJson<{ portable: boolean }>('/api/config/portable');
export const setPortable = (enabled: boolean) => postJson('/api/config/portable', { enabled });

// Rates
export const getRates = () => fetchJson<{ ok: boolean; rates: Record<string, number>; live: boolean }>('/api/rates');
export const getHistoricalRates = (start: string, end: string, base = 'CNY', target = 'MYR') =>
  fetchJson<{ ok: boolean; rates: Record<string, number>; error?: string }>(`/api/rates/history?start=${start}&end=${end}&base=${base}&target=${target}`);

// Data
export const getData = () => fetchJson<{ ok: boolean; rows: any[]; needsFolder?: boolean; error?: string }>('/api/data');
export const saveData = (rows: any[]) => postJson('/api/data', { rows });

// Process
export async function processInvoice(file: File): Promise<any> {
  const fd = new FormData();
  fd.append('file', file);
  return fetchJson('/api/process', { method: 'POST', body: fd });
}

export const processLocal = (filename: string) => postJson('/api/process-local', { filename });
export const scanFolder = () => fetchJson<{ ok: boolean; files: Array<{ name: string; size: number }>; folder?: string; error?: string }>('/api/scan-folder', { method: 'POST' });

// Export
export async function exportExcel(rows: any[]): Promise<Blob> {
  const r = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  if (!r.ok) {
    const d = await r.json();
    throw new Error(d.error || String(r.status));
  }
  return r.blob();
}

// Complete Claim
export const completeClaim = (rows: any[], remainingRows: any[]) => postJson('/api/complete-claim', { rows, remainingRows });

// Archive
export const getArchive = () => fetchJson<{ ok: boolean; claims: any[] }>('/api/archive');

// Memory
export const getMemory = () => fetchJson<{ ok: boolean; suppliers: any; customSuppliers: string[]; customDescriptions: Record<string, string[]> }>('/api/memory');
export const rebuildMemoryApi = () => fetchJson<{ ok: boolean; rowsProcessed?: number; error?: string }>('/api/memory/rebuild', { method: 'POST' });
export const getBranchAddresses = () => fetchJson<{ ok: boolean; branchAddresses: Record<string, string> }>('/api/memory/branches');
export const saveBranchAddresses = (branchAddresses: Record<string, string>) => postJson('/api/memory/branches', { branchAddresses });

// Open Folder
export const openFolder = (path: string) => postJson('/api/open-folder', { path });

// CC Ledger
export const getLedger = () => fetchJson<{ ok: boolean; cc: any[]; wx: any[]; ccCount: number; wxCount: number }>('/api/cc/ledger');
export const mergeLedger = (transactions: any[], source: string) => postJson('/api/cc/ledger/merge', { transactions, source });
export const saveLedgerApi = (cc: any[], wx: any[]) => postJson('/api/cc/ledger/save', { cc, wx });
export const clearLedger = (source: string) => fetchJson(`/api/cc/ledger/${source}`, { method: 'DELETE' });
export const deleteLedgerTxn = (txnId: string) => fetchJson(`/api/cc/ledger/transaction/${txnId}`, { method: 'DELETE' });
export const crossReference = (wechatTransactions: any[], ccTransactions: any[], exchangeRate?: number) =>
  postJson('/api/cc/cross-reference', { wechatTransactions, ccTransactions, exchangeRate });

// CC Parse
export async function parseCCFile(file: File, source: string): Promise<any> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('source', source);
  return fetchJson('/api/cc/parse', { method: 'POST', body: fd });
}
