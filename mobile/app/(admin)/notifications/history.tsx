import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Alert,
} from 'react-native';
import { notificationsApi } from '../../../services/api';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
import Spinner from '../../../components/ui/Spinner';
import EmptyState from '../../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

interface NotificationLog {
  id: number;
  title?: string;
  message: string;
  channel: string;
  status: 'SENT' | 'DELIVERED' | 'FAILED' | 'READ' | 'PENDING';
  recipient_name?: string;
  audience_type?: string;
  created_at: string;
}

const STATUS_VARIANTS: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  SENT: 'info',
  DELIVERED: 'success',
  FAILED: 'error',
  READ: 'success',
  PENDING: 'warning',
};

const CHANNEL_VARIANTS: Record<string, 'info' | 'success' | 'purple' | 'default'> = {
  PUSH: 'info',
  SMS: 'purple',
  WHATSAPP: 'success',
};

export default function NotificationHistory() {
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchLogs = async () => {
    try {
      const response = await notificationsApi.getLogs();
      setLogs(response.data.results || response.data || []);
    } catch (error) {
      console.error('Failed to fetch notification logs:', error);
      Alert.alert('Error', 'Failed to load notification history.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchLogs();
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-PK', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const renderItem = ({ item }: { item: NotificationLog }) => (
    <Card style={styles.logCard}>
      <View style={styles.logHeader}>
        <View style={styles.badgeRow}>
          <Badge
            label={item.status}
            variant={STATUS_VARIANTS[item.status] || 'default'}
          />
          <Badge
            label={item.channel}
            variant={CHANNEL_VARIANTS[item.channel] || 'default'}
          />
        </View>
        <Text style={styles.dateText}>{formatDate(item.created_at)}</Text>
      </View>

      {item.title && (
        <Text style={styles.logTitle}>{item.title}</Text>
      )}

      <Text style={styles.logMessage} numberOfLines={3}>
        {item.message}
      </Text>

      <View style={styles.logFooter}>
        {item.recipient_name && (
          <Text style={styles.recipientText}>To: {item.recipient_name}</Text>
        )}
        {item.audience_type && (
          <Text style={styles.audienceText}>
            Audience: {item.audience_type}
          </Text>
        )}
      </View>
    </Card>
  );

  if (loading) return <Spinner fullScreen message="Loading history..." />;

  return (
    <View style={styles.container}>
      <View style={styles.headerContainer}>
        <Text style={styles.title}>Notification History</Text>
        <Text style={styles.subtitle}>{logs.length} notifications</Text>
      </View>

      <FlatList
        data={logs}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <EmptyState
            title="No Notifications"
            message="No notification history found."
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerContainer: {
    padding: Spacing.lg,
    paddingBottom: 0,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  listContent: {
    padding: Spacing.lg,
  },
  logCard: {
    marginBottom: Spacing.md,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  dateText: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginLeft: Spacing.sm,
    flexShrink: 1,
  },
  logTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  logMessage: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  logFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  recipientText: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
  },
  audienceText: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
  },
});
