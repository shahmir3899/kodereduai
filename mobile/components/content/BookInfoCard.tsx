import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useContentSearch, useCurriculumActions, useSyllabusProgress } from '../../hooks/useCurriculum';
import {
  blockTypeLabel, BOOK_LANGUAGES, bookToEditForm, buildBookEditPayload, progressForBook, progressPercent, validateBookEdit,
  type BookDetail, type BookEditForm,
} from '../../services/curriculumContent';
import { inventoryErrorMessage } from '../../services/inventory';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Spinner from '../ui/Spinner';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// The book at the top of its chapter list: details, how much of the syllabus has been taught (published
// lesson plans), search across the book's content, and with `editable` edit or delete the book.
export default function BookInfoCard({ book, editable }: { book: BookDetail; editable: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const { activeSchool } = useAuth();
  const actions = useCurriculumActions();
  const progress = useSyllabusProgress(book.class_obj, book.subject);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<BookEditForm>(bookToEditForm(book));
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const set = <K extends keyof BookEditForm>(k: K, v: BookEditForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const mine = progressForBook(progress.data, book.id);
  const bar = mine ?? (progress.data ? { total_topics: progress.data.total_topics, covered_topics: progress.data.covered_topics, percentage: progress.data.percentage ?? 0 } : null);
  const pct = bar ? progressPercent(bar) : 0;

  const save = async () => {
    const problem = validateBookEdit(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      await actions.updateBook.mutateAsync({ id: book.id, data: buildBookEditPayload(form, activeSchool?.id) });
      toast.success('Book updated.');
      setEditing(false);
    } catch (e) {
      setError(inventoryErrorMessage(e, 'Could not update the book.'));
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Delete book', message: `Delete "${book.title}"? This action cannot be undone.`, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteBook.mutateAsync(book.id);
      toast.success('Book deleted.');
      setEditing(false);
      router.back();
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete the book.'));
    }
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{book.title}</Text>
      <Text style={styles.sub}>{[book.class_name, book.subject_name, book.author, book.publisher, book.edition].filter(Boolean).join('  ·  ')}</Text>
      {bar && bar.total_topics > 0 ? (
        <View style={styles.progress}>
          <Text style={styles.sub}>{bar.covered_topics} of {bar.total_topics} topics taught ({pct}%)</Text>
          <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, pct)}%` }]} /></View>
        </View>
      ) : null}
      <View style={styles.row}>
        <Button title="Search content" size="sm" variant="outline" onPress={() => setSearching(true)} />
        {editable ? <Button title="Edit book" size="sm" variant="outline" onPress={() => { setForm(bookToEditForm(book)); setError(null); setEditing(true); }} /> : null}
      </View>

      <FormSheet visible={editing} title="Edit book" onClose={() => setEditing(false)} onSubmit={save} submitLabel="Save" busy={actions.updateBook.isPending} error={error}>
        <Input label="Title" value={form.title} onChangeText={(v) => set('title', v)} />
        <Input label="Author (optional)" value={form.author} onChangeText={(v) => set('author', v)} />
        <Input label="Publisher (optional)" value={form.publisher} onChangeText={(v) => set('publisher', v)} />
        <Input label="Edition (optional)" value={form.edition} onChangeText={(v) => set('edition', v)} />
        <Select label="Language" value={form.language} onChange={(v) => set('language', String(v))} options={BOOK_LANGUAGES.map((l) => ({ value: l.value, label: l.label }))} />
        <Input label="Description (optional)" value={form.description} onChangeText={(v) => set('description', v)} multiline />
        <Button title="Delete book" variant="danger" size="sm" onPress={remove} />
      </FormSheet>

      <ContentSearchSheet visible={searching} onClose={() => setSearching(false)} classId={book.class_obj} subjectId={book.subject} />
    </Card>
  );
}

// Meaning-based search over the book's class and subject: type a question or a phrase, the server ranks the
// content blocks by how close they are in meaning (the web waits 600 ms after the last key).
function ContentSearchSheet({ visible, onClose, classId, subjectId }: { visible: boolean; onClose: () => void; classId?: number | null; subjectId?: number | null }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 600);
    return () => clearTimeout(t);
  }, [text]);
  const hits = useContentSearch(q, classId, subjectId);
  const list = hits.data ?? [];
  return (
    <FormSheet visible={visible} title="Search content" onClose={onClose} onSubmit={onClose} submitLabel="Close">
      <TextInput value={text} onChangeText={setText} placeholder="Search by meaning, e.g. photosynthesis" style={styles.input} accessibilityLabel="Search content" autoCorrect={false} />
      {!q ? <Text style={styles.sub}>Finds content blocks about the same idea, even when the words differ.</Text> : null}
      {q && hits.isFetching ? <Spinner /> : null}
      {q && !hits.isFetching && hits.isError ? <Text style={styles.problem}>Search is not available right now.</Text> : null}
      {q && !hits.isFetching && !hits.isError && list.length === 0 ? <Text style={styles.sub}>Nothing found for this subject.</Text> : null}
      {list.map((h) => (
        <View key={h.id} style={styles.hit}>
          <View style={styles.hitHead}><StatusPill label={blockTypeLabel(h.block_type)} tone="info" /></View>
          {h.hierarchy_path ? <Text style={styles.path} numberOfLines={2}>{h.hierarchy_path}</Text> : null}
          <Text style={styles.text} numberOfLines={5}>{h.content_text}</Text>
        </View>
      ))}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.md, marginBottom: Spacing.sm, gap: Spacing.xs },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  progress: { gap: 4, marginTop: Spacing.xs },
  track: { height: 8, borderRadius: 4, backgroundColor: Colors.surfaceSecondary, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: Colors.success },
  row: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm, flexWrap: 'wrap' },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, padding: Spacing.md, fontSize: FontSize.md, color: Colors.text, backgroundColor: Colors.surface },
  problem: { fontSize: FontSize.sm, color: Colors.errorText },
  hit: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.sm, gap: 4 },
  hitHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  path: { fontSize: FontSize.xs, color: Colors.textSecondary },
  text: { fontSize: FontSize.sm, color: Colors.text },
});
