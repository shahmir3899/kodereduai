import {
  bookLine, bookToForm, buildBookPayload, buildConfigPayload, buildIssuePayload, configToForm, copiesLine, copiesOut, deleteBookText, dueDateIn,
  emptyBookForm, emptyIssueForm, isLate, issueLine, returnConfirmText, returnedText, statTiles, validateBook, validateCategory, validateConfig, validateIssue,
  type BookRow,
} from '../services/library';

const book = (over: Partial<BookRow> = {}): BookRow => ({
  id: 1, title: 'Physics 9', author: 'A. Khan', total_copies: 5, available_copies: 3, is_active: true, category_name: 'Science', shelf_location: 'B2', ...over,
});

describe('books', () => {
  const ok = { ...emptyBookForm(), title: 'Physics 9', author: 'A. Khan' };
  it('needs a title, an author and a whole number of copies', () => {
    expect(validateBook({ ...ok, title: ' ' }, null)).toMatch(/title/i);
    expect(validateBook({ ...ok, author: '' }, null)).toMatch(/author/i);
    expect(validateBook({ ...ok, totalCopies: '0' }, null)).toMatch(/1 or more/);
    expect(validateBook({ ...ok, totalCopies: '2.5' }, null)).toMatch(/whole number/);
    expect(validateBook(ok, null)).toBeNull();
  });
  it('will not lower the total below the copies that are out', () => {
    const b = book(); // 2 out
    expect(copiesOut(b)).toBe(2);
    expect(validateBook({ ...bookToForm(b), totalCopies: '1' }, b)).toMatch(/2 copies are out/);
    expect(validateBook({ ...bookToForm(b), totalCopies: '2' }, b)).toBeNull();
    expect(validateBook({ ...bookToForm(book({ available_copies: 4 })), totalCopies: '0' }, book({ available_copies: 4 }))).toMatch(/1 or more/);
    expect(validateBook({ ...bookToForm(book({ available_copies: 4 })), totalCopies: '1' }, book({ available_copies: 4 }))).toBeNull();
  });
  it('sends trimmed fields and a numeric copy count', () => {
    expect(buildBookPayload({ ...ok, title: ' Physics 9 ', isbn: ' 123 ', category: 4, totalCopies: '7' })).toMatchObject({ title: 'Physics 9', isbn: '123', category: 4, total_copies: 7, is_active: true });
  });
  it('describes a book on one line', () => {
    expect(bookLine(book())).toBe('A. Khan  ·  Science  ·  Shelf B2');
    expect(copiesLine(book())).toBe('3 of 5 available');
    expect(deleteBookText(book())).toMatch(/Physics 9.*inactive/);
  });
  it('needs a category name', () => {
    expect(validateCategory('  ')).toMatch(/name/i);
    expect(validateCategory('Science')).toBeNull();
  });
});

describe('issuing', () => {
  it('counts the due date in local days', () => {
    expect(dueDateIn(14, new Date(2026, 10, 12))).toBe('2026-11-26');
    expect(dueDateIn(30, new Date(2026, 11, 20))).toBe('2027-01-19');
  });
  const form = { ...emptyIssueForm(14), borrower: 7, borrowerLabel: 'Sara', book: 3, bookLabel: 'Physics', dueDate: '2026-11-30' };
  it('needs a borrower, a book and a due date that is not past', () => {
    expect(validateIssue({ ...form, borrower: null }, '2026-11-12')).toMatch(/student/);
    expect(validateIssue({ ...form, borrower: null, borrowerType: 'STAFF' }, '2026-11-12')).toMatch(/staff member/);
    expect(validateIssue({ ...form, book: null }, '2026-11-12')).toMatch(/book/);
    expect(validateIssue({ ...form, dueDate: '2026-11-01' }, '2026-11-12')).toMatch(/past/);
    expect(validateIssue({ ...form, dueDate: 'x' }, '2026-11-12')).toMatch(/due date/);
    expect(validateIssue(form, '2026-11-12')).toBeNull();
  });
  it('sends the student or the staff id under the name the server reads', () => {
    expect(buildIssuePayload(form)).toEqual({ book: 3, borrower_type: 'STUDENT', due_date: '2026-11-30', notes: '', student: 7 });
    expect(buildIssuePayload({ ...form, borrowerType: 'STAFF', notes: ' hi ' })).toEqual({ book: 3, borrower_type: 'STAFF', due_date: '2026-11-30', notes: 'hi', staff: 7 });
  });
});

describe('returning', () => {
  it('mentions the fine only when there is one', () => {
    expect(returnedText({ fine_amount: '0.00' })).toBe('Book returned.');
    expect(returnedText({ fine_amount: '45.00' })).toBe('Book returned. Fine: Rs. 45.');
    expect(returnConfirmText({ book_title: 'Physics', borrower_name: 'Sara', estimated_fine: '10' })).toContain('fine of Rs. 10');
    expect(returnConfirmText({ book_title: 'Physics', borrower_name: 'Sara', estimated_fine: 0 })).not.toContain('fine');
  });
  it('shows how late a book is', () => {
    const i = { id: 1, book: 1, book_title: 'P', borrower_type: 'STUDENT' as const, borrower_name: 'Sara', issue_date: '', due_date: '2026-11-01', status: 'OVERDUE', days_overdue: 1 };
    expect(issueLine(i)).toBe('Sara  ·  due 2026-11-01  ·  1 day late');
    expect(isLate(i)).toBe(true);
    expect(isLate({ status: 'ISSUED', days_overdue: 0 })).toBe(false);
  });
});

describe('settings and dashboard', () => {
  const f = configToForm({ max_books_student: 2, max_books_staff: 5, loan_period_days: 14, fine_per_day: '5.00' });
  it('reads the saved settings as text', () => { expect(f).toEqual({ loanDays: '14', maxStudent: '2', maxStaff: '5', finePerDay: '5' }); });
  it('accepts whole numbers and a fine with up to two decimals', () => {
    expect(validateConfig(f)).toBeNull();
    expect(validateConfig({ ...f, finePerDay: '2.50' })).toBeNull();
    expect(validateConfig({ ...f, finePerDay: '0' })).toBeNull();
    expect(validateConfig({ ...f, loanDays: '0' })).toMatch(/loan period/i);
    expect(validateConfig({ ...f, maxStudent: 'x' })).toMatch(/student/i);
    expect(validateConfig({ ...f, maxStaff: '' })).toMatch(/staff/i);
    expect(validateConfig({ ...f, finePerDay: '-1' })).toMatch(/fine/i);
    expect(buildConfigPayload(f)).toEqual({ loan_period_days: 14, max_books_student: 2, max_books_staff: 5, fine_per_day: 5 });
  });
  it('turns the stats into four tiles and flags overdue', () => {
    const t = statTiles({ total_titles: 10, total_copies: 40, total_issued: 6, total_overdue: 2 });
    expect(t.map((x) => `${x.label}:${x.value}`)).toEqual(['Titles:10', 'Copies:40', 'Issued now:6', 'Overdue:2']);
    expect(t[3].tone).toBe('warning');
    expect(statTiles(undefined)[3]).toEqual({ label: 'Overdue', value: '0', tone: 'success' });
  });
});
