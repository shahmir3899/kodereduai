import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Switch, TouchableOpacity, StyleSheet } from 'react-native';
import { useAcademicYear, useSessionClasses } from '../../hooks/useAcademicYear';
import { useAdmissionsActions } from '../../hooks/useAdmissions';
import {
  admissionsErrorMessage, buildConvertPayload, emptyConvertForm, FEE_TYPES, gradeLabel, gradeMismatches, sectionLabel,
  summariseConvert, validateConvert, type ConvertForm, type ConvertResult, type Enquiry, type FeeTypeCode, type Section,
} from '../../services/admissions';
import Select from '../ui/Select';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing } from '../../constants/colors';

interface Props {
  visible: boolean;
  enquiries: Enquiry[];
  onClose: () => void;
  // Called once the server has answered (even when some enquiries failed).
  onDone: (summary: ReturnType<typeof summariseConvert>) => void;
}

// Turns confirmed enquiries into students. The section decides the class, the roll number and the
// fees, so it is always chosen by the user and sent as session_class_id.
export default function ConvertSheet({ visible, enquiries, onClose, onDone }: Props) {
  const { years, current } = useAcademicYear();
  const actions = useAdmissionsActions();
  const [form, setForm] = useState<ConvertForm>(emptyConvertForm());
  const [error, setError] = useState<string | null>(null);

  // Start each opening on the current year with nothing chosen from last time.
  useEffect(() => {
    if (visible) {
      setForm(emptyConvertForm(current?.id ?? null));
      setError(null);
    }
  }, [visible, current?.id]);

  const sections = useSessionClasses(form.yearId);
  const sectionRows = useMemo(() => (sections.data ?? []) as unknown as Section[], [sections.data]);
  const section = sectionRows.find((s) => s.id === form.sectionId) ?? null;
  const mismatched = gradeMismatches(enquiries, section);

  const toggleFee = (code: FeeTypeCode) =>
    setForm((f) => ({ ...f, feeTypes: f.feeTypes.includes(code) ? f.feeTypes.filter((c) => c !== code) : [...f.feeTypes, code] }));

  const submit = async () => {
    const problem = validateConvert(form, enquiries.length);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    const label = section ? sectionLabel(section) : 'the chosen section';
    const ok = await confirm({
      title: 'Convert to students',
      message: `Create ${enquiries.length} student${enquiries.length === 1 ? '' : 's'} in ${label}? This cannot be undone from the phone.`,
      confirmLabel: 'Convert',
    });
    if (!ok) return;
    try {
      const result = await actions.convert.mutateAsync(buildConvertPayload(enquiries.map((e) => e.id), form));
      onDone(summariseConvert(result));
    } catch (e) {
      // 400 also carries the per-enquiry errors when nothing could be converted.
      const body = (e as { response?: { data?: ConvertResult } })?.response?.data;
      if (body && Array.isArray(body.errors) && body.errors.length > 0) {
        const summary = summariseConvert(body);
        setError(summary.failures[0] ?? summary.message);
      } else {
        setError(admissionsErrorMessage(e, 'Could not convert. Try again.'));
      }
    }
  };

  return (
    <FormSheet
      visible={visible} title="Convert to students" onClose={onClose} onSubmit={submit}
      submitLabel={`Convert ${enquiries.length} enquir${enquiries.length === 1 ? 'y' : 'ies'}`} busy={actions.convert.isPending} error={error}
    >
      <Text style={styles.note}>
        Each child is enrolled in the section you choose. {enquiries.map((e) => `${e.name} (${gradeLabel(e.applying_for_grade_level)})`).join(', ')}
      </Text>
      <Select
        label="Academic year" value={form.yearId} onChange={(v) => setForm((f) => ({ ...f, yearId: v, sectionId: null }))}
        options={years.map((y) => ({ value: y.id, label: `${y.name}${y.is_current ? ' (current)' : ''}` }))}
      />
      <Select
        label="Class and section" placeholder={form.yearId ? 'Choose a section' : 'Choose the year first'} searchable
        value={form.sectionId} onChange={(v) => setForm((f) => ({ ...f, sectionId: v }))} disabled={!form.yearId}
        options={sectionRows.map((s) => ({ value: s.id, label: sectionLabel(s) }))}
      />
      {mismatched.length > 0 && section ? (
        <Text style={styles.warn}>{mismatched.join(', ')} applied for a different grade than {sectionLabel(section)}.</Text>
      ) : null}

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Generate fee records</Text>
        <Switch value={form.generateFees} onValueChange={(v) => setForm((f) => ({ ...f, generateFees: v }))} accessibilityLabel="Generate fee records" />
      </View>
      {form.generateFees ? (
        <View style={styles.fees}>
          {FEE_TYPES.map((ft) => {
            const on = form.feeTypes.includes(ft.value);
            return (
              <TouchableOpacity
                key={ft.value} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={ft.label}
                style={styles.feeRow} onPress={() => toggleFee(ft.value)}
              >
                <View style={[styles.box, on && styles.boxOn]}>{on ? <Text style={styles.tick}>✓</Text> : null}</View>
                <Text style={styles.feeLabel}>{ft.label}</Text>
              </TouchableOpacity>
            );
          })}
          <Text style={styles.note}>Fee structures must be set up in Finance for the chosen class, or those fees are skipped.</Text>
        </View>
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: FontSize.sm, color: Colors.textSecondary },
  warn: { fontSize: FontSize.sm, color: Colors.warning },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  switchLabel: { fontSize: FontSize.md, color: Colors.text },
  fees: { gap: Spacing.xs },
  feeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 44 },
  box: { width: 22, height: 22, borderRadius: 4, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tick: { color: Colors.textInverse, fontSize: FontSize.sm, fontWeight: '700' },
  feeLabel: { fontSize: FontSize.md, color: Colors.text },
});
