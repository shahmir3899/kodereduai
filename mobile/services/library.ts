// Library for admin and principal: books, categories, issuing and returning, overdue books, settings.
// Port of frontend/src/pages/library and the rules in backend/library (serializers.py, views.py). Pure
// logic; the server re-checks everything and stays the authority.

export const OPEN_STATUS = 'ISSUED,OVERDUE';

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const rupees = (n: number | string | null | undefined) => `Rs. ${num(n).toLocaleString()}`;

// ── Rows the server sends ─────────────────────────────────────────────────────────────────────

export interface BookRow {
  id: number; title: string; author: string; isbn?: string | null; publisher?: string | null;
  category?: number | null; category_name?: string | null;
  total_copies: number; available_copies: number; issued_count?: number; shelf_location?: string | null; is_active: boolean;
}
export interface CategoryRow { id: number; name: string; description?: string | null }
export interface IssueRow {
  id: number; book: number; book_title: string; borrower_type: 'STUDENT' | 'STAFF'; borrower_name: string;
  issue_date: string; due_date: string; return_date?: string | null; status: string; fine_amount?: string | number | null;
  days_overdue?: number; estimated_fine?: string | number | null; notes?: string | null;
}
export interface LibraryStats {
  total_titles?: number; total_copies?: number; total_issued?: number; total_overdue?: number; total_categories?: number;
  total_fine_collected?: number | string; most_issued_books?: Array<{ id: number; title: string; author: string; issue_count: number }>;
}
export interface LibraryConfig { id?: number; max_books_student: number; max_books_staff: number; loan_period_days: number; fine_per_day: number | string }

// ── Books ─────────────────────────────────────────────────────────────────────────────────────

export interface BookForm {
  title: string; author: string; isbn: string; publisher: string; category: number | null; totalCopies: string; shelf: string; active: boolean;
}

export const emptyBookForm = (): BookForm => ({ title: '', author: '', isbn: '', publisher: '', category: null, totalCopies: '1', shelf: '', active: true });

export const bookToForm = (b: BookRow): BookForm => ({
  title: b.title, author: b.author, isbn: b.isbn ?? '', publisher: b.publisher ?? '', category: b.category ?? null,
  totalCopies: String(b.total_copies), shelf: b.shelf_location ?? '', active: b.is_active,
});

// Copies out right now (total less on the shelf).
export const copiesOut = (b: Pick<BookRow, 'total_copies' | 'available_copies'>) => Math.max(0, b.total_copies - b.available_copies);

export function validateBook(f: BookForm, editing: BookRow | null): string | null {
  if (!f.title.trim()) return 'Enter the title.';
  if (!f.author.trim()) return 'Enter the author.';
  if (!/^\d+$/.test(f.totalCopies.trim()) || Number(f.totalCopies) < 1) return 'Total copies must be a whole number, 1 or more.';
  if (editing && Number(f.totalCopies) < copiesOut(editing)) return `${copiesOut(editing)} cop${copiesOut(editing) === 1 ? 'y is' : 'ies are'} out, so the total cannot be lower than that.`;
  return null;
}

export const buildBookPayload = (f: BookForm) => ({
  title: f.title.trim(), author: f.author.trim(), isbn: f.isbn.trim(), publisher: f.publisher.trim(),
  category: f.category, total_copies: Number(f.totalCopies), shelf_location: f.shelf.trim(), is_active: f.active,
});

export const bookLine = (b: BookRow) => [b.author, b.category_name, b.shelf_location ? `Shelf ${b.shelf_location}` : ''].filter(Boolean).join('  ·  ');
export const copiesLine = (b: BookRow) => `${b.available_copies} of ${b.total_copies} available`;

export const deleteBookText = (b: Pick<BookRow, 'title'>) =>
  `Delete "${b.title}" from the catalog? A book with issue history cannot be deleted: mark it inactive instead.`;

// ── Categories ────────────────────────────────────────────────────────────────────────────────

export const validateCategory = (name: string): string | null => (name.trim() ? null : 'Enter the category name.');
export const deleteCategoryText = (c: Pick<CategoryRow, 'name'>) => `Delete the category "${c.name}"? Its books stay in the catalog without a category.`;

// ── Issue and return ──────────────────────────────────────────────────────────────────────────

export type BorrowerType = 'STUDENT' | 'STAFF';
export const BORROWER_TYPES: Array<{ value: BorrowerType; label: string }> = [{ value: 'STUDENT', label: 'Student' }, { value: 'STAFF', label: 'Staff' }];

export interface IssueForm { borrowerType: BorrowerType; borrower: number | null; borrowerLabel: string; book: number | null; bookLabel: string; dueDate: string; notes: string }

// Local date, not toISOString(): that is UTC and shifts the day late in the evening.
export function dueDateIn(days: number, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + (Number(days) || 14));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const emptyIssueForm = (loanDays: number, type: BorrowerType = 'STUDENT'): IssueForm => ({
  borrowerType: type, borrower: null, borrowerLabel: '', book: null, bookLabel: '', dueDate: dueDateIn(loanDays), notes: '',
});

export function validateIssue(f: IssueForm, today: string): string | null {
  if (!f.borrower) return `Choose a ${f.borrowerType === 'STAFF' ? 'staff member' : 'student'}.`;
  if (!f.book) return 'Choose a book.';
  if (!ISO_DAY.test(f.dueDate)) return 'Choose the due date.';
  if (f.dueDate < today) return 'The due date cannot be in the past.';
  return null;
}

export const buildIssuePayload = (f: IssueForm) => ({
  book: f.book, borrower_type: f.borrowerType, due_date: f.dueDate, notes: f.notes.trim(),
  ...(f.borrowerType === 'STAFF' ? { staff: f.borrower } : { student: f.borrower }),
});

export const issuedText = (r: { book_title?: string; borrower_name?: string } | undefined) =>
  `Issued "${r?.book_title ?? 'the book'}" to ${r?.borrower_name ?? 'the borrower'}.`;

export function returnedText(r: { fine_amount?: string | number | null } | undefined): string {
  const fine = num(r?.fine_amount);
  return fine > 0 ? `Book returned. Fine: ${rupees(fine)}.` : 'Book returned.';
}

export const returnConfirmText = (i: Pick<IssueRow, 'book_title' | 'borrower_name' | 'estimated_fine'>) =>
  `"${i.book_title}" from ${i.borrower_name}.${num(i.estimated_fine) > 0 ? ` A fine of ${rupees(i.estimated_fine)} will be charged.` : ''}`;

export const issueLine = (i: IssueRow) => `${i.borrower_name}  ·  due ${i.due_date}${(i.days_overdue ?? 0) > 0 ? `  ·  ${i.days_overdue} day${i.days_overdue === 1 ? '' : 's'} late` : ''}`;
export const isLate = (i: Pick<IssueRow, 'status' | 'days_overdue'>) => i.status === 'OVERDUE' || (i.days_overdue ?? 0) > 0;

// ── Settings ──────────────────────────────────────────────────────────────────────────────────

export interface ConfigForm { loanDays: string; maxStudent: string; maxStaff: string; finePerDay: string }

export const configToForm = (c: LibraryConfig): ConfigForm => ({
  loanDays: String(c.loan_period_days), maxStudent: String(c.max_books_student), maxStaff: String(c.max_books_staff), finePerDay: String(num(c.fine_per_day)),
});

export function validateConfig(f: ConfigForm): string | null {
  const whole = (v: string) => /^\d+$/.test(v.trim()) && Number(v) >= 1;
  if (!whole(f.loanDays)) return 'The loan period is a whole number of days, 1 or more.';
  if (!whole(f.maxStudent)) return 'Books per student must be a whole number, 1 or more.';
  if (!whole(f.maxStaff)) return 'Books per staff member must be a whole number, 1 or more.';
  if (!/^\d+(\.\d{1,2})?$/.test(f.finePerDay.trim())) return 'The fine per day is an amount such as 5 or 2.50 (0 for no fine).';
  return null;
}

export const buildConfigPayload = (f: ConfigForm) => ({
  loan_period_days: Number(f.loanDays), max_books_student: Number(f.maxStudent), max_books_staff: Number(f.maxStaff), fine_per_day: Number(f.finePerDay),
});

// ── Dashboard ─────────────────────────────────────────────────────────────────────────────────

export function statTiles(s: LibraryStats | undefined): Array<{ label: string; value: string; tone: 'info' | 'warning' | 'success' }> {
  return [
    { label: 'Titles', value: String(s?.total_titles ?? 0), tone: 'info' },
    { label: 'Copies', value: String(s?.total_copies ?? 0), tone: 'info' },
    { label: 'Issued now', value: String(s?.total_issued ?? 0), tone: 'success' },
    { label: 'Overdue', value: String(s?.total_overdue ?? 0), tone: (s?.total_overdue ?? 0) > 0 ? 'warning' : 'success' },
  ];
}
