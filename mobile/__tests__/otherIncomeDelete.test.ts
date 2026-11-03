import { canDeleteIncome, incomeDescription } from '../services/accountant';

describe('who may delete an income entry', () => {
  it('lets an admin delete any entry', () => {
    expect(canDeleteIncome({ recorded_by: 5 }, 9, true)).toBe(true);
    expect(canDeleteIncome({ recorded_by: null }, 9, true)).toBe(true);
    expect(canDeleteIncome({}, undefined, true)).toBe(true);
  });

  it('lets anyone else delete only what they recorded', () => {
    expect(canDeleteIncome({ recorded_by: 9 }, 9, false)).toBe(true);
    expect(canDeleteIncome({ recorded_by: 5 }, 9, false)).toBe(false);
  });

  it('never matches when the recorder or the user is unknown', () => {
    expect(canDeleteIncome({ recorded_by: null }, 9, false)).toBe(false);
    expect(canDeleteIncome({}, 9, false)).toBe(false);
    expect(canDeleteIncome({ recorded_by: 9 }, null, false)).toBe(false);
    expect(canDeleteIncome({ recorded_by: 9 }, undefined, false)).toBe(false);
  });
});

describe('incomeDescription', () => {
  it('names the entry, amount and date for the confirmation', () => {
    expect(incomeDescription({ category_name: 'Donation', description: 'Ramadan', amount: '5000', date: '2026-11-02' })).toBe('Donation, PKR 5,000 on 2026-11-02');
  });

  it('falls back to the description, then to "Income"', () => {
    expect(incomeDescription({ category_name: null, description: 'Book sale', amount: 1200, date: '2026-11-02' })).toBe('Book sale, PKR 1,200 on 2026-11-02');
    expect(incomeDescription({ amount: 0, date: '2026-11-02' })).toBe('Income, PKR 0 on 2026-11-02');
  });
});
