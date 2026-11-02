import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useBlockRevisions, useContentBlocks, useCurriculumActions, useSubjectTags } from '../../hooks/useCurriculum';
import { useBookTree } from '../../hooks/useManager';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  BLOCK_TYPES, blockToForm, blockTypeLabel, buildBlockPayload, buildSubtopicPayload, emptyBlockForm, revisionLine, sortBlocks, subtopicToForm,
  validateBlock, validateSubtopic, type BlockForm, type BlockRevision, type ContentBlock, type Subtopic, type SubtopicForm,
} from '../../services/curriculumContent';
import { inventoryErrorMessage } from '../../services/inventory';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface TreeTopicFull { id: number; title: string; topic_number?: number; subtopics?: Subtopic[]; description?: string }
interface TreeData { subject?: number; chapters?: Array<{ id: number; title: string; topics?: TreeTopicFull[] }> }

// One topic's teaching content: its sub-topics (written text and minutes) and its content blocks (definitions,
// worked examples, exercises and so on) with history and tags. Port of the web Curriculum page's topic panel.
// With `editable` (admin, principal, teacher and manager) everything can be changed; others read it.
export default function TopicContentScreen({ editable = false }: { editable?: boolean }) {
  const { bookId, topicId } = useLocalSearchParams<{ bookId: string; topicId: string }>();
  const tid = Number(topicId) || null;
  const toast = useToast();
  const tree = useBookTree(Number(bookId));
  const blocks = useContentBlocks(tid);
  const actions = useCurriculumActions();
  const refreshControl = useRefreshControl(async () => { await Promise.all([tree.refetch(), blocks.refetch()]); });

  const data = tree.data as TreeData | undefined;
  const found = useMemo(() => {
    for (const c of data?.chapters ?? []) {
      const t = (c.topics ?? []).find((x) => x.id === tid);
      if (t) return { chapter: c, topic: t };
    }
    return null;
  }, [data, tid]);
  const list = sortBlocks(blocks.data ?? []);

  const [blockSheet, setBlockSheet] = useState<ContentBlock | 'new' | null>(null);
  const [blockForm, setBlockForm] = useState<BlockForm>(emptyBlockForm([]));
  const [showRich, setShowRich] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subSheet, setSubSheet] = useState<Subtopic | null>(null);
  const [subForm, setSubForm] = useState<SubtopicForm>({ contentText: '', minutes: '' });
  const [history, setHistory] = useState<ContentBlock | null>(null);
  const [tagging, setTagging] = useState<ContentBlock | null>(null);
  const set = <K extends keyof BlockForm>(k: K, v: BlockForm[K]) => setBlockForm((f) => ({ ...f, [k]: v }));

  const openBlock = (b: ContentBlock | 'new') => {
    const f = b === 'new' ? emptyBlockForm(list) : blockToForm(b);
    setBlockForm(f);
    setShowRich(!!f.rich);
    setError(null);
    setBlockSheet(b);
  };

  const saveBlock = async () => {
    const problem = validateBlock(blockForm);
    if (problem || !tid) return setError(problem ?? 'No topic.');
    setError(null);
    try {
      const payload = buildBlockPayload(blockForm, tid);
      if (blockSheet === 'new') await actions.createBlock.mutateAsync(payload);
      else await actions.updateBlock.mutateAsync({ id: (blockSheet as ContentBlock).id, data: payload });
      toast.success(blockSheet === 'new' ? 'Content block created.' : 'Content block updated.');
      setBlockSheet(null);
    } catch (e) {
      setError(inventoryErrorMessage(e, 'Could not save the content block.'));
    }
  };

  const removeBlock = async (b: ContentBlock) => {
    if (!(await confirm({ title: 'Delete content block?', message: `${blockTypeLabel(b.block_type)}: ${b.content_text.slice(0, 80)}`, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteBlock.mutateAsync(b.id);
      toast.success('Content block deleted.');
      setBlockSheet(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete the content block.'));
    }
  };

  const openSub = (s: Subtopic) => { setSubForm(subtopicToForm(s)); setError(null); setSubSheet(s); };
  const saveSub = async () => {
    const problem = validateSubtopic(subForm);
    if (problem || !subSheet) return setError(problem);
    setError(null);
    try {
      await actions.updateSubtopic.mutateAsync({ id: subSheet.id, data: buildSubtopicPayload(subForm) });
      toast.success('Sub-topic content updated.');
      setSubSheet(null);
    } catch (e) {
      setError(inventoryErrorMessage(e, 'Could not update the sub-topic.'));
    }
  };

  if (tree.isLoading) return <Skeleton />;
  if (tree.isError && !tree.data) return <ErrorState error={tree.error} onRetry={() => tree.refetch()} />;
  if (!found) return <EmptyState title="Topic not found" message="Open the topic from the book's chapter list." />;
  const { topic, chapter } = found;
  const subs = [...(topic.subtopics ?? [])].sort((a, b) => Number(a.subtopic_number ?? 0) - Number(b.subtopic_number ?? 0));

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{topic.topic_number != null ? `${topic.topic_number}  ` : ''}{topic.title}</Text>
        <Text style={styles.sub}>{chapter.title}</Text>
        {topic.description ? <Text style={styles.body}>{topic.description}</Text> : null}

        <View style={styles.sectionHead}>
          <Text style={styles.section}>Content blocks ({list.length})</Text>
          {editable ? <Button title="+ Add block" size="sm" onPress={() => openBlock('new')} /> : null}
        </View>
        {blocks.isLoading ? <Skeleton /> : blocks.isError ? <ErrorState error={blocks.error} onRetry={() => blocks.refetch()} /> : list.length === 0 ? (
          <EmptyState title="No content blocks" message={editable ? 'Add definitions, examples or exercises for this topic.' : 'Nothing has been written for this topic yet.'} />
        ) : list.map((b) => (
          <Card key={b.id} style={styles.card}>
            <View style={styles.head}>
              <StatusPill label={blockTypeLabel(b.block_type)} tone="info" />
              {b.is_ai_generated ? <StatusPill label="AI" tone="neutral" /> : null}
              <Text style={styles.sub}>#{b.sequence_order ?? 0}{b.difficulty_level != null ? `  ·  level ${b.difficulty_level}` : ''}{b.estimated_minutes != null ? `  ·  ${b.estimated_minutes} min` : ''}</Text>
            </View>
            <Text style={styles.body}>{b.content_text}</Text>
            {(b.tags ?? []).length > 0 ? (
              <View style={styles.tags}>{(b.tags ?? []).map((t) => <StatusPill key={t.id} label={t.name} tone="neutral" />)}</View>
            ) : null}
            {editable ? (
              <View style={styles.actions}>
                <Button title="Edit" size="sm" variant="outline" style={styles.action} onPress={() => openBlock(b)} />
                <Button title="History" size="sm" variant="outline" style={styles.action} onPress={() => setHistory(b)} />
                <Button title="Tags" size="sm" variant="outline" style={styles.action} onPress={() => setTagging(b)} />
              </View>
            ) : (
              <View style={styles.actions}><Button title="History" size="sm" variant="outline" style={styles.action} onPress={() => setHistory(b)} /></View>
            )}
          </Card>
        ))}

        <View style={styles.sectionHead}><Text style={styles.section}>Sub-topics ({subs.length})</Text></View>
        {subs.length === 0 ? <Text style={styles.sub}>This topic has no sub-topics.</Text> : subs.map((s) => (
          <Card key={s.id} style={styles.card}>
            <Text style={styles.name}>{s.subtopic_number != null ? `${s.subtopic_number}  ` : ''}{s.title}</Text>
            {s.estimated_minutes != null ? <Text style={styles.sub}>{s.estimated_minutes} min</Text> : null}
            {s.content_text ? <Text style={styles.body}>{s.content_text}</Text> : <Text style={styles.sub}>No content written yet.</Text>}
            {editable ? <Button title="Edit content" size="sm" variant="outline" onPress={() => openSub(s)} /> : null}
          </Card>
        ))}
      </ScrollView>

      <FormSheet visible={blockSheet !== null} title={blockSheet === 'new' ? 'New content block' : 'Edit content block'} onClose={() => setBlockSheet(null)} onSubmit={saveBlock}
        submitLabel="Save" busy={actions.createBlock.isPending || actions.updateBlock.isPending} error={error}>
        <Select label="Block type" value={blockForm.type} onChange={(v) => set('type', String(v))} options={BLOCK_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
        <Input label="Content" value={blockForm.text} onChangeText={(v) => set('text', v)} multiline style={styles.multiline} />
        <Input label="Order" value={blockForm.sequence} onChangeText={(v) => set('sequence', v)} keyboardType="number-pad" />
        <Input label="Difficulty (optional)" value={blockForm.difficulty} onChangeText={(v) => set('difficulty', v)} keyboardType="number-pad" />
        <Input label="Estimated minutes (optional)" value={blockForm.minutes} onChangeText={(v) => set('minutes', v)} keyboardType="number-pad" />
        {showRich ? <Input label="Rich content (JSON, advanced)" value={blockForm.rich} onChangeText={(v) => set('rich', v)} multiline style={styles.multiline} autoCapitalize="none" /> : (
          <Button title="Add rich content (advanced)" size="sm" variant="ghost" onPress={() => setShowRich(true)} />
        )}
        {blockSheet && blockSheet !== 'new' ? <Button title="Delete block" variant="danger" size="sm" onPress={() => removeBlock(blockSheet)} /> : null}
      </FormSheet>

      <FormSheet visible={subSheet !== null} title={subSheet ? `Sub-topic: ${subSheet.title}` : 'Sub-topic'} onClose={() => setSubSheet(null)} onSubmit={saveSub}
        submitLabel="Save" busy={actions.updateSubtopic.isPending} error={error}>
        <Input label="Content" value={subForm.contentText} onChangeText={(v) => setSubForm((f) => ({ ...f, contentText: v }))} multiline style={styles.multiline} />
        <Input label="Estimated minutes (optional)" value={subForm.minutes} onChangeText={(v) => setSubForm((f) => ({ ...f, minutes: v }))} keyboardType="number-pad" />
      </FormSheet>

      {history ? <HistorySheet block={history} editable={editable} onClose={() => setHistory(null)} /> : null}
      {tagging ? <TagSheet block={tagging} subjectId={data?.subject} onClose={() => setTagging(null)} /> : null}
    </>
  );
}

// Earlier versions of a block. Restoring one replaces the current text (the server keeps the replaced text as a revision).
function HistorySheet({ block, editable, onClose }: { block: ContentBlock; editable: boolean; onClose: () => void }) {
  const toast = useToast();
  const actions = useCurriculumActions();
  const q = useBlockRevisions(block.id);
  const [selected, setSelected] = useState<number | null>(null);
  const revisions = q.data ?? [];
  const current: BlockRevision | undefined = revisions.find((r) => r.id === (selected ?? revisions[0]?.id));

  const restore = async () => {
    if (!current) return;
    if (!(await confirm({ title: 'Restore revision', message: `Restore revision #${current.id}? Current content will be replaced.`, confirmLabel: 'Restore' }))) return;
    try {
      await actions.restoreRevision.mutateAsync({ id: block.id, revisionId: current.id });
      toast.success('Revision restored.');
      onClose();
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not restore the revision.'));
    }
  };

  return (
    <FormSheet visible title="Revision history" onClose={onClose} onSubmit={editable ? restore : onClose} submitLabel={editable ? 'Restore this revision' : 'Close'} busy={actions.restoreRevision.isPending}>
      {q.isLoading ? <Skeleton /> : q.isError ? <Text style={styles.problem}>Could not load the history.</Text> : revisions.length === 0 ? (
        <Text style={styles.sub}>This block has not been changed since it was created.</Text>
      ) : (
        <>
          {revisions.map((r) => (
            <TouchableOpacity key={r.id} accessibilityRole="button" accessibilityLabel={`Revision ${r.id}`} onPress={() => setSelected(r.id)} style={[styles.rev, current?.id === r.id && styles.revOn]}>
              <Text style={styles.name}>#{r.id}</Text>
              <Text style={styles.sub}>{revisionLine(r)}</Text>
            </TouchableOpacity>
          ))}
          {current ? <View style={styles.preview}><Text style={styles.sub}>Text of revision #{current.id}</Text><Text style={styles.body}>{current.content_text}</Text></View> : null}
        </>
      )}
    </FormSheet>
  );
}

// Link a block to one of the subject's tags, or unlink. Same call as the web (add_tag, with remove).
function TagSheet({ block, subjectId, onClose }: { block: ContentBlock; subjectId?: number; onClose: () => void }) {
  const toast = useToast();
  const actions = useCurriculumActions();
  const tags = useSubjectTags(subjectId);
  const [tagId, setTagId] = useState<number | null>(null);
  const add = async () => {
    if (!tagId) return;
    try {
      await actions.tagBlock.mutateAsync({ id: block.id, tagId });
      toast.success('Tag linked.');
      setTagId(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not link the tag.'));
    }
  };
  const remove = async (id: number) => {
    try {
      await actions.tagBlock.mutateAsync({ id: block.id, tagId: id, remove: true });
      toast.success('Tag removed.');
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not remove the tag.'));
    }
  };
  const linked = block.tags ?? [];
  return (
    <FormSheet visible title="Tags" onClose={onClose} onSubmit={add} submitLabel="Add tag" busy={actions.tagBlock.isPending}>
      {linked.length > 0 ? (
        <View style={styles.tags}>
          {linked.map((t) => (
            <TouchableOpacity key={t.id} accessibilityRole="button" accessibilityLabel={`Remove tag ${t.name}`} onPress={() => remove(t.id)} style={styles.tagChip}>
              <Text style={styles.tagText}>{t.name} ✕</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : <Text style={styles.sub}>No tags linked.</Text>}
      {tags.isLoading ? <Skeleton /> : (tags.data ?? []).length === 0 ? <Text style={styles.sub}>No tags found for this subject.</Text> : (
        <Select label="Tag" searchable value={tagId} onChange={(v) => setTagId(Number(v))} placeholder="Select tag…" options={(tags.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  body: { fontSize: FontSize.md, color: Colors.text },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.md },
  section: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  card: { padding: Spacing.md, gap: Spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  tagChip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: Spacing.md, borderRadius: BorderRadius.sm, backgroundColor: Colors.surfaceSecondary },
  tagText: { fontSize: FontSize.sm, color: Colors.text },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  action: { flex: 1 },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  problem: { fontSize: FontSize.sm, color: Colors.errorText },
  rev: { padding: Spacing.sm, borderRadius: BorderRadius.sm, backgroundColor: Colors.surfaceSecondary, borderWidth: 1, borderColor: 'transparent' },
  revOn: { borderColor: Colors.primary },
  preview: { gap: 4, padding: Spacing.sm, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.border },
});
