/**
 * Tests for CC manual assign logic (manualAssignCC).
 *
 * NOTE: Production function in src/cc-ledger.ts is coupled to DOM state.
 * This tests the pure calculation logic extracted from that function.
 */
import { describe, it, expect } from 'vitest';

interface CCTxn {
  id: string;
  amount: number;
  matched: boolean;
  matchedInvoiceId: string | null;
}

interface Invoice {
  id: string;
  amount: string;
  ccMatched: boolean;
  originalAmount: string;
  originalCurrency: string;
  description: string;
  ccActualRate?: number;
}

/** Pure-function extraction of manualAssignCC logic from src/cc-ledger.ts */
function doManualAssign(ccTxn: CCTxn, inv: Invoice): void {
  ccTxn.matched = true;
  ccTxn.matchedInvoiceId = inv.id;
  inv.ccMatched = true;

  const ccAmt = ccTxn.amount;
  const origAmt = parseFloat(String(inv.originalAmount || '').replace(/[^0-9.]/g, '')) || 0;
  const isForeign = inv.originalCurrency && inv.originalCurrency !== 'MYR' && origAmt > 0;

  if (isForeign) {
    const actualRate = ccAmt / origAmt;
    inv.ccActualRate = parseFloat(actualRate.toFixed(6));
    inv.amount = ccAmt.toFixed(2);
    const base = inv.description.replace(/\s*\([A-Z]{3}\s+[\d.]+(?:\s*@\s*[\d.]+)?\)$/, '');
    inv.description = `${base} (${inv.originalCurrency} ${origAmt.toFixed(2)} @ ${inv.ccActualRate})`;
  } else {
    inv.amount = ccAmt.toFixed(2);
  }
}

describe('doManualAssign', () => {
  it('sets matched flags', () => {
    const cc: CCTxn = { id: 'wx_0', amount: 67.44, matched: false, matchedInvoiceId: null };
    const inv: Invoice = { id: 'inv_1', amount: '', ccMatched: false, originalAmount: '', originalCurrency: 'MYR', description: 'test' };
    doManualAssign(cc, inv);
    expect(cc.matched).toBe(true);
    expect(cc.matchedInvoiceId).toBe('inv_1');
    expect(inv.ccMatched).toBe(true);
  });

  it('MYR CC overwrites invoice amount', () => {
    const cc: CCTxn = { id: 'cc_0', amount: 120.50, matched: false, matchedInvoiceId: null };
    const inv: Invoice = { id: 'inv_2', amount: '119.00', ccMatched: false, originalAmount: '', originalCurrency: 'MYR', description: 'Some vendor' };
    doManualAssign(cc, inv);
    expect(inv.amount).toBe('120.50');
  });

  it('CNY with no originalAmount — no foreign calc', () => {
    const cc: CCTxn = { id: 'wx_1', amount: 67.44, matched: false, matchedInvoiceId: null };
    const inv: Invoice = { id: 'inv_3', amount: '', ccMatched: false, originalAmount: '', originalCurrency: 'CNY', description: 'WeChat vendor' };
    doManualAssign(cc, inv);
    expect(inv.amount).toBe('67.44');
    expect(inv.ccActualRate).toBeUndefined();
  });

  it('foreign currency with originalAmount — rate calculation', () => {
    const cc: CCTxn = { id: 'cc_1', amount: 445.00, matched: false, matchedInvoiceId: null };
    const inv: Invoice = { id: 'inv_4', amount: '', ccMatched: false, originalAmount: '100.00', originalCurrency: 'USD', description: 'US vendor' };
    doManualAssign(cc, inv);
    expect(inv.amount).toBe('445.00');
    expect(inv.ccActualRate).toBe(4.45);
    expect(inv.description).toBe('US vendor (USD 100.00 @ 4.45)');
  });

  it('existing rate annotation gets replaced', () => {
    const cc: CCTxn = { id: 'cc_2', amount: 450.00, matched: false, matchedInvoiceId: null };
    const inv: Invoice = { id: 'inv_5', amount: '440.00', ccMatched: false, originalAmount: '100.00', originalCurrency: 'USD', description: 'US vendor (USD 100.00 @ 4.40)' };
    doManualAssign(cc, inv);
    expect(inv.amount).toBe('450.00');
    expect(inv.ccActualRate).toBe(4.5);
    expect(inv.description).toBe('US vendor (USD 100.00 @ 4.5)');
  });

  it('CNY with originalAmount — rate computed', () => {
    const cc: CCTxn = { id: 'wx_2', amount: 43.88, matched: false, matchedInvoiceId: null };
    const inv: Invoice = { id: 'inv_6', amount: '', ccMatched: false, originalAmount: '200.00', originalCurrency: 'CNY', description: 'CN vendor' };
    doManualAssign(cc, inv);
    expect(inv.amount).toBe('43.88');
    expect(inv.ccActualRate).toBe(parseFloat((43.88 / 200).toFixed(6)));
    expect(inv.description).toContain('CNY 200.00 @');
  });
});
