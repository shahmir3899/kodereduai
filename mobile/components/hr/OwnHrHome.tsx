import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useMyPayslips } from '../../hooks/useStaff';
import { useMyAttendance, useMyLeaveApplications, useMyLeaveBalance } from '../../hooks/useMyHr';
import { payslipPeriod, sortPayslips, type Payslip } from '../../services/financeManager';
import { attendanceTile, leaveRemaining, monthRange, usedPercent, type LeaveBalance } from '../../services/myHr';
import { todayString } from '../../services/attendanceEntry';
import { formatMoney } from '../../services/feeCollect';
import Card from '../ui/Card';
import StatusPill from '../ui/StatusPill';
import type { Tile } from '../dashboard/StatTiles';
import { Colors, FontSize, Spacing } from '../../constants/colors';

interface Routes { attendance?: string; leave?: string; payslips?: string }

// The "own work and pay" half of a staff-level Home (attendance this month, leave balance, last
// salary, leave balance by type, recent payslips). The staff and driver Homes share it, as the
// web's staff and driver dashboards do.
export function useOwnHr(routes: Routes) {
  const leave = useMyLeaveApplications();
  const balance = useMyLeaveBalance(leave.data ?? [], leave.isSuccess);
  const payslips = useMyPayslips();
  const today = todayString();
  const month = monthRange(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, today);
  const attendance = useMyAttendance(month.start, month.end).summary;

  const att = attendanceTile(attendance.data);
  const remaining = leaveRemaining(balance.data);
  const sorted = sortPayslips(payslips.data ?? []);
  const latest = sorted[0];

  const tiles: Tile[] = [
    { label: att.hint ? `Attendance this month · ${att.hint}` : 'Attendance this month', value: att.value, route: routes.attendance },
    { label: 'Leave balance (days left)', value: remaining != null ? String(remaining) : '–', route: routes.leave },
    { label: latest ? 'Latest payslip' : 'Payslips', value: latest ? formatMoney(Number(latest.net_salary) || 0) : '–', route: routes.payslips },
  ];
  return {
    tiles, leave, balance: balance.data ?? [], payslips: sorted.slice(0, 3),
    refetch: [leave.refetch, balance.refetch, payslips.refetch, attendance.refetch],
  };
}

export function OwnHrPanels({ balance, payslips }: { balance: LeaveBalance[]; payslips: Payslip[] }) {
  return (
    <>
      {balance.length > 0 ? (
        <>
          <Text style={styles.section}>Leave balance</Text>
          <Card style={styles.list}>
            {balance.map((b) => (
              <View key={b.policy_id} style={styles.line}>
                <Text style={styles.lineTitle} numberOfLines={1}>{b.policy_name}</Text>
                <StatusPill label={`${usedPercent(b)}% used`} tone={usedPercent(b) >= 90 ? 'error' : usedPercent(b) >= 70 ? 'warning' : 'success'} />
                <Text style={styles.lineAmount}>{b.days_remaining} of {b.days_allowed}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
      {payslips.length > 0 ? (
        <>
          <Text style={styles.section}>Recent payslips</Text>
          <Card style={styles.list}>
            {payslips.map((p) => (
              <View key={p.id} style={styles.line}>
                <Text style={styles.lineTitle}>{payslipPeriod(p)}</Text>
                <StatusPill label={p.status_display ?? p.status} tone={p.status === 'PAID' ? 'success' : p.status === 'APPROVED' ? 'info' : 'neutral'} />
                <Text style={styles.lineAmount}>{formatMoney(Number(p.net_salary) || 0)}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
  list: { padding: Spacing.md },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 6 },
  lineTitle: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  lineAmount: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
});
