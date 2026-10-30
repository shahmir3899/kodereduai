import { useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, usersApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type {
  Assignment, Category, Dashboard, Item, Movement, ReorderResult, Vendor,
} from '../services/inventory';
import { useScopedPagedQuery, useScopedQuery } from './useScopedQuery';

// None of these roots is in the persisted list (services/queryRules.ts): stock levels and values
// are read live, and writes need a connection.

type Page<T> = { results: T[]; next: string | null; count: number };

function pageOf<T>(data: unknown): Page<T> {
  const d = data as { results?: T[]; next?: string | null; count?: number } | T[];
  if (Array.isArray(d)) return { results: d, next: null, count: d.length };
  return { results: d.results ?? [], next: d.next ?? null, count: d.count ?? 0 };
}

export function useInventoryDashboard() {
  return useScopedQuery('inventoryDashboard', [], async () => (await inventoryApi.getDashboard()).data as Dashboard, { staleTime: 0 });
}

export function useItemsPaged(search: string, category: number | null, stock: '' | 'out' | 'low' | 'ok') {
  return useScopedPagedQuery<Item>('inventoryItems', ['paged', search, category, stock], async (page) =>
    pageOf<Item>((await inventoryApi.getItems({
      page, page_size: 20,
      ...(search ? { search } : {}),
      ...(category ? { category } : {}),
      ...(stock ? { stock_status: stock } : {}),
    })).data));
}

// Every active item, for the pickers on the movement and assignment forms.
export function useAllItems(enabled = true) {
  return useScopedQuery('inventoryItems', ['all'], async () =>
    listOf<Item>((await inventoryApi.getItems({ page_size: 1000, is_active: true })).data), { enabled, staleTime: 0 });
}

export function useCategories() {
  return useScopedQuery('inventoryCategories', [], async () =>
    listOf<Category>((await inventoryApi.getCategories({ page_size: 1000 })).data).filter((c) => c.is_active !== false), { staleTime: 60_000 });
}

export function useVendors() {
  return useScopedQuery('inventoryVendors', [], async () =>
    listOf<Vendor>((await inventoryApi.getVendors({ page_size: 1000 })).data).filter((v) => v.is_active !== false), { staleTime: 60_000 });
}

export function useMovementsPaged(type: string, itemId: number | null) {
  return useScopedPagedQuery<Movement>('inventoryMovements', ['paged', type, itemId], async (page) =>
    pageOf<Movement>((await inventoryApi.getTransactions({
      page, page_size: 20,
      ...(type ? { transaction_type: type } : {}),
      ...(itemId ? { item_id: itemId } : {}),
    })).data));
}

export function useAssignmentsPaged(status: '' | 'true' | 'false', search: string) {
  return useScopedPagedQuery<Assignment>('inventoryAssignments', ['paged', status, search], async (page) =>
    pageOf<Assignment>((await inventoryApi.getAssignments({
      page, page_size: 20,
      ...(status ? { is_active: status } : {}),
      ...(search ? { search } : {}),
    })).data));
}

export interface AssignableUser { id: number; username: string; first_name?: string; last_name?: string; role?: string; is_active: boolean }

// The user list sits on an admin-only endpoint; only admins open the assign form.
export function useAssignableUsers(enabled: boolean) {
  return useScopedQuery('inventoryUsers', [], async () =>
    listOf<AssignableUser>((await usersApi.getUsers({ page_size: 1000 })).data), { enabled, staleTime: 60_000 });
}

// Last computed result, kept for five minutes; the screen's refresh button forces a new one.
export function useReorderPrediction() {
  return useScopedQuery('inventoryReorder', [], async () => (await inventoryApi.getReorderPrediction()).data as ReorderResult, { staleTime: 5 * 60_000 });
}

export function useInventoryActions() {
  const qc = useQueryClient();
  // Any write can change stock levels, movements, assignments and the dashboard, so refresh them all.
  const refresh = () => {
    ['inventoryItems', 'inventoryMovements', 'inventoryAssignments', 'inventoryDashboard', 'inventoryReorder']
      .forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));
  };
  const refreshLists = () => ['inventoryCategories', 'inventoryVendors']
    .forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));

  return {
    createItem: useMutation({ mutationFn: (d: object) => inventoryApi.createItem(d), onSuccess: refresh }),
    updateItem: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => inventoryApi.updateItem(id, data), onSuccess: refresh }),
    createCategory: useMutation({ mutationFn: (d: object) => inventoryApi.createCategory(d), onSuccess: refreshLists }),
    createVendor: useMutation({ mutationFn: (d: object) => inventoryApi.createVendor(d), onSuccess: refreshLists }),
    createMovement: useMutation({ mutationFn: (d: object) => inventoryApi.createTransaction(d), onSuccess: refresh }),
    createAssignment: useMutation({ mutationFn: (d: object) => inventoryApi.createAssignment(d), onSuccess: refresh }),
    returnItem: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => inventoryApi.returnItem(id, data), onSuccess: refresh }),
  };
}
