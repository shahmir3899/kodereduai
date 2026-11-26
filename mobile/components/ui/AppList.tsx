import React, { forwardRef } from 'react';
import { FlatList, Platform, type FlatListProps } from 'react-native';

// FlatList's own defaults draw 21 screens of rows ahead and 10 rows at first paint, which made
// long lists (students, fees, staff) slow to open on low-end Android phones. These are the shared,
// lighter settings; a screen's own prop still wins. Chat and editor lists with text boxes in the
// rows keep a plain FlatList: clipping rows off screen can drop the keyboard from a focused box.
const LIST_DEFAULTS = {
  initialNumToRender: 10,
  maxToRenderPerBatch: 10,
  windowSize: 7,
  removeClippedSubviews: Platform.OS === 'android',
} as const;

function AppListInner<T>(props: FlatListProps<T>, ref: React.ForwardedRef<FlatList<T>>) {
  return <FlatList<T> ref={ref} {...LIST_DEFAULTS} {...props} />;
}

const AppList = forwardRef(AppListInner) as <T>(
  props: FlatListProps<T> & { ref?: React.ForwardedRef<FlatList<T>> },
) => React.ReactElement;

export default AppList;
