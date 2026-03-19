import { describe, it, expect } from 'vitest';
import { esc, generateId, normalizeInvNo, extractBaseFileName, validateAmount, validateDate, isWechatRelated, bankLabel } from '../src/utils';

describe('esc (HTML escaping)', () => {
  it('escapes & < > and quotes', () => {
    expect(esc('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  it('handles null/undefined', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });

  it('handles numbers', () => {
    expect(esc(42)).toBe('42');
  });

  it('escapes ampersand', () => {
    expect(esc('A & B')).toBe('A &amp; B');
  });
});

describe('generateId', () => {
  it('returns a string starting with inv_', () => {
    const id = generateId();
    expect(id).toMatch(/^inv_\d+_[a-z0-9]+$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe('normalizeInvNo', () => {
  it('strips non-alphanumeric characters and lowercases', () => {
    expect(normalizeInvNo('INV-2024/001')).toBe('inv2024001');
  });

  it('handles empty string', () => {
    expect(normalizeInvNo('')).toBe('');
  });

  it('handles null/undefined', () => {
    expect(normalizeInvNo(undefined as any)).toBe('');
  });
});

describe('extractBaseFileName', () => {
  it('extracts filename from Windows path', () => {
    expect(extractBaseFileName('C:\\Users\\test\\file.pdf')).toBe('file.pdf');
  });

  it('extracts filename from Unix path', () => {
    expect(extractBaseFileName('/home/user/file.png')).toBe('file.png');
  });

  it('strips leading timestamp prefix', () => {
    expect(extractBaseFileName('1234567890_invoice.jpg')).toBe('invoice.jpg');
  });

  it('returns empty for empty input', () => {
    expect(extractBaseFileName('')).toBe('');
  });
});

describe('validateAmount', () => {
  it('validates and cleans a normal amount', () => {
    expect(validateAmount('100.50')).toEqual({ valid: true, cleaned: '100.50' });
  });

  it('removes commas', () => {
    expect(validateAmount('1,234.56')).toEqual({ valid: true, cleaned: '1234.56' });
  });

  it('rejects negative amounts', () => {
    expect(validateAmount('-5')).toEqual({ valid: false, cleaned: '-5' });
  });

  it('allows empty string', () => {
    expect(validateAmount('')).toEqual({ valid: true, cleaned: '' });
  });

  it('rejects non-numeric', () => {
    expect(validateAmount('abc')).toEqual({ valid: false, cleaned: 'abc' });
  });
});

describe('validateDate', () => {
  it('validates DD/MM/YYYY format', () => {
    expect(validateDate('15/03/2025')).toEqual({ valid: true, normalized: '15/03/2025' });
  });

  it('normalizes single-digit day/month', () => {
    expect(validateDate('1/3/2025')).toEqual({ valid: true, normalized: '01/03/2025' });
  });

  it('rejects invalid month', () => {
    expect(validateDate('01/13/2025')).toEqual({ valid: false, normalized: '01/13/2025' });
  });

  it('rejects invalid day', () => {
    expect(validateDate('31/02/2025')).toEqual({ valid: false, normalized: '31/02/2025' });
  });

  it('allows empty string', () => {
    expect(validateDate('')).toEqual({ valid: true, normalized: '' });
  });

  it('rejects wrong format', () => {
    expect(validateDate('2025-03-15')).toEqual({ valid: false, normalized: '2025-03-15' });
  });
});

describe('isWechatRelated', () => {
  it('detects wechat keyword', () => {
    expect(isWechatRelated('WeChat Pay transfer')).toBe(true);
  });

  it('detects tenpay', () => {
    expect(isWechatRelated('Tenpay payment')).toBe(true);
  });

  it('detects Chinese characters', () => {
    expect(isWechatRelated('微信支付')).toBe(true);
  });

  it('returns false for unrelated', () => {
    expect(isWechatRelated('Visa payment')).toBe(false);
  });

  it('handles empty/null', () => {
    expect(isWechatRelated('')).toBe(false);
    expect(isWechatRelated(undefined as any)).toBe(false);
  });
});

describe('bankLabel', () => {
  it('maps known banks', () => {
    expect(bankLabel('maybank')).toBe('Maybank');
    expect(bankLabel('cimb')).toBe('CIMB');
    expect(bankLabel('hsbc')).toBe('HSBC');
  });

  it('returns CC for undefined', () => {
    expect(bankLabel(undefined)).toBe('CC');
  });

  it('returns raw value for unknown bank', () => {
    expect(bankLabel('SomeBank')).toBe('SomeBank');
  });
});
