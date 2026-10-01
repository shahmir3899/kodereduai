import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { notificationsApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { getNotificationPath } from './notificationMeta'

/**
 * Click behaviour shared by carousel, inbox and bell: mark read, then go to the
 * related page when the role has one. Marking read never blocks navigation.
 */
export function useNotificationActions() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { user } = useAuth()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notificationCarousel'] })
    queryClient.invalidateQueries({ queryKey: ['notificationDigest'] })
    queryClient.invalidateQueries({ queryKey: ['myNotifications'] })
    queryClient.invalidateQueries({ queryKey: ['notificationUnreadCount'] })
  }

  const markRead = useMutation({
    mutationFn: (id) => notificationsApi.markRead(id),
    onSuccess: invalidate,
  })

  // Marks what the user has seen without refetching the carousel, which would
  // re-sort unread-first and make slides jump while the slideshow is running.
  const markSeen = useMutation({
    mutationFn: (ids) => notificationsApi.markReadBulk(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationUnreadCount'] })
      queryClient.invalidateQueries({ queryKey: ['myNotifications'] })
    },
  })

  const open = (n, { navigateTo = true } = {}) => {
    if (!n.is_read) markRead.mutate(n.id)
    if (!navigateTo) return
    const path = getNotificationPath(n, user?.role)
    if (path) navigate(path)
  }

  return { open, markRead, markSeen, invalidate }
}
