/**
 * Tests for branch multi-select filter logic.
 *
 * NOTE: Production filter logic is inline in src/records.ts (not exported).
 * This tests the algorithm in isolation.
 */
import { describe, it, expect } from 'vitest';

const BRANCHES = ['HQ', 'BK', 'BT', 'PK', 'PJ', 'KK', 'KM', 'QSM', 'USJ', 'DPC', 'OTG'];

interface Row {
  id: string;
  branch: string;
  category: string;
  supplierName: string;
}

function filterRows(rows: Row[], filterBranches: Set<string>, filterCat: string, search: string): Row[] {
  let filtered = rows.filter(r => {
    if (filterBranches.size > 0 && !filterBranches.has(r.branch)) return false;
    if (filterCat && r.category !== filterCat) return false;
    return true;
  });
  if (search) {
    const q = search.toLowerCase().trim();
    filtered = filtered.filter(r =>
      (r.supplierName || '').toLowerCase().includes(q) ||
      (r.branch || '').toLowerCase().includes(q),
    );
  }
  return filtered;
}

function getBtnText(filterBranches: Set<string>): string {
  const n = filterBranches.size;
  if (n === 0 || n === BRANCHES.length) return '所有 Branch ▾';
  if (n <= 3) return [...filterBranches].join(', ') + ' ▾';
  return `已选 ${n} 个 ▾`;
}

const testRows: Row[] = [
  { id: '1', branch: 'HQ', category: 'Telco', supplierName: 'Maxis' },
  { id: '2', branch: 'BK', category: 'Telco', supplierName: 'TM' },
  { id: '3', branch: 'BT', category: 'Marketing', supplierName: 'Google' },
  { id: '4', branch: 'HQ', category: 'Marketing', supplierName: 'Meta' },
  { id: '5', branch: 'PJ', category: 'Others', supplierName: 'Adobe' },
  { id: '6', branch: '', category: 'Telco', supplierName: 'Digi' },
];

describe('filterRows', () => {
  it('empty filter returns all rows', () => {
    expect(filterRows(testRows, new Set(), '', '').length).toBe(6);
  });

  it('single branch filter', () => {
    const result = filterRows(testRows, new Set(['HQ']), '', '');
    expect(result.length).toBe(2);
    expect(result.every(r => r.branch === 'HQ')).toBe(true);
  });

  it('multiple branches filter', () => {
    expect(filterRows(testRows, new Set(['HQ', 'BK']), '', '').length).toBe(3);
  });

  it('all branches excludes empty branch', () => {
    expect(filterRows(testRows, new Set(BRANCHES), '', '').length).toBe(5);
  });

  it('branch + category combined', () => {
    const result = filterRows(testRows, new Set(['HQ', 'BK']), 'Telco', '');
    expect(result.length).toBe(2);
    expect(result[0].supplierName).toBe('Maxis');
    expect(result[1].supplierName).toBe('TM');
  });

  it('branch + search combined', () => {
    const result = filterRows(testRows, new Set(['HQ', 'BT']), '', 'goo');
    expect(result.length).toBe(1);
    expect(result[0].supplierName).toBe('Google');
  });

  it('empty branch excluded when branch filter active', () => {
    const result = filterRows(testRows, new Set(['HQ']), '', '');
    expect(result.some(r => r.branch === '')).toBe(false);
  });
});

describe('getBtnText', () => {
  it('none selected', () => {
    expect(getBtnText(new Set())).toBe('所有 Branch ▾');
  });

  it('1-3 selected shows names', () => {
    expect(getBtnText(new Set(['HQ']))).toBe('HQ ▾');
    expect(getBtnText(new Set(['HQ', 'BK']))).toBe('HQ, BK ▾');
    expect(getBtnText(new Set(['HQ', 'BK', 'BT']))).toBe('HQ, BK, BT ▾');
  });

  it('4+ selected shows count', () => {
    expect(getBtnText(new Set(['HQ', 'BK', 'BT', 'PK']))).toBe('已选 4 个 ▾');
  });

  it('all selected shows "所有 Branch"', () => {
    expect(getBtnText(new Set(BRANCHES))).toBe('所有 Branch ▾');
  });
});
