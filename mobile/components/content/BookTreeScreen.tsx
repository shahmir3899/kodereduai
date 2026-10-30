import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useBookTree } from '../../hooks/useManager';
import { useCurriculumActions } from '../../hooks/useCurriculum';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { chaptersOf, type TreeChapter, type TreeTopic } from '../../services/manager';
import {
  buildChapterPayload, buildTopicPayload, emptyChapterForm, emptyTopicForm, nextNumber, validateChapter, validateTopic,
  type ChapterForm, type TopicForm,
} from '../../services/curriculum';
import { inventoryErrorMessage } from '../../services/inventory';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import TocScanSheet from './TocScanSheet';
import { Colors, FontSize, Spacing } from '../../constants/colors';

type TopicWithPages = TreeTopic & { page_start?: number | null; page_end?: number | null; content_kind?: string };
type ChapterWithPages = TreeChapter & { page_start?: number | null; page_end?: number | null };

// Chapters of a book with their topics, tap a chapter to expand. With `editable` (admin, principal,
// teacher and manager may change curriculum) chapters and topics can be added, edited and deleted,
// and a photographed contents page can be turned into chapters.
export default function BookTreeScreen({ editable = false }: { editable?: boolean }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookId = Number(id);
  const toast = useToast();
  const actions = useCurriculumActions();
  const query = useBookTree(bookId);
  const refreshControl = useRefreshControl(query.refetch);
  const [open, setOpen] = useState<number | null>(null);
  const [scan, setScan] = useState(false);

  const [chapterSheet, setChapterSheet] = useState<ChapterWithPages | 'new' | null>(null);
  const [chapterForm, setChapterForm] = useState<ChapterForm>(emptyChapterForm(1));
  const [topicSheet, setTopicSheet] = useState<{ chapter: ChapterWithPages; topic: TopicWithPages | null } | null>(null);
  const [topicForm, setTopicForm] = useState<TopicForm>(emptyTopicForm(1));
  const [error, setError] = useState<string | null>(null);

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const chapters = chaptersOf(query.data) as ChapterWithPages[];

  const openChapter = (c: ChapterWithPages | 'new') => {
    setError(null);
    setChapterForm(c === 'new'
      ? emptyChapterForm(nextNumber(chapters.map((x) => x.chapter_number)))
      : { title: c.title, number: String(c.chapter_number ?? 1), pageStart: c.page_start != null ? String(c.page_start) : '', pageEnd: c.page_end != null ? String(c.page_end) : '' });
    setChapterSheet(c);
  };

  const openTopic = (chapter: ChapterWithPages, topic: TopicWithPages | null) => {
    setError(null);
    setTopicForm(topic
      ? { title: topic.title, number: String(topic.topic_number ?? 1), pageStart: topic.page_start != null ? String(topic.page_start) : '', pageEnd: topic.page_end != null ? String(topic.page_end) : '', kind: topic.content_kind === 'exercise' ? 'exercise' : 'general' }
      : emptyTopicForm(nextNumber((chapter.topics ?? []).map((t) => t.topic_number))));
    setTopicSheet({ chapter, topic });
  };

  const saveChapter = async () => {
    const problem = validateChapter(chapterForm);
    if (problem) return setError(problem);
    setError(null);
    try {
      if (chapterSheet === 'new') await actions.createChapter.mutateAsync(buildChapterPayload(chapterForm, bookId));
      else await actions.updateChapter.mutateAsync({ id: (chapterSheet as ChapterWithPages).id, data: buildChapterPayload(chapterForm, null) });
      toast.success('Chapter saved.');
      setChapterSheet(null);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  const saveTopic = async () => {
    const problem = validateTopic(topicForm);
    if (problem || !topicSheet) return setError(problem);
    setError(null);
    try {
      if (topicSheet.topic) await actions.updateTopic.mutateAsync({ id: topicSheet.topic.id, data: buildTopicPayload(topicForm, null) });
      else await actions.createTopic.mutateAsync(buildTopicPayload(topicForm, topicSheet.chapter.id));
      toast.success('Topic saved.');
      setTopicSheet(null);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  const removeChapter = async (c: ChapterWithPages) => {
    if (!(await confirm({ title: 'Delete this chapter?', message: `${c.title} and its ${c.topics?.length ?? 0} topics. Lesson plans linked to them keep their text.`, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteChapter.mutateAsync(c.id);
      toast.success('Chapter deleted.');
      setChapterSheet(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete the chapter.'));
    }
  };

  const removeTopic = async (t: TopicWithPages) => {
    if (!(await confirm({ title: 'Delete this topic?', message: t.title, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteTopic.mutateAsync(t.id);
      toast.success('Topic deleted.');
      setTopicSheet(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete the topic.'));
    }
  };

  const toolbar = editable ? (
    <View style={styles.toolbar}>
      <Button title="+ Chapter" size="sm" onPress={() => openChapter('new')} />
      <Button title="Scan contents page" size="sm" variant="outline" onPress={() => setScan(true)} />
    </View>
  ) : null;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
        {toolbar}
        {chapters.length === 0 ? <EmptyState title="No chapters yet" message={editable ? 'Add a chapter, or scan the contents page.' : 'This book has no table of contents.'} /> : chapters.map((c) => {
          const topics = c.topics ?? [];
          const isOpen = open === c.id;
          return (
            <Card key={c.id} style={styles.card}>
              <TouchableOpacity accessibilityRole="button" onPress={() => setOpen(isOpen ? null : c.id)} style={styles.head}>
                <Text style={styles.chapter} numberOfLines={2}>{c.chapter_number != null ? `${c.chapter_number}. ` : ''}{c.title}</Text>
                <Text style={styles.count}>{topics.length} topic{topics.length === 1 ? '' : 's'}  {isOpen ? '▴' : '▾'}</Text>
              </TouchableOpacity>
              {isOpen ? (
                <View style={styles.topics}>
                  {topics.length === 0 ? <Text style={styles.muted}>No topics.</Text> : topics.map((t) => (
                    editable ? (
                      <TouchableOpacity key={t.id} accessibilityRole="button" style={styles.topicRow} onPress={() => openTopic(c, t as TopicWithPages)}>
                        <Text style={styles.topic}>{t.topic_number != null ? `${t.topic_number}  ` : ''}{t.title}</Text>
                      </TouchableOpacity>
                    ) : <Text key={t.id} style={styles.topic}>{t.topic_number != null ? `${t.topic_number}  ` : ''}{t.title}</Text>
                  ))}
                  {editable ? (
                    <View style={styles.toolbar}>
                      <Button title="+ Topic" size="sm" variant="ghost" onPress={() => openTopic(c, null)} />
                      <Button title="Edit chapter" size="sm" variant="ghost" onPress={() => openChapter(c)} />
                    </View>
                  ) : null}
                </View>
              ) : null}
            </Card>
          );
        })}
      </ScrollView>

      <FormSheet visible={chapterSheet !== null} title={chapterSheet === 'new' ? 'New chapter' : 'Edit chapter'} onClose={() => setChapterSheet(null)} onSubmit={saveChapter}
        submitLabel="Save" busy={actions.createChapter.isPending || actions.updateChapter.isPending} error={error}>
        <Input label="Title" value={chapterForm.title} onChangeText={(v) => setChapterForm((f) => ({ ...f, title: v }))} />
        <Input label="Chapter number" value={chapterForm.number} onChangeText={(v) => setChapterForm((f) => ({ ...f, number: v }))} keyboardType="number-pad" />
        <Input label="First page (optional)" value={chapterForm.pageStart} onChangeText={(v) => setChapterForm((f) => ({ ...f, pageStart: v }))} keyboardType="number-pad" />
        <Input label="Last page (optional)" value={chapterForm.pageEnd} onChangeText={(v) => setChapterForm((f) => ({ ...f, pageEnd: v }))} keyboardType="number-pad" />
        {chapterSheet && chapterSheet !== 'new' ? <Button title="Delete chapter" variant="danger" size="sm" onPress={() => removeChapter(chapterSheet)} /> : null}
      </FormSheet>

      <FormSheet visible={topicSheet !== null} title={topicSheet?.topic ? 'Edit topic' : 'New topic'} onClose={() => setTopicSheet(null)} onSubmit={saveTopic}
        submitLabel="Save" busy={actions.createTopic.isPending || actions.updateTopic.isPending} error={error}>
        <Input label="Title" value={topicForm.title} onChangeText={(v) => setTopicForm((f) => ({ ...f, title: v }))} />
        <Input label="Topic number" value={topicForm.number} onChangeText={(v) => setTopicForm((f) => ({ ...f, number: v }))} keyboardType="number-pad" />
        <Select label="Kind" value={topicForm.kind} onChange={(v) => setTopicForm((f) => ({ ...f, kind: v }))} options={[{ value: 'general', label: 'Lesson' }, { value: 'exercise', label: 'Exercise' }]} />
        <Input label="First page (optional)" value={topicForm.pageStart} onChangeText={(v) => setTopicForm((f) => ({ ...f, pageStart: v }))} keyboardType="number-pad" />
        <Input label="Last page (optional)" value={topicForm.pageEnd} onChangeText={(v) => setTopicForm((f) => ({ ...f, pageEnd: v }))} keyboardType="number-pad" />
        {topicSheet?.topic ? <Button title="Delete topic" variant="danger" size="sm" onPress={() => removeTopic(topicSheet.topic as TopicWithPages)} /> : null}
      </FormSheet>

      {editable ? <TocScanSheet bookId={bookId} visible={scan} onClose={() => setScan(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  toolbar: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap', marginBottom: Spacing.sm },
  card: { padding: Spacing.md, marginBottom: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  chapter: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  count: { fontSize: FontSize.xs, color: Colors.textSecondary },
  topics: { marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  topicRow: { minHeight: 44, justifyContent: 'center' },
  topic: { fontSize: FontSize.sm, color: Colors.text, paddingVertical: 3 },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
});
