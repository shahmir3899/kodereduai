import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import SegmentedTabs from '../ui/SegmentedTabs';
import MyLeaveScreen from './MyLeaveScreen';
import MyAttendanceScreen from './MyAttendanceScreen';
import { Colors, Spacing } from '../../constants/colors';

type Tab = 'leave' | 'attendance';

// Port of frontend/src/pages/hr/SelfServicePage.jsx: one hub with a Leave and an Attendance tab.
export default function SelfServiceScreen() {
  const [tab, setTab] = useState<Tab>('leave');
  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <SegmentedTabs tabs={[{ value: 'leave', label: 'Leave' }, { value: 'attendance', label: 'Attendance' }]} value={tab} onChange={setTab} />
      </View>
      <View style={styles.body}>{tab === 'leave' ? <MyLeaveScreen /> : <MyAttendanceScreen />}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  tabs: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  body: { flex: 1 },
});
