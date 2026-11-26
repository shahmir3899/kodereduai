import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import AppList from './AppList';
import QueryBoundary from './QueryBoundary';

type BoundaryQuery<T> = React.ComponentProps<typeof QueryBoundary<T[]>>['query'];

interface QueryListProps<T> {
  query: BoundaryQuery<T>;
  renderItem: (item: T, index: number) => React.ReactElement | null;
  keyExtractor: (item: T, index: number) => string;
  // Shown above the rows and above the loading / error / empty state, like the old ScrollView top.
  header?: React.ReactElement | null;
  footer?: React.ReactElement | null;
  emptyTitle?: string;
  emptyMessage?: string;
  refreshControl?: React.ReactElement<any>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  // Screen state the rows read (a busy button, an open card): rows redraw when it changes.
  extraData?: unknown;
}

// A query's rows drawn as they scroll into view, with QueryBoundary's loading / error / empty
// branches in the empty slot. Replaces `<ScrollView>` + `<QueryBoundary>{rows => rows.map(...)}`,
// which drew every row up front and made long lists slow to open.
export default function QueryList<T>({
  query, renderItem, keyExtractor, header, footer, emptyTitle, emptyMessage, refreshControl, contentContainerStyle, style, extraData,
}: QueryListProps<T>) {
  return (
    <AppList<T>
      style={style}
      contentContainerStyle={contentContainerStyle}
      data={query.data ?? []}
      extraData={extraData}
      keyExtractor={keyExtractor}
      renderItem={({ item, index }) => renderItem(item, index)}
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={<QueryBoundary query={query} emptyTitle={emptyTitle} emptyMessage={emptyMessage}>{() => null}</QueryBoundary>}
    />
  );
}
