import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAdmissionsActions } from '../../hooks/useAdmissions';
import {
  admissionsErrorMessage, buildEnquiryPayload, emptyEnquiryForm, enquiryToForm, GRADES, SOURCES, validateEnquiry,
  type EnquiryDetail, type EnquiryForm,
} from '../../services/admissions';
import Input from '../ui/Input';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import { useToast } from '../ui/Toast';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize } from '../../constants/colors';

// Select has no empty value, so "no grade" is a real option that maps back to null.
const NOT_DECIDED = -1;

interface Props {
  visible: boolean;
  // The full record when editing (the list rows have no notes, and an edit sends them back).
  enquiry: EnquiryDetail | null;
  onClose: () => void;
  onSaved?: () => void;
}

export default function EnquiryFormSheet({ visible, enquiry, onClose, onSaved }: Props) {
  const toast = useToast();
  const actions = useAdmissionsActions();
  const editing = enquiry !== null;
  const [form, setForm] = useState<EnquiryForm>(emptyEnquiryForm());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof EnquiryForm>(key: K, value: EnquiryForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (visible) {
      setForm(enquiry ? enquiryToForm(enquiry) : emptyEnquiryForm());
      setError(null);
    }
    // Reset only when the sheet opens, not when a background refetch hands back a new object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const save = async () => {
    const problem = validateEnquiry(form);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      const payload = buildEnquiryPayload(form, editing);
      if (editing) await actions.updateEnquiry.mutateAsync({ id: enquiry.id, data: payload });
      else await actions.createEnquiry.mutateAsync(payload);
      toast.success(editing ? 'Enquiry saved.' : 'Enquiry added.');
      onSaved?.();
      onClose();
    } catch (e) {
      setError(admissionsErrorMessage(e));
    }
  };

  return (
    <FormSheet
      visible={visible} title={editing ? 'Edit enquiry' : 'New enquiry'} onClose={onClose} onSubmit={save}
      submitLabel={editing ? 'Save changes' : 'Add enquiry'} busy={actions.createEnquiry.isPending || actions.updateEnquiry.isPending} error={error}
    >
      <Input label="Child's name" value={form.name} onChangeText={(v) => set('name', v)} autoCapitalize="words" />
      <Input label="Father's name" value={form.fatherName} onChangeText={(v) => set('fatherName', v)} autoCapitalize="words" />
      <Input label="Mobile" value={form.mobile} onChangeText={(v) => set('mobile', v)} keyboardType="phone-pad" placeholder="0300-1234567" />
      <Select
        label="Grade applying for" value={form.grade ?? NOT_DECIDED} onChange={(v) => set('grade', v === NOT_DECIDED ? null : v)}
        options={[{ value: NOT_DECIDED, label: 'Not decided' }, ...GRADES.map((g) => ({ value: g.value, label: g.label }))]}
      />
      <Select label="Source" value={form.source} onChange={(v) => set('source', v)} options={SOURCES.map((s) => ({ value: s.value, label: s.label }))} />
      <DateField label="Next follow-up" value={form.followUp} onChange={(v) => set('followUp', v)} placeholder="No follow-up date" />
      {form.followUp ? (
        <TouchableOpacity accessibilityRole="button" onPress={() => set('followUp', '')} style={styles.clear}>
          <Text style={styles.clearText}>Clear follow-up date</Text>
        </TouchableOpacity>
      ) : null}
      <Input label="Notes (optional)" value={form.notes} onChangeText={(v) => set('notes', v)} multiline numberOfLines={3} style={{ minHeight: 72, textAlignVertical: 'top' }} />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  clear: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' },
  clearText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '600' },
});
