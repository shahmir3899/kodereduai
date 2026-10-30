import { hrApi, inventoryApi, notificationsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { InventoryAssignment, Payslip } from '../services/accountant';
import { useAuth } from '../contexts/AuthContext';
import { useScopedQuery } from './useScopedQuery';

// Own payslips; the server returns only the signed-in person's.
export function useMyPayslips() {
  return useScopedQuery('payslips', ['mine'], async () =>
    listOf<Payslip>((await hrApi.getPayslips({ page_size: 60 })).data), { staleTime: 60_000 });
}

export function useMyInventory(enabled = true) {
  const { user, isModuleEnabled } = useAuth();
  return useScopedQuery('inventoryAssignments', ['mine', user?.id], async () =>
    listOf<InventoryAssignment>((await inventoryApi.getAssignments({ user: user?.id, page_size: 100 })).data),
  { enabled: enabled && !!user?.id && isModuleEnabled('inventory'), staleTime: 60_000 });
}

export function useUnreadNotifications() {
  const { isModuleEnabled } = useAuth();
  const q = useScopedQuery('notificationUnread', [], async () =>
    Number((await notificationsApi.getUnreadCount()).data?.unread_count ?? 0),
  { enabled: isModuleEnabled('notifications'), staleTime: 30_000 });
  return q.data ?? 0;
}
