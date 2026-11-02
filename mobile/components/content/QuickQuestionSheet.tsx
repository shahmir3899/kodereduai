import React, { useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useQuestionActions } from '../../hooks/useQuestionBank';
import {
  BLOOM_LEVELS, buildQuestionPayload, DIFFICULTIES, emptyQuestionForm, QUESTION_TYPES, validateQuestion, type Question, type QuestionForm,
} from '../../services/questionBank';
import { inventoryErrorMessage } from '../../services/inventory';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { useToast } from '../ui/Toast';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize } from '../../constants/colors';

// Write a new question while building a paper, as the web's question slot does: the question goes into the
// bank (same call as the question bank) and straight into the paper. Matching questions and pictures are made
// in the question bank.
export default function QuickQuestionSheet({ visible, subject, onClose, onCreated }: {
  visible: boolean; subject: number | null; onClose: () => void; onCreated: (q: Question) => void;
}) {
  const toast = useToast();
  const actions = useQuestionActions();
  const [form, setForm] = useState<QuestionForm>(emptyQuestionForm());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof QuestionForm>(k: K, v: QuestionForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (visible) { setForm({ ...emptyQuestionForm(), subject }); setError(null); }
  }, [visible, subject]);

  const save = async () => {
    const problem = validateQuestion(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      const res = await actions.create.mutateAsync(buildQuestionPayload(form));
      toast.success('Question added to the bank and the paper.');
      onCreated(res.data as Question);
      onClose();
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  return (
    <FormSheet visible={visible} title="New question" onClose={onClose} onSubmit={save} submitLabel="Add to paper" busy={actions.create.isPending} error={error}>
      {!subject ? <Text style={styles.hint}>Choose the paper's subject first.</Text> : null}
      <Select label="Type" value={form.type} onChange={(v) => set('type', v)} options={QUESTION_TYPES.filter((t) => t.value !== 'MATCHING').map((t) => ({ value: t.value as string, label: t.label }))} />
      <Input label="Question" value={form.text} onChangeText={(v) => set('text', v)} multiline style={styles.big} />
      {form.type === 'MCQ' ? (
        <>
          <Input label="Option A" value={form.a} onChangeText={(v) => set('a', v)} />
          <Input label="Option B" value={form.b} onChangeText={(v) => set('b', v)} />
          <Input label="Option C (optional)" value={form.c} onChangeText={(v) => set('c', v)} />
          <Input label="Option D (optional)" value={form.d} onChangeText={(v) => set('d', v)} />
          <Select label="Correct option" value={form.correct} onChange={(v) => set('correct', v)} placeholder="Not set" options={['A', 'B', 'C', 'D'].map((k) => ({ value: k, label: k }))} />
        </>
      ) : form.type === 'TRUE_FALSE' ? (
        <Select label="Answer" value={form.correct.toLowerCase()} onChange={(v) => set('correct', v)} placeholder="Choose" options={[{ value: 'true', label: 'True' }, { value: 'false', label: 'False' }]} />
      ) : (
        <Input label={form.type === 'FILL_BLANK' ? 'Accepted answer (optional)' : 'Short answer key (optional)'} value={form.correct} onChangeText={(v) => set('correct', v)} />
      )}
      {['SHORT', 'LONG', 'ESSAY'].includes(form.type) ? <Input label="Model answer (optional)" value={form.answer} onChangeText={(v) => set('answer', v)} multiline /> : null}
      <Input label="Marks" value={form.marks} onChangeText={(v) => set('marks', v)} keyboardType="decimal-pad" />
      <Select label="Difficulty" value={form.difficulty} onChange={(v) => set('difficulty', v)} options={DIFFICULTIES.map((d) => ({ value: d.value as string, label: d.label }))} />
      <Select label="Thinking level (optional)" value={form.bloom} onChange={(v) => set('bloom', v)} placeholder="Not set" options={BLOOM_LEVELS.map((b) => ({ value: b.value as string, label: b.label }))} />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  big: { minHeight: 100, textAlignVertical: 'top' },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
});
