import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import SegmentedTabs from '../../../components/ui/SegmentedTabs';
import RecordEntryForm from '../../../components/finance/RecordEntryForm';
import { ExpenseHistory } from '../../../components/finance/FinanceListScreen';
import { Colors, Spacing } from '../../../constants/colors';

// Record a new expense, or look back at what was recorded and remove an entry (same as Income).
export default function RecordExpense() {
  const [tab, setTab] = useState<'record' | 'history'>('record');
  return (
    <View style={styles.flex}>
      <View style={styles.tabBar}>
        <SegmentedTabs tabs={[{ value: 'record', label: 'Record' }, { value: 'history', label: 'History' }]} value={tab} onChange={setTab} />
      </View>
      {tab === 'record' ? <RecordEntryForm kind="expense" /> : <ExpenseHistory />}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabBar: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, backgroundColor: Colors.background },
});
