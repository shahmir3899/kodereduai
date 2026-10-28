import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useBookTree } from '../../hooks/useManager';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { chaptersOf } from '../../services/manager';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import Card from '../ui/Card';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Chapters of a book with their topics, tap a chapter to expand. Read-only.
export default function BookTreeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useBookTree(Number(id));
  const refreshControl = useRefreshControl(query.refetch);
  const [open, setOpen] = useState<number | null>(null);

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const chapters = chaptersOf(query.data);
  if (chapters.length === 0) return <EmptyState title="No chapters yet" message="This book has no table of contents." />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      {chapters.map((c) => {
        const topics = c.topics ?? [];
        const isOpen = open === c.id;
        return (
          <Card key={c.id} style={styles.card}>
            <TouchableOpacity onPress={() => setOpen(isOpen ? null : c.id)} style={styles.head}>
              <Text style={styles.chapter} numberOfLines={2}>{c.chapter_number != null ? `${c.chapter_number}. ` : ''}{c.title}</Text>
              <Text style={styles.count}>{topics.length} topic{topics.length === 1 ? '' : 's'}  {isOpen ? '▴' : '▾'}</Text>
            </TouchableOpacity>
            {isOpen ? (
              <View style={styles.topics}>
                {topics.length === 0 ? <Text style={styles.muted}>No topics.</Text> : topics.map((t) => (
                  <Text key={t.id} style={styles.topic}>{t.topic_number != null ? `${t.topic_number}  ` : ''}{t.title}</Text>
                ))}
              </View>
            ) : null}
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  card: { padding: Spacing.md, marginBottom: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  chapter: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  count: { fontSize: FontSize.xs, color: Colors.textSecondary },
  topics: { marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  topic: { fontSize: FontSize.sm, color: Colors.text, paddingVertical: 3 },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
});
