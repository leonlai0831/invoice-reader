/**
 * Tests for buildBranchHistoryMap pure logic.
 *
 * NOTE: The production function in src/records.ts is coupled to DOM state.
 * This tests the algorithm in isolation. If the production logic changes,
 * this test must be updated manually to match.
 */
import { describe, it, expect } from 'vitest';

interface BranchEntry {
  branch: string;
  claimDate: string;
  invoiceDate: string;
}

interface ArchivedClaim {
  date?: string;
  rows?: Array<{ supplierName?: string; branch?: string; invoiceDate?: string }>;
}

/** Pure-function extraction of buildBranchHistoryMap logic from src/records.ts */
function buildBranchHistoryMap(archivedClaims: ArchivedClaim[]): Map<string, BranchEntry[]> {
  const map = new Map<string, BranchEntry[]>();
  for (const claim of archivedClaims) {
    const claimDate = claim.date || '';
    for (const row of claim.rows || []) {
      const supplier = (row.supplierName || '').trim().toUpperCase();
      const branch = (row.branch || '').trim();
      if (!supplier || !branch) continue;
      if (!map.has(supplier)) map.set(supplier, []);
      map.get(supplier)!.push({ branch, claimDate, invoiceDate: row.invoiceDate || '' });
    }
  }
  for (const [key, entries] of map) {
    entries.sort((a, b) => b.claimDate.localeCompare(a.claimDate));
    if (entries.length > 5) map.set(key, entries.slice(0, 5));
  }
  return map;
}

describe('buildBranchHistoryMap', () => {
  it('empty archive produces empty map', () => {
    expect(buildBranchHistoryMap([]).size).toBe(0);
  });

  it('single claim with single row', () => {
    const map = buildBranchHistoryMap([{
      date: '2026-01-15 10:00:00',
      rows: [{ supplierName: 'LCYCONSULTING', branch: 'HQ', invoiceDate: '15/01/2026' }],
    }]);
    expect(map.has('LCYCONSULTING')).toBe(true);
    expect(map.get('LCYCONSULTING')!.length).toBe(1);
    expect(map.get('LCYCONSULTING')![0].branch).toBe('HQ');
  });

  it('rotation pattern — most recent first', () => {
    const map = buildBranchHistoryMap([
      { date: '2026-01-15 10:00:00', rows: [{ supplierName: 'LCYCONSULTING', branch: 'HQ' }] },
      { date: '2026-02-15 10:00:00', rows: [{ supplierName: 'LCYCONSULTING', branch: 'BK' }] },
      { date: '2026-03-15 10:00:00', rows: [{ supplierName: 'LCYCONSULTING', branch: 'BT' }] },
    ]);
    const entries = map.get('LCYCONSULTING')!;
    expect(entries[0].branch).toBe('BT');
    expect(entries[1].branch).toBe('BK');
    expect(entries[2].branch).toBe('HQ');
  });

  it('empty branch filtered out', () => {
    const map = buildBranchHistoryMap([{
      date: '2026-01-15 10:00:00',
      rows: [{ supplierName: 'VENDOR', branch: '' }],
    }]);
    expect(map.has('VENDOR')).toBe(false);
  });

  it('caps at 5 entries', () => {
    const claims: ArchivedClaim[] = [];
    for (let i = 0; i < 10; i++) {
      claims.push({
        date: `2026-${String(i + 1).padStart(2, '0')}-01 10:00:00`,
        rows: [{ supplierName: 'BIG CO', branch: `BR${i}` }],
      });
    }
    const map = buildBranchHistoryMap(claims);
    expect(map.get('BIG CO')!.length).toBe(5);
    expect(map.get('BIG CO')![0].claimDate).toMatch(/^2026-10/);
  });

  it('normalizes case and whitespace', () => {
    const map = buildBranchHistoryMap([{
      date: '2026-01-01 00:00:00',
      rows: [{ supplierName: '  Google Asia  ', branch: 'PJ' }],
    }]);
    expect(map.has('GOOGLE ASIA')).toBe(true);
  });

  it('handles multiple suppliers in same claim', () => {
    const map = buildBranchHistoryMap([{
      date: '2026-03-01 10:00:00',
      rows: [
        { supplierName: 'VENDOR A', branch: 'HQ' },
        { supplierName: 'VENDOR B', branch: 'BK' },
      ],
    }]);
    expect(map.has('VENDOR A')).toBe(true);
    expect(map.has('VENDOR B')).toBe(true);
    expect(map.get('VENDOR A')![0].branch).toBe('HQ');
    expect(map.get('VENDOR B')![0].branch).toBe('BK');
  });
});
