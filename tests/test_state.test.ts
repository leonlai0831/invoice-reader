import { describe, it, expect, beforeEach } from 'vitest';
import * as state from '../src/state';
import type { InvoiceRow } from '../src/types';

function makeRow(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: 'test_' + Math.random().toString(36).slice(2, 8),
    branch: '', supplierName: '', invoiceNo: '', invoiceDate: '',
    category: '', description: '', amount: '', originalAmount: '',
    originalCurrency: 'MYR', claimDate: '', preview: null,
    fileName: '', localFilePath: '', serverFilePath: '',
    ccMatched: false, ccActualRate: null, notes: '',
    createdAt: '', modifiedAt: '',
    ...overrides,
  };
}

describe('state management', () => {
  beforeEach(() => {
    state.setRows([]);
    state.setRates({ USD: 4.45, MYR: 1 });
    state.setClaimsFolder('');
    state.setArchivedClaims([]);
    state.setMemoryData({ suppliers: {}, customSuppliers: [], customDescriptions: {} });
  });

  it('setRows updates rows', () => {
    const rows = [makeRow({ supplierName: 'Test' })];
    state.setRows(rows);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].supplierName).toBe('Test');
  });

  it('getRow finds row by ID', () => {
    const row = makeRow({ id: 'find_me', supplierName: 'Found' });
    state.setRows([makeRow(), row, makeRow()]);
    expect(state.getRow('find_me')?.supplierName).toBe('Found');
  });

  it('getRow returns undefined for missing ID', () => {
    state.setRows([makeRow()]);
    expect(state.getRow('nonexistent')).toBeUndefined();
  });

  it('setRates updates rates', () => {
    state.setRates({ USD: 5.00, CNY: 0.70, MYR: 1 });
    expect(state.rates.USD).toBe(5.00);
    expect(state.rates.CNY).toBe(0.70);
  });

  it('setClaimsFolder updates folder', () => {
    state.setClaimsFolder('C:\\test\\claims');
    expect(state.claimsFolder).toBe('C:\\test\\claims');
  });

  it('setMemoryData updates memory', () => {
    state.setMemoryData({
      suppliers: { 'ACME': { count: 5, categories: {}, branches: {} } },
      customSuppliers: ['Custom Co'],
      customDescriptions: { 'Service': ['Consulting'] },
    });
    expect(Object.keys(state.memoryData.suppliers)).toContain('ACME');
    expect(state.memoryData.customSuppliers).toContain('Custom Co');
  });

  it('setSortCol and setSortDir update sort state', () => {
    state.setSortCol('amount');
    state.setSortDir('desc');
    expect(state.sortCol).toBe('amount');
    expect(state.sortDir).toBe('desc');
  });

  it('selectedRows is a Set', () => {
    state.selectedRows.add('row1');
    state.selectedRows.add('row2');
    expect(state.selectedRows.size).toBe(2);
    expect(state.selectedRows.has('row1')).toBe(true);
    state.selectedRows.clear();
    expect(state.selectedRows.size).toBe(0);
  });
});
