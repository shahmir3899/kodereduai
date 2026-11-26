import React, { useState } from 'react';
import { ScrollView, Switch, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useCategoryActions, useCategorySuggestions, useManagedCategories } from '../../hooks/useFinanceSetup';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  buildCategoryPayload, canSetSensitive, CATEGORY_TABS, categoryNoun, categoryToForm, emptyCategoryForm, hasBilling, hasDescription,
  validateCategory, type CategoryForm, type CategoryKind, type ManagedCategory,
} from '../../services/financeSetup';
import { inventoryErrorMessage } from '../../services/inventory';
import SegmentedTabs from '../ui/SegmentedTabs';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import FeeEnrollmentsSheet from './FeeEnrollmentsSheet';
import OptionalFeesList from './OptionalFeesList';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// The web's category manager modals (expense, monthly fee, annual fee) plus income categories, which the
// web only lets you create inline. Admin and principal only; the server refuses everyone else.
export default function CategoriesScreen() {
  // "Optional" lists the enrolled-only fees (Robotics, Karate...) together, next to the category kinds.
  const [kind, setKind] = useState<CategoryKind | 'optional'>('expense');
  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <SegmentedTabs tabs={[...CATEGORY_TABS, { value: 'optional' as const, label: 'Optional' }]} value={kind} onChange={setKind} scrollable />
      </View>
      {kind === 'optional' ? <OptionalFeesList /> : <CategoryList key={kind} kind={kind} />}
    </View>
  );
}

function CategoryList({ kind }: { kind: CategoryKind }) {
  const toast = useToast();
  const q = useManagedCategories(kind);
  const suggestions = useCategorySuggestions(kind);
  const actions = useCategoryActions(kind);
  const refreshControl = useRefreshControl(q.refetch);
  const [editing, setEditing] = useState<ManagedCategory | 'new' | null>(null);
  const [form, setForm] = useState<CategoryForm>(emptyCategoryForm());
  const [error, setError] = useState<string | null>(null);
  const [students, setStudents] = useState<ManagedCategory | null>(null);
  const rows = q.data ?? [];
  const noun = categoryNoun(kind);

  const open = (c: ManagedCategory | 'new') => {
    setForm(c === 'new' ? emptyCategoryForm() : categoryToForm(c));
    setError(null);
    setEditing(c);
  };

  const save = async () => {
    const problem = validateCategory(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      const payload = buildCategoryPayload(kind, form, rows);
      if (editing === 'new') {
        const res = await actions.create.mutateAsync(payload);
        // An optional fee is useless until students are enrolled: open that next.
        const created = (res as { data?: ManagedCategory }).data;
        if (created?.billing_mode === 'ENROLLED') {
          toast.success('Saved. Now enroll the students.');
          setEditing(null);
          setStudents(created);
          return;
        }
      }
      else await actions.update.mutateAsync({ id: (editing as ManagedCategory).id, data: payload });
      toast.success('Saved.');
      setEditing(null);
    } catch (e) {
      setError(inventoryErrorMessage(e, `Could not save the ${noun}.`));
    }
  };

  const remove = async (c: ManagedCategory) => {
    if (!(await confirm({ title: 'Delete category?', message: c.name, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.remove.mutateAsync(c.id);
      toast.success('Category deleted.');
      setEditing(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, `Could not delete the ${noun}.`));
    }
  };

  const addSuggestion = async (s: { name: string; description?: string }) => {
    try {
      await actions.create.mutateAsync({ name: s.name, description: s.description ?? '' });
      toast.success(`${s.name} added.`);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not add the category.'));
    }
  };

  if (q.isLoading) return <Skeleton />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
        <Button title="+ New category" size="sm" onPress={() => open('new')} />
        {(suggestions.data ?? []).length > 0 ? (
          <View>
            <Text style={styles.hint}>Suggestions (tap to add)</Text>
            <View style={styles.chips}>
              {(suggestions.data ?? []).map((s) => (
                <TouchableOpacity key={s.name} accessibilityRole="button" accessibilityLabel={`Add ${s.name}`} style={styles.chip} disabled={actions.create.isPending} onPress={() => addSuggestion(s)}>
                  <Text style={styles.chipText}>+ {s.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}
        {rows.length === 0 ? <EmptyState title="No categories" message={`Add a ${noun} to get started.`} /> : rows.map((c) => (
          <TouchableOpacity key={c.id} accessibilityRole="button" accessibilityLabel={`Edit ${c.name}`} style={styles.row} onPress={() => open(c)}>
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
              {c.description ? <Text style={styles.sub} numberOfLines={1}>{c.description}</Text> : null}
            </View>
            {c.billing_mode === 'ENROLLED' ? (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${c.name} students`} hitSlop={6} onPress={() => setStudents(c)}>
                <StatusPill label={`Enrolled · ${c.enrolled_count ?? 0}`} tone="info" />
              </TouchableOpacity>
            ) : null}
            {c.is_sensitive ? <StatusPill label="Sensitive" tone="warning" /> : null}
            {c.is_active === false ? <StatusPill label="Inactive" tone="neutral" /> : null}
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FormSheet visible={editing !== null} title={editing === 'new' ? `New ${noun}` : `Edit ${noun}`} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.create.isPending || actions.update.isPending} error={error}>
        <Input label="Name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
        {hasDescription(kind) ? <Input label="Description (optional)" value={form.description} onChangeText={(v) => setForm((f) => ({ ...f, description: v }))} /> : null}
        {canSetSensitive(kind, rows) ? (
          <View style={styles.toggle}>
            <Text style={styles.toggleLabel}>Sensitive (hidden from restricted roles)</Text>
            <Switch value={form.isSensitive} onValueChange={(v) => setForm((f) => ({ ...f, isSensitive: v }))} accessibilityLabel="Sensitive" />
          </View>
        ) : null}
        {hasBilling(kind) ? (
          <>
            <View style={styles.toggle}>
              <Text style={styles.toggleLabel}>Only enrolled students pay (e.g. Robotics, Karate)</Text>
              <Switch value={form.enrolledOnly} onValueChange={(v) => setForm((f) => ({ ...f, enrolledOnly: v }))} accessibilityLabel="Only enrolled students pay" />
            </View>
            {form.enrolledOnly ? (
              <Input label="Price per enrolled student (Rs)" value={form.price} keyboardType="numeric" placeholder="e.g. 1500"
                onChangeText={(v) => setForm((f) => ({ ...f, price: v }))} />
            ) : null}
            {editing && editing !== 'new' && editing.billing_mode === 'ENROLLED' ? (
              <Button title="Manage enrolled students" size="sm" variant="outline" onPress={() => { const c = editing; setEditing(null); setStudents(c); }} />
            ) : null}
          </>
        ) : null}
        {editing && editing !== 'new' ? <Button title="Delete category" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>
      {hasBilling(kind) ? (
        <FeeEnrollmentsSheet kind={kind as 'monthly' | 'annual'} category={students} onClose={() => setStudents(null)} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  tabs: { padding: Spacing.lg, paddingBottom: 0 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { minHeight: 36, justifyContent: 'center', borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.primary, paddingHorizontal: Spacing.md },
  chipText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.sm },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  toggleLabel: { fontSize: FontSize.md, color: Colors.text, flex: 1, marginRight: Spacing.md },
});
