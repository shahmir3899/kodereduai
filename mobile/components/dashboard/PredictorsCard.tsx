import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { admissionsApi, inventoryApi } from '../../services/api';
import { routeFor } from '../../navigation/routes';
import { goingColdCount, visiblePredictors, type PredictorRow } from '../../services/adminDashboard';
import { useInsight } from '../../hooks/useInsights';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import Card from '../ui/Card';
import StatusPill from '../ui/StatusPill';
import { SEVERITY_TONE } from '../../services/insights';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// The web "Predictors" list: how many students, staff, leads and stock items are flagged, with a
// tap through to the detail. Counts only; names stay on the Insights screen. Hidden while loading
// and when nothing is flagged. For admin and principal (the risk scans refuse everyone else).
export default function PredictorsCard() {
  const router = useRouter();
  const { isModuleEnabled } = useAuth();
  const students = useInsight('students', isModuleEnabled('students'));
  const attendance = useInsight('attendance', isModuleEnabled('attendance'));
  const academic = useInsight('academic', isModuleEnabled('examinations'));
  const staff = useInsight('staff', isModuleEnabled('hr'));
  const leads = useScopedQuery('predictorLeads', [], async () => goingColdCount((await admissionsApi.getConversionLikelihood()).data),
    { enabled: isModuleEnabled('admissions'), staleTime: 10 * 60_000, retry: false });
  const reorder = useScopedQuery('predictorReorder', [], async () => (await inventoryApi.getReorderPrediction()).data as { at_risk_count?: number; risk_levels?: PredictorRow['levels'] },
    { enabled: isModuleEnabled('inventory'), staleTime: 10 * 60_000, retry: false });

  const insights = routeFor('admin', '/students/risk-score');
  const fromScan = (key: string, label: string, q: typeof students): PredictorRow => ({
    key, label, count: q.data?.summary.atRisk ?? 0, levels: q.data?.summary.levels, route: insights,
  });
  const rows = visiblePredictors([
    fromScan('students', 'Student risk score', students),
    fromScan('attendance', 'Attendance risk', attendance),
    fromScan('academic', 'Academic risk', academic),
    { key: 'leads', label: 'Admissions: leads going cold', count: leads.data ?? 0, note: `${leads.data ?? 0} need follow-up`, route: routeFor('admin', '/admissions/conversion-likelihood') },
    fromScan('staff', 'Staff risk', staff),
    { key: 'reorder', label: 'Inventory reorder', count: reorder.data?.at_risk_count ?? 0, levels: reorder.data?.risk_levels, route: routeFor('admin', '/inventory/reorder-prediction') },
  ]);
  if (rows.length === 0) return null;

  return (
    <View>
      <Text style={styles.section}>Predictors</Text>
      {rows.map((r) => (
        <TouchableOpacity key={r.key} accessibilityRole="button" disabled={!r.route} onPress={() => r.route && router.push(r.route as Href)}>
          <Card style={styles.row}>
            <View style={styles.body}>
              <Text style={styles.label}>{r.label}</Text>
              {r.note ? <Text style={styles.note}>{r.note}</Text> : (
                <View style={styles.pills}>
                  {(['HIGH', 'MEDIUM', 'LOW'] as const).filter((l) => (r.levels?.[l] ?? 0) > 0).map((l) => (
                    <StatusPill key={l} label={`${l} ${r.levels?.[l]}`} tone={SEVERITY_TONE[l]} />
                  ))}
                </View>
              )}
            </View>
            <Text style={styles.arrow}>›</Text>
          </Card>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, marginBottom: Spacing.sm },
  body: { flex: 1 },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  note: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs },
  arrow: { fontSize: FontSize.xl, color: Colors.textTertiary },
});
