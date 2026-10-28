import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, Modal, ScrollView, KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import { useNavigation } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { examinationsApi } from '../../services/api';
import { listOf } from '../../services/academicYear';
import type { ClassOption } from '../../services/attendanceEntry';
import {
  BEHAVIOUR_FIELDS, RATING_LABELS, SKILL_FIELDS, TOTAL_RATINGS, buildBulkPayload, canEditPrincipalRemark,
  changedStudents, formFromRow, monthOptions, ratedCount, toggleRating,
  type AssessmentForm, type RatingField, type RosterRow,
} from '../../services/assessments';
import { useAuth } from '../../contexts/AuthContext';
import { useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import Select from '../ui/Select';
import SearchBar from '../ui/SearchBar';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Props {
  // Teachers pass their own sections; admins leave it out and get every class.
  classOptions?: ClassOption[];
}

// Monthly student assessments: skill and behaviour ratings (1 to 5) plus remarks. Only the
// students you changed are sent on save. Needs a connection to save.
export default function AssessmentsScreen({ classOptions }: Props) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const { effectiveRole, isSuperAdmin } = useAuth();
  const canPrincipal = canEditPrincipalRemark(effectiveRole, isSuperAdmin);
  const { year, options, isLoading: classesLoading } = useAttendanceClassOptions(classOptions);
  const yearId = year.current?.id ?? null;

  const [classId, setClassId] = useState<number | null>(null);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<number, AssessmentForm>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const editsRef = useRef(edits);
  editsRef.current = edits;

  // Teachers get their first section pre-selected, as on the web.
  useEffect(() => {
    if (classOptions && classOptions.length > 0 && classId == null) setClassId(classOptions[0].id);
  }, [classOptions, classId]);

  const option = options.find((o) => o.id === classId) ?? null;
  const sessionClassId = option?.isSession ? option.id : null;
  const classObjId = option ? (option.classObj ?? option.id) : null;

  // Fresh each time so ratings from the web or another teacher show up.
  const rosterQ = useScopedQuery('studentAssessments', [yearId, month, sessionClassId, classObjId], async () =>
    listOf<RosterRow>((await examinationsApi.getStudentTermAssessmentRoster({
      academic_year: yearId,
      month,
      ...(sessionClassId ? { session_class: sessionClassId } : {}),
      ...(classObjId ? { class_obj: classObjId } : {}),
    })).data),
  { enabled: !!option && !!yearId, staleTime: 0 });
  const roster = rosterQ.data ?? [];
  const refreshControl = useRefreshControl(rosterQ.refetch);

  const changed = useMemo(() => changedStudents(roster, edits), [roster, edits]);
  const dirty = changed.length > 0;
  const formFor = (row: RosterRow) => edits[row.student] ?? formFromRow(row);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((r) => r.student_name.toLowerCase().includes(q) || String(r.roll_number ?? '').toLowerCase().includes(q));
  }, [roster, search]);

  const discardOk = useCallback(async () => {
    if (changedStudents(rosterRef.current, editsRef.current).length === 0) return true;
    return confirm({ title: 'Discard changes?', message: 'You have assessments that are not saved.', confirmLabel: 'Discard', destructive: true });
  }, []);
  const rosterRef = useRef<RosterRow[]>([]);
  rosterRef.current = roster;

  useEffect(() => {
    return navigation.addListener('beforeRemove', (e) => {
      if (changedStudents(rosterRef.current, editsRef.current).length === 0) return;
      e.preventDefault();
      confirm({ title: 'Leave without saving?', message: 'Your assessments will be lost.', confirmLabel: 'Leave', destructive: true })
        .then((ok) => ok && navigation.dispatch(e.data.action));
    });
  }, [navigation]);

  const switchTo = async (apply: () => void) => {
    if (!(await discardOk())) return;
    setEdits({});
    setEditing(null);
    apply();
  };

  const save = useMutation({
    mutationFn: async () => (await examinationsApi.bulkSaveStudentTermAssessment(buildBulkPayload({
      academicYearId: yearId!, month, sessionClassId, classObjId, roster, edits: editsRef.current, canEditPrincipal: canPrincipal,
    }))).data as { created?: number; updated?: number },
    onSuccess: async (res) => {
      // The refetched roster is the new baseline, so the saved edits can go.
      await queryClient.invalidateQueries({ queryKey: ['studentAssessments'] });
      setEdits({});
      toast.success(`Saved ${res.created ?? 0} new and ${res.updated ?? 0} updated assessment(s).`);
    },
    onError: (error: any) => {
      if (!error?.response) toast.error('No connection. Check your internet and try again.');
      else toast.error(error.response?.data?.detail || error.response?.data?.error || 'Could not save assessments.');
    },
  });

  if (classesLoading) return <Skeleton />;
  if (!year.current) return <EmptyState title="No academic session" message="Set a current academic year on the web app first." />;
  if (options.length === 0) return <EmptyState title="No classes" message="There are no classes to show." />;

  const editingRow = editing != null ? roster.find((r) => r.student === editing) ?? null : null;
  const loading = !!option && rosterQ.isLoading;
  const failed = !!option && !rosterQ.data && rosterQ.isError;

  const header = (
    <View>
      <Select label="Class" value={classId} options={options.map((o) => ({ value: o.id, label: o.label }))}
        onChange={(id) => switchTo(() => setClassId(id))} placeholder="Select a class" />
      <Select label="Month" value={month} options={monthOptions()} onChange={(m) => switchTo(() => setMonth(m))} />
      {roster.length > 0 ? <SearchBar value={search} onChangeText={setSearch} placeholder="Search by name or roll number..." /> : null}
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={option && !loading && !failed ? visible : []}
        keyExtractor={(r) => String(r.student)}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        ListEmptyComponent={
          !option ? <EmptyState title="Pick a class" message="Choose a class to rate its students." />
            : loading ? <Skeleton />
            : failed ? <ErrorState error={rosterQ.error} onRetry={() => rosterQ.refetch()} />
            : <EmptyState title="No students" message={search ? 'No students match your search.' : 'No students are enrolled in this class.'} />
        }
        renderItem={({ item }) => {
          const form = formFor(item);
          const rated = ratedCount(form);
          const isChanged = changed.includes(item.student);
          return (
            <TouchableOpacity style={styles.row} onPress={() => setEditing(item.student)}>
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={1}>{item.student_name}</Text>
                <Text style={styles.sub}>{item.roll_number ? `Roll ${item.roll_number}  ·  ` : ''}{rated}/{TOTAL_RATINGS} rated</Text>
              </View>
              {isChanged ? <StatusPill label="Unsaved" tone="warning" /> : rated === TOTAL_RATINGS ? <StatusPill label="Done" tone="success" /> : null}
              <Text style={styles.arrow}>›</Text>
            </TouchableOpacity>
          );
        }}
      />

      {roster.length > 0 ? (
        <View style={styles.footer}>
          <Button title={dirty ? `Save changes (${changed.length})` : 'No changes to save'} onPress={() => save.mutate()}
            loading={save.isPending} disabled={!dirty} fullWidth size="lg" />
        </View>
      ) : null}

      <Modal visible={!!editingRow} animationType="slide" onRequestClose={() => setEditing(null)}>
        {editingRow ? (
          <Editor
            row={editingRow}
            form={formFor(editingRow)}
            canPrincipal={canPrincipal}
            onChange={(next) => setEdits((e) => ({ ...e, [editingRow.student]: next }))}
            onClose={() => setEditing(null)}
          />
        ) : null}
      </Modal>
    </KeyboardAvoidingView>
  );
}

function Editor({ row, form, canPrincipal, onChange, onClose }: {
  row: RosterRow; form: AssessmentForm; canPrincipal: boolean; onChange: (f: AssessmentForm) => void; onClose: () => void;
}) {
  const group = (title: string, fields: ReadonlyArray<readonly [RatingField, string]>) => (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      {fields.map(([key, label]) => (
        <View key={key} style={styles.ratingRow}>
          <View style={styles.ratingHead}>
            <Text style={styles.ratingLabel}>{label}</Text>
            <Text style={styles.ratingText}>{form[key] ? RATING_LABELS[form[key] as number] : 'Not rated'}</Text>
          </View>
          <View style={styles.chips}>
            {[1, 2, 3, 4, 5].map((n) => (
              <TouchableOpacity key={n} style={[styles.chip, form[key] === n && styles.chipOn]}
                accessibilityLabel={`${label} ${n}`} onPress={() => onChange(toggleRating(form, key, n))}>
                <Text style={[styles.chipText, form[key] === n && styles.chipTextOn]}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}
    </View>
  );

  return (
    <View style={styles.editor}>
      <View style={styles.editorHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.editorName} numberOfLines={1}>{row.student_name}</Text>
          <Text style={styles.sub}>{ratedCount(form)}/{TOTAL_RATINGS} rated</Text>
        </View>
        <Button title="Done" onPress={onClose} size="sm" />
      </View>
      <ScrollView contentContainerStyle={styles.editorBody} keyboardShouldPersistTaps="handled">
        {group('Skills', SKILL_FIELDS)}
        {group('Behaviour', BEHAVIOUR_FIELDS)}
        <Text style={styles.groupTitle}>Teacher remark</Text>
        <TextInput style={styles.remark} multiline value={form.teacher_remark} placeholder="Remark about this student"
          placeholderTextColor={Colors.textTertiary} onChangeText={(t) => onChange({ ...form, teacher_remark: t })} />
        <Text style={styles.groupTitle}>Principal remark</Text>
        {canPrincipal ? (
          <TextInput style={styles.remark} multiline value={form.principal_remark} placeholder="Principal remark"
            placeholderTextColor={Colors.textTertiary} onChangeText={(t) => onChange({ ...form, principal_remark: t })} />
        ) : (
          <Text style={styles.readonly}>{form.principal_remark || 'No principal remark yet.'}</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: 110 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, gap: Spacing.sm },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '500', color: Colors.text },
  sub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  arrow: { fontSize: FontSize.xl, color: Colors.textTertiary },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.lg, backgroundColor: Colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  editor: { flex: 1, backgroundColor: Colors.background },
  editorHead: { flexDirection: 'row', alignItems: 'center', padding: Spacing.lg, paddingTop: Spacing.xxxl, backgroundColor: Colors.surface, gap: Spacing.md },
  editorName: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  editorBody: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  group: { marginBottom: Spacing.lg },
  groupTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm },
  ratingRow: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  ratingHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.sm },
  ratingLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  ratingText: { fontSize: FontSize.xs, color: Colors.textSecondary },
  chips: { flexDirection: 'row', gap: Spacing.sm },
  chip: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.md, fontWeight: '600', color: Colors.textSecondary },
  chipTextOn: { color: Colors.textInverse },
  remark: { minHeight: 80, textAlignVertical: 'top', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, fontSize: FontSize.sm, color: Colors.text, marginBottom: Spacing.lg },
  readonly: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.lg },
});
