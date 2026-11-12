import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { usePersonaBase } from '../../hooks/usePersonaBase';
import { useConfig, useLibraryActions, useLibraryStats } from '../../hooks/useLibrary';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { buildConfigPayload, configToForm, rupees, statTiles, validateConfig, type ConfigForm } from '../../services/library';
import { inventoryErrorMessage } from '../../services/inventory';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Input from '../ui/Input';
import QueryBoundary from '../ui/QueryBoundary';
import { useToast } from '../ui/Toast';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const TONE = { info: Colors.primary, success: Colors.success, warning: Colors.warning } as const;

// The library at a glance, with the way into the catalog, issue and return, overdue books and the
// loan settings. Admin and principal manage; a teacher sees the same screens read-only (no settings, no issue).
export default function LibraryDashboardScreen() {
  const router = useRouter();
  const base = usePersonaBase();
  const { isSchoolAdminNav: canManage } = useAuth();
  const toast = useToast();
  const stats = useLibraryStats();
  const config = useConfig(); // read allowed for everyone; only admin and principal can change it
  const actions = useLibraryActions();
  const refreshControl = useRefreshControl(stats.refetch);
  const [settings, setSettings] = useState(false);
  const [form, setForm] = useState<ConfigForm>({ loanDays: '', maxStudent: '', maxStaff: '', finePerDay: '' });
  const [error, setError] = useState<string | null>(null);
  const go = (path: string) => router.push(path as Href);

  useEffect(() => { if (settings && config.data) { setForm(configToForm(config.data)); setError(null); } }, [settings, config.data]);

  const save = async () => {
    const problem = validateConfig(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      await actions.saveConfig.mutateAsync(buildConfigPayload(form));
      toast.success('Library settings saved.');
      setSettings(false);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <QueryBoundary query={stats} emptyTitle="No library data" emptyMessage="Nothing to show yet.">
        {(s) => (
          <>
            <View style={styles.tiles}>
              {statTiles(s).map((t) => (
                <View key={t.label} style={styles.tile}>
                  <Text style={[styles.tileValue, { color: TONE[t.tone] }]}>{t.value}</Text>
                  <Text style={styles.tileLabel}>{t.label}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.sub}>{`${s.total_categories ?? 0} categories  ·  fines collected ${rupees(s.total_fine_collected)}`}</Text>
            {(s.most_issued_books ?? []).length > 0 ? (
              <Card style={styles.card}>
                <Text style={styles.section}>Most issued books</Text>
                {(s.most_issued_books ?? []).map((b) => (
                  <View key={b.id} style={styles.line}>
                    <Text style={styles.lineName} numberOfLines={1}>{b.title}</Text>
                    <Text style={styles.sub}>{b.issue_count}×</Text>
                  </View>
                ))}
              </Card>
            ) : null}
          </>
        )}
      </QueryBoundary>
      <Button title={canManage ? 'Issue or return a book' : 'Books out now'} onPress={() => go(`${base}/library/issue`)} />
      <Button title="Catalog" variant="outline" onPress={() => go(`${base}/library/catalog`)} />
      <Button title="Overdue books" variant="outline" onPress={() => go(`${base}/library/overdue`)} />
      {canManage ? <Button title="Library settings" variant="ghost" onPress={() => setSettings(true)} /> : null}

      <FormSheet visible={settings} title="Library settings" onClose={() => setSettings(false)} onSubmit={save} submitLabel="Save" busy={actions.saveConfig.isPending} error={error}>
        {config.isLoading ? <Text style={styles.sub}>Loading settings...</Text> : null}
        <Input label="Loan period (days)" value={form.loanDays} onChangeText={(v) => setForm((f) => ({ ...f, loanDays: v }))} keyboardType="number-pad" />
        <Input label="Books a student can hold at once" value={form.maxStudent} onChangeText={(v) => setForm((f) => ({ ...f, maxStudent: v }))} keyboardType="number-pad" />
        <Input label="Books a staff member can hold at once" value={form.maxStaff} onChangeText={(v) => setForm((f) => ({ ...f, maxStaff: v }))} keyboardType="number-pad" />
        <Input label="Fine per overdue day (Rs.)" value={form.finePerDay} onChangeText={(v) => setForm((f) => ({ ...f, finePerDay: v }))} keyboardType="decimal-pad" />
      </FormSheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: { flexBasis: '47%', flexGrow: 1, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, alignItems: 'center' },
  tileValue: { fontSize: FontSize.xxl, fontWeight: '800' },
  tileLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  card: { gap: Spacing.xs },
  section: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginBottom: Spacing.xs },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
  lineName: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
});
