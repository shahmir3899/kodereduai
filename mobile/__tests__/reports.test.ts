import {
  categoryShares, periodRange, rangeFor, totalBalance, trendBars, validRange,
} from '../services/accountant';
import {
  exportErrorMessage, feeReportFileName, feeReportRequest, financeSummaryFileName, financeSummaryRequest,
  ledgerFileName, looksLikePdf, looksLikeXlsx, safeName,
} from '../services/reports';

describe('period ranges', () => {
  const now = new Date(2026, 9, 28);
  it('starts the quarter on the first month of its three', () => {
    expect(periodRange('QUARTER', now)).toEqual({ from: '2026-10-01', to: '2026-10-28' });
    expect(periodRange('QUARTER', new Date(2026, 4, 3))).toEqual({ from: '2026-04-01', to: '2026-05-03' });
    expect(periodRange('QUARTER', new Date(2026, 2, 31))).toEqual({ from: '2026-01-01', to: '2026-03-31' });
  });
  it('accepts a custom range only when both dates are set and in order', () => {
    expect(validRange('2026-01-01', '2026-01-31')).toBe(true);
    expect(validRange('2026-02-01', '2026-01-31')).toBe(false);
    expect(validRange('', '2026-01-31')).toBe(false);
    expect(rangeFor('CUSTOM', { from: '', to: '' })).toBeNull();
    expect(rangeFor('CUSTOM', { from: '2026-01-01', to: '2026-01-31' })).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(rangeFor('YEAR', { from: '', to: '' }, now)).toEqual({ from: '2026-01-01', to: '2026-10-28' });
  });
});

describe('trend and categories', () => {
  it('scales both series against the largest value shown', () => {
    const bars = trendBars([
      { month: 9, year: 2026, income: 200, expenses: 50 },
      { month: 10, year: 2026, income: '100', expenses: 100 },
    ]);
    expect(bars[0]).toMatchObject({ label: 'Sep 26', incomePct: 100, expensePct: 25 });
    expect(bars[1]).toMatchObject({ incomePct: 50, expensePct: 50 });
  });
  it('handles an empty or all-zero trend', () => {
    expect(trendBars([])).toEqual([]);
    expect(trendBars([{ month: 1, year: 2026, income: 0, expenses: 0 }])[0]).toMatchObject({ incomePct: 0, expensePct: 0 });
  });
  it('rounds category shares like the web and names blanks', () => {
    const shares = categoryShares([
      { category: 1, category_display: 'Salaries', total_amount: '600', count: 3 },
      { category: null, category_display: '', total_amount: 400, count: 1 },
    ], 1000);
    expect(shares).toEqual([
      { name: 'Salaries', amount: 600, count: 3, pct: 60 },
      { name: 'Uncategorized', amount: 400, count: 1, pct: 40 },
    ]);
    expect(categoryShares([{ category: 1, category_display: 'A', total_amount: 5, count: 1 }], 0)[0].pct).toBe(0);
  });
  it('reads net_balance (what the server sends) before balance', () => {
    expect(totalBalance([{ id: 1, name: 'a', net_balance: '70' }, { id: 2, name: 'b', balance: 30 }])).toBe(100);
  });
});

describe('report requests and file names', () => {
  it('sends the same parameters the web dashboard sends', () => {
    expect(financeSummaryRequest({ from: '2026-10-01', to: '2026-10-28' }, 'This Month', 7)).toEqual({
      report_type: 'FINANCE_SUMMARY',
      parameters: { date_from: '2026-10-01', date_to: '2026-10-28', period_label: 'This Month', academic_year: 7 },
    });
    expect(financeSummaryRequest({ from: 'a', to: 'b' }, 'Custom').parameters).not.toHaveProperty('academic_year');
    expect(feeReportRequest('FEE_DEFAULTERS', 10, 2026, null)).toEqual({
      report_type: 'FEE_DEFAULTERS', parameters: { month: 10, year: 2026 },
    });
  });
  it('builds safe file names', () => {
    expect(safeName("St. Mary's / Branch #1")).toBe('St_Mary_s_Branch_1');
    expect(safeName('')).toBe('School');
    expect(financeSummaryFileName('Demo School', { from: '2026-01-01', to: '2026-10-28' }))
      .toBe('Finance_Report_Demo_School_2026-01-01_to_2026-10-28.pdf');
    expect(feeReportFileName('FEE_COLLECTION', 3, 2026)).toBe('Fee_Collection_March_2026.pdf');
    expect(ledgerFileName('Cash / Main', { from: '2026-01-01', to: '2026-02-01' }, 'xlsx')).toBe('Ledger_Cash_Main_2026-01-01_to_2026-02-01.xlsx');
    expect(ledgerFileName('Cash', null, 'pdf')).toBe('Ledger_Cash.pdf');
  });
});

describe('file checks and errors', () => {
  it('recognises a PDF and an Excel file by their first bytes', () => {
    expect(looksLikePdf(new TextEncoder().encode('%PDF-1.4 ....'))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode('{"error":"x"}'))).toBe(false);
    expect(looksLikeXlsx(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe(true);
    expect(looksLikeXlsx(new TextEncoder().encode('<html>'))).toBe(false);
  });
  it('explains export failures in plain words', () => {
    expect(exportErrorMessage({ code: 'ERR_NETWORK' })).toMatch(/No connection/);
    expect(exportErrorMessage({ response: { status: 403, data: new ArrayBuffer(0) } })).toMatch(/role/);
    const body = new TextEncoder().encode(JSON.stringify({ error: 'account_id is required' }));
    expect(exportErrorMessage({ response: { status: 400, data: body.buffer } })).toBe('account_id is required');
    expect(exportErrorMessage({ response: { status: 500, data: new ArrayBuffer(0) } })).toMatch(/Try again/);
  });
});
