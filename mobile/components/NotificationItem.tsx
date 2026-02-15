import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/colors';

interface NotificationItemProps {
  id: number;
  title: string;
  message: string;
  created_at: string;
  is_read: boolean;
  notification_type?: string;
  onPress?: (id: number) => void;
}

export default function NotificationItem({
  id,
  title,
  message,
  created_at,
  is_read,
  notification_type,
  onPress,
}: NotificationItemProps) {
  const timeAgo = getTimeAgo(created_at);

  return (
    <TouchableOpacity
      style={[styles.container, !is_read && styles.unread]}
      onPress={() => onPress?.(id)}
      activeOpacity={0.7}
    >
      <View style={styles.iconContainer}>
        <Text style={styles.icon}>{getIcon(notification_type)}</Text>
      </View>
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, !is_read && styles.titleUnread]} numberOfLines={1}>
            {title}
          </Text>
          {!is_read && <View style={styles.dot} />}
        </View>
        <Text style={styles.message} numberOfLines={2}>
          {message}
        </Text>
        <Text style={styles.time}>{timeAgo}</Text>
      </View>
    </TouchableOpacity>
  );
}

function getIcon(type?: string): string {
  switch (type?.toLowerCase()) {
    case 'attendance': return '📊';
    case 'fee': case 'payment': return '💰';
    case 'exam': case 'result': return '📝';
    case 'leave': return '📋';
    case 'message': return '💬';
    case 'assignment': return '📚';
    default: return '🔔';
  }
}

function getTimeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString();
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm,
  },
  unread: {
    backgroundColor: Colors.infoLight,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  icon: {
    fontSize: 18,
  },
  content: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  title: {
    fontSize: FontSize.sm,
    fontWeight: '500',
    color: Colors.text,
    flex: 1,
  },
  titleUnread: {
    fontWeight: '700',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  message: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },
  time: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 4,
  },
});
