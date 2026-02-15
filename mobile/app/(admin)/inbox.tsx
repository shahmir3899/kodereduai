import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { notificationsApi } from '../../services/api';
import NotificationItem from '../../components/NotificationItem';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { Colors, FontSize, Spacing } from '../../constants/colors';

interface NotificationRecord {
  id: number; title: string; message: string; created_at: string; is_read: boolean; notification_type?: string;
}

export default function Inbox() {
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifications = async () => {
    try {
      const response = await notificationsApi.getMyNotifications();
      setNotifications(response.data.results || response.data.notifications || response.data || []);
    } catch (error) { console.error('Failed to fetch notifications:', error); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchNotifications(); }, []);
  const onRefresh = () => { setRefreshing(true); fetchNotifications(); };

  const handlePress = async (id: number) => {
    try {
      await notificationsApi.markRead(id);
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n));
    } catch (error) { console.error('Failed to mark read:', error); }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (error) { console.error('Failed to mark all read:', error); }
  };

  if (loading) return <Spinner fullScreen message="Loading..." />;

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Inbox</Text>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={handleMarkAllRead}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>
      {notifications.length === 0 ? (
        <EmptyState title="No Notifications" message="You're all caught up!" />
      ) : (
        notifications.map((n) => (
          <NotificationItem key={n.id} id={n.id} title={n.title} message={n.message}
            created_at={n.created_at} is_read={n.is_read} notification_type={n.notification_type}
            onPress={handlePress} />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  markAllText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
});
