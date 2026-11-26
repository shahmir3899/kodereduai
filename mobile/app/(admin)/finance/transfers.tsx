import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import SegmentedTabs from '../../../components/ui/SegmentedTabs';
import TransfersScreen, { RecordTransferForm } from '../../../components/finance/TransfersScreen';
import { Colors, Spacing } from '../../../constants/colors';

// Record a new transfer, or look back at past ones and edit or delete them (same as Income and Expense).
// `?tab=history` opens on History (the dashboard's "View all" recent transfers).
export default function Screen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<'record' | 'history'>(params.tab === 'history' ? 'history' : 'record');
  return (
    <View style={styles.flex}>
      <View style={styles.tabBar}>
        <SegmentedTabs tabs={[{ value: 'record', label: 'Record' }, { value: 'history', label: 'History' }]} value={tab} onChange={setTab} />
      </View>
      {tab === 'record' ? <RecordTransferForm /> : <TransfersScreen showAdd={false} />}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabBar: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, backgroundColor: Colors.background },
});
