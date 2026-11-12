import { useMutation, useQueryClient } from '@tanstack/react-query';
import { libraryApi } from '../services/api';
import { listOf } from '../services/academicYear';
import { OPEN_STATUS, type BookRow, type CategoryRow, type IssueRow, type LibraryConfig, type LibraryStats } from '../services/library';
import { useScopedPagedQuery, useScopedQuery } from './useScopedQuery';

type Page<T> = { results: T[]; next: string | null; count: number };
const asPage = <T,>(data: unknown): Page<T> => {
  if (Array.isArray(data)) return { results: data as T[], next: null, count: data.length };
  const d = data as { results?: T[]; next?: string | null; count?: number };
  return { results: d.results ?? [], next: d.next ?? null, count: d.count ?? 0 };
};

export function useLibraryStats() {
  return useScopedQuery<LibraryStats>('libraryStats', [], async () => (await libraryApi.getStats()).data as LibraryStats, { staleTime: 0 });
}

export function useBooksPaged(term: string, category: number | null, activeOnly: boolean) {
  return useScopedPagedQuery<BookRow>('libraryBooks', ['paged', term, category, activeOnly], async (page) => asPage<BookRow>((await libraryApi.getBooks({
    page, page_size: 20, ...(term ? { search: term } : {}), ...(category != null ? { category } : {}), ...(activeOnly ? { is_active: 'true' } : {}),
  })).data));
}

// Books to pick from when issuing: matching, active, and with a copy on the shelf.
export function useBookSearch(term: string) {
  return useScopedQuery<BookRow[]>('libraryBooks', ['pick', term], async () =>
    listOf<BookRow>((await libraryApi.getBooks({ search: term, is_active: 'true', page_size: 20 })).data).filter((b) => b.available_copies > 0),
  { enabled: term.length >= 2, staleTime: 0 });
}

export function useCategories() {
  return useScopedQuery<CategoryRow[]>('libraryCategories', [], async () => listOf<CategoryRow>((await libraryApi.getCategories({ page_size: 500 })).data));
}

export function useConfig() {
  return useScopedQuery<LibraryConfig>('libraryConfig', [], async () => (await libraryApi.getConfig()).data as LibraryConfig, { staleTime: 0 });
}

export function useOpenIssues(term: string) {
  return useScopedPagedQuery<IssueRow>('libraryIssues', ['open', term], async (page) => asPage<IssueRow>((await libraryApi.getIssues({
    page, page_size: 20, status: OPEN_STATUS, ...(term ? { search: term } : {}),
  })).data));
}

export function useOverdue() {
  return useScopedQuery<IssueRow[]>('libraryOverdue', [], async () => listOf<IssueRow>((await libraryApi.getOverdue({ page_size: 500 })).data), { staleTime: 0 });
}

export interface Borrower { id: number; label: string; sub?: string }

export function useBorrowerSearch(type: 'STUDENT' | 'STAFF', term: string) {
  return useScopedQuery<Borrower[]>('libraryBorrowers', [type, term], async () => {
    if (type === 'STAFF') {
      return listOf<{ id: number; full_name?: string; first_name?: string; last_name?: string; employee_id?: string }>((await libraryApi.searchStaff({ search: term, page_size: 20 })).data)
        .map((s) => ({ id: s.id, label: s.full_name || `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim(), sub: s.employee_id }));
    }
    return listOf<{ id: number; name: string; class_name?: string; roll_number?: string | number }>((await libraryApi.searchStudents({ search: term, page_size: 20 })).data)
      .map((s) => ({ id: s.id, label: s.name, sub: [s.class_name, s.roll_number ? `Roll ${s.roll_number}` : ''].filter(Boolean).join('  ·  ') }));
  }, { enabled: term.length >= 2, staleTime: 0 });
}

// A change to the catalog or to what is out touches every library list and the dashboard.
const ROOTS = ['libraryStats', 'libraryBooks', 'libraryCategories', 'libraryIssues', 'libraryOverdue', 'libraryConfig'];

export function useLibraryActions() {
  const qc = useQueryClient();
  const done = () => ROOTS.forEach((r) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === r }));
  return {
    createBook: useMutation({ mutationFn: (d: object) => libraryApi.createBook(d), onSuccess: done }),
    updateBook: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => libraryApi.updateBook(id, data), onSuccess: done }),
    deleteBook: useMutation({ mutationFn: (id: number) => libraryApi.deleteBook(id), onSuccess: done }),
    createCategory: useMutation({ mutationFn: (d: object) => libraryApi.createCategory(d), onSuccess: done }),
    updateCategory: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => libraryApi.updateCategory(id, data), onSuccess: done }),
    deleteCategory: useMutation({ mutationFn: (id: number) => libraryApi.deleteCategory(id), onSuccess: done }),
    issue: useMutation({ mutationFn: (d: object) => libraryApi.createIssue(d), onSuccess: done }),
    returnBook: useMutation({ mutationFn: (id: number) => libraryApi.returnBook(id), onSuccess: done }),
    saveConfig: useMutation({ mutationFn: (d: object) => libraryApi.updateConfig(d), onSuccess: done }),
  };
}
