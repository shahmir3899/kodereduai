import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useChildren } from '../../hooks/useParent';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import ChildCard from './ChildCard';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { Colors, Spacing } from '../../constants/colors';

// The children linked to this parent in the active school.
export default function ChildrenListScreen() {
  const query = useChildren();
  const refreshControl = useRefreshControl(query.refetch);

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const children = query.data ?? [];
  if (children.length === 0) {
    return <EmptyState title="No children linked" message="Ask the school office for an invite code to link your child, or switch school from More." />;
  }
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      {children.map((c) => <ChildCard key={c.id} child={c} />)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
});
