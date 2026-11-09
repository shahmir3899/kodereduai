import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import SegmentedTabs from '../../../components/ui/SegmentedTabs';
import RecordEntryForm from '../../../components/finance/RecordEntryForm';
import { OtherIncomeHistory } from '../../../components/finance/FinanceListScreen';
import { Colors, Spacing } from '../../../constants/colors';

// Record new income, or look back at what was recorded and remove an entry (an admin any; others their own).
export default function IncomeScreen() {
  const [tab, setTab] = useState<'record' | 'history'>('record');
  return (
    <View style={styles.flex}>
      <View style={styles.tabBar}>
        <SegmentedTabs tabs={[{ value: 'record', label: 'Record' }, { value: 'history', label: 'History' }]} value={tab} onChange={setTab} />
      </View>
      {tab === 'record' ? <RecordEntryForm kind="income" /> : <OtherIncomeHistory />}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabBar: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, backgroundColor: Colors.background },
});
