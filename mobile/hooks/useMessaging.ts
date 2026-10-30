import { useMutation, useQueryClient } from '@tanstack/react-query';
import { messagingApi } from '../services/api';
import { listOf } from '../services/academicYear';
import { sortThreads, totalUnread, type Recipient, type Thread, type ThreadDetail } from '../services/messaging';
import { useScopedQuery } from './useScopedQuery';

// Message text is private: none of these roots is on the persisted list (services/queryRules.ts).
export function useThreads() {
  return useScopedQuery('messageThreads', [], async () =>
    sortThreads(listOf<Thread>((await messagingApi.getThreads()).data)), { staleTime: 15_000 });
}

export function useUnreadMessages() {
  const q = useScopedQuery('messageUnread', [], async () =>
    Number((await messagingApi.getUnreadCount()).data?.unread_count ?? 0), { staleTime: 30_000, refetchInterval: 60_000 });
  return q.data ?? 0;
}

// Opening a thread marks it read on the server, so the list and badge are refreshed after.
export function useThread(id: string) {
  const qc = useQueryClient();
  return useScopedQuery('messageThread', [id], async () => {
    const data = (await messagingApi.getThread(id)).data as ThreadDetail;
    qc.invalidateQueries({ queryKey: ['messageThreads'] });
    qc.invalidateQueries({ queryKey: ['messageUnread'] });
    return data;
  }, { staleTime: 0 });
}

export function useRecipients() {
  return useScopedQuery('messageRecipients', [], async () =>
    listOf<Recipient>((await messagingApi.getRecipients()).data), { staleTime: 5 * 60_000 });
}

export function useMessageActions() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['messageThreads'] });
    qc.invalidateQueries({ queryKey: ['messageThread'] });
    qc.invalidateQueries({ queryKey: ['messageUnread'] });
  };
  const reply = useMutation({
    mutationFn: ({ id, message }: { id: string; message: string }) => messagingApi.reply(id, message),
    onSuccess: refresh,
  });
  const create = useMutation({
    mutationFn: (d: { recipient_user_id: number; message: string; subject?: string; student_id?: number }) => messagingApi.createThread(d),
    onSuccess: refresh,
  });
  return { reply, create };
}

export { totalUnread };
