import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useQuestionActions } from '../../hooks/useQuestionBank';
import {
  BLOOM_LEVELS, buildQuestionPayload, DIFFICULTIES, emptyQuestionForm, QUESTION_TYPES, typeLabel, validateQuestion, type Question, type QuestionForm,
} from '../../services/questionBank';
import { inventoryErrorMessage } from '../../services/inventory';
import Input from '../ui/Input';
import Select from '../ui/Select';
import BlankFields from './BlankFields';
import MatchingFields from './MatchingFields';
import RichTextField from './RichTextField';
import QuestionPictures from './QuestionPictures';
import { useToast } from '../ui/Toast';
import FormSheet from '../inventory/FormSheet';
import { BorderRadius, Colors, FontSize, Spacing } from '../../constants/colors';

// Write a new question while building a paper, as the web's question slot does: the question goes into the
// bank (same call as the question bank) and straight into the paper. Pictures are added in the question bank.
export default function QuickQuestionSheet({ visible, subject, section, slotsLeft, onClose, onCreated }: {
  visible: boolean; subject: number | null; onClose: () => void; onCreated: (q: Question) => void;
  // Writing into a section: its type and marks are fixed by the structure (as on the web), and the sheet closes once the last slot is filled.
  section?: { title: string; question_type: string; marksPerQuestion: number } | null; slotsLeft?: number;
}) {
  const toast = useToast();
  const actions = useQuestionActions();
  const [form, setForm] = useState<QuestionForm>(emptyQuestionForm());
  const [error, setError] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  // Loads the cleared text into the editor after "Add and write another".
  const [editorKey, setEditorKey] = useState(0);
  // A picture needs a question to attach to, so the first one saves the question to the bank (as the web does); Add then updates it.
  const [created, setCreated] = useState<Question | null>(null);
  const set = <K extends keyof QuestionForm>(k: K, v: QuestionForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (visible) { setCreated(null); setForm({ ...emptyQuestionForm(), subject, ...(section ? { type: section.question_type, marks: String(section.marksPerQuestion) } : {}) }); setError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, subject]);

  const ensure = async (): Promise<Question | null> => {
    const problem = validateQuestion(form);
    if (problem) { setError(`Write the question first to add a picture: ${problem}`); return null; }
    setError(null);
    try {
      const q = (await actions.create.mutateAsync(buildQuestionPayload(form))).data as Question;
      setCreated(q);
      return q;
    } catch (e) {
      setError(inventoryErrorMessage(e));
      return null;
    }
  };

  const save = async (another = false) => {
    const problem = validateQuestion(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      const res = created
        ? await actions.update.mutateAsync({ id: created.id, data: buildQuestionPayload(form) })
        : await actions.create.mutateAsync(buildQuestionPayload(form));
      toast.success('Question added to the bank and the paper.');
      onCreated(res.data as Question);
      if (!another || (slotsLeft !== undefined && slotsLeft <= 1)) return onClose();
      // Next question: same type, marks and levels, so ten like questions are ten fields of typing.
      setForm((f) => ({ ...emptyQuestionForm(), subject, type: f.type, marks: f.marks, difficulty: f.difficulty, bloom: f.bloom }));
      setScrollTop((n) => n + 1);
      setEditorKey((n) => n + 1);
      setCreated(null);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  return (
    <FormSheet visible={visible} title={section ? `New question · ${section.title}` : 'New question'} onClose={onClose} onSubmit={() => save(false)} submitLabel="Add to paper" secondaryLabel={slotsLeft !== undefined && slotsLeft <= 1 ? undefined : 'Add and write another'} onSecondary={() => save(true)} scrollTopKey={scrollTop} busy={actions.create.isPending} error={error}>
      {!subject ? <Text style={styles.hint}>Choose the paper's subject first.</Text> : null}
      <Text style={styles.label}>Type</Text>
      {section ? <Text style={styles.hint}>{typeLabel(section.question_type)} · {section.marksPerQuestion} mark{section.marksPerQuestion === 1 ? '' : 's'}, set by the section.</Text> : (
        <>
      {/* Chips that wrap, not a sideways scroller: every type stays visible on a phone. */}
        <View style={styles.chips}>
          {QUESTION_TYPES.map((t) => (
            <TouchableOpacity key={t.value} accessibilityRole="button" accessibilityLabel={t.label} accessibilityState={{ selected: form.type === t.value }}
              style={[styles.chip, form.type === t.value && styles.chipOn]} onPress={() => setForm((f) => ({ ...f, type: t.value, correct: '' }))}>
              <Text style={[styles.chipText, form.type === t.value && styles.chipTextOn]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
          </>
      )}
      <RichTextField label="Question" value={form.text} onChange={(v) => set('text', v)} resetKey={editorKey} />
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
      ) : form.type === 'FILL_BLANK' ? (
        <BlankFields blanks={form.blanks} onChange={(next) => set('blanks', next)} />
      ) : form.type === 'MATCHING' ? (
        <MatchingFields form={form} set={set} />
      ) : (
        <Input label="Short answer key (optional)" value={form.correct} onChangeText={(v) => set('correct', v)} />
      )}
      {['SHORT', 'LONG', 'ESSAY'].includes(form.type) ? <Input label="Model answer (optional)" value={form.answer} onChangeText={(v) => set('answer', v)} multiline /> : null}
      {section ? null : <Input label="Marks" value={form.marks} onChangeText={(v) => set('marks', v)} keyboardType="decimal-pad" />}
      <QuestionPictures question={created} type={form.type} ensure={ensure} onChange={setCreated} />
      <Select label="Difficulty" value={form.difficulty} onChange={(v) => set('difficulty', v)} options={DIFFICULTIES.map((d) => ({ value: d.value as string, label: d.label }))} />
      <Select label="Thinking level (optional)" value={form.bloom} onChange={(v) => set('bloom', v)} placeholder="Not set" options={BLOOM_LEVELS.map((b) => ({ value: b.value as string, label: b.label }))} />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  big: { minHeight: 100, textAlignVertical: 'top' },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { minHeight: 40, paddingHorizontal: Spacing.md, justifyContent: 'center', borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  chipOn: { backgroundColor: Colors.infoLight, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  chipTextOn: { color: Colors.primary, fontWeight: '600' },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
});
