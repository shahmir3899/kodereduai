import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { BroadcastResult, NotificationTemplate, RecipientPreview } from '../services/notificationSend';
import { useScopedQuery } from './useScopedQuery';

// Active templates, as the web's picker lists them.
export function useActiveTemplates() {
  return useScopedQuery('notificationTemplates', ['active'], async () =>
    listOf<NotificationTemplate>((await notificationsApi.getTemplates({ page_size: 100, active: 1 })).data));
}

export function useSendNotification() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ predicate: (q) => ['notification-logs', 'notifications'].includes(q.queryKey[0] as string) });
  return {
    preview: useMutation({ mutationFn: async (d: Record<string, unknown>) => (await notificationsApi.previewBroadcast(d)).data as RecipientPreview }),
    broadcast: useMutation({ mutationFn: async (d: Record<string, unknown>) => (await notificationsApi.broadcast(d)).data as BroadcastResult, onSuccess: done }),
    // 201 means a log row exists; 200 means the server skipped it (channel off or the person opted out).
    single: useMutation({
      mutationFn: async (d: Record<string, unknown>) => {
        const res = await notificationsApi.send(d);
        return { skipped: res.status === 200, detail: (res.data as { detail?: string })?.detail };
      },
      onSuccess: done,
    }),
  };
}
