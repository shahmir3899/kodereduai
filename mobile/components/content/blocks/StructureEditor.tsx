import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Button from '../../ui/Button';
import Select from '../../ui/Select';
import { confirm } from '../../ui/confirm';
import TypePickerSheet from './TypePickerSheet';
import { useScopedQuery } from '../../../hooks/useScopedQuery';
import { examinationsApi } from '../../../services/api';
import {
  applyStructure, blockHasContent, blockSpec, freshStructureRows, isEarlyClass, newId, numberFromText, structureFromBlocks, structureLists,
  structureTotal, type Block, type Registry, type StructureRow, type StructureTemplate,
} from '../../../services/shared/blockDocument';
import type { DocKind } from '../../../services/blockPaper';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

interface Props {
  blocks: Block[];
  registry: Registry;
  kind?: DocKind;
  paperId: number;
  classId: number | null;
  subjectId: number | null;
  /** The paper's class: Play Group, Nursery and Prep see activity types first. */
  className?: string;
  readOnly: boolean;
  onApply: (blocks: Block[]) => void;
  onSkip: () => void;
}

// A number box that keeps what is typed and applies the limits when the teacher leaves it (demo findings A2).
function NumBox({ value, onCommit, min, max, integer, label, readOnly }: {
  value: number | undefined; onCommit: (v: number) => void; min: number; max: number; integer: boolean; label: string; readOnly: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <TextInput
      value={text ?? (value === undefined ? '' : String(value))} editable={!readOnly} keyboardType="number-pad" accessibilityLabel={label}
      onFocus={() => setText(value === undefined ? '' : String(value))}
      onChangeText={setText}
      onBlur={() => { onCommit(numberFromText(text ?? '', { min, max, integer, fallback: min }).value ?? min); setText(null); }}
      style={styles.num}
    />
  );
}

/**
 * Step 2 on the phone, as on the web (blocks/StructureEditor.jsx): the paper's questions, parts and marks first, made
 * at once with empty parts; the teacher then writes them on the paper (docs/PAPER_BUILDER_STRUCTURE_PLAN.md).
 */
export default function StructureEditor({ blocks, registry, kind = 'paper', paperId, classId, subjectId, className = '', readOnly, onApply, onSkip }: Props) {
  const [rows, setRows] = useState<StructureRow[]>(() => structureFromBlocks(blocks, registry));
  const [target, setTarget] = useState<number | undefined>(() => structureTotal(structureFromBlocks(blocks, registry)) || undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const templates = (registry.structure_templates as StructureTemplate[] | undefined) ?? [];
  const usedTypes = useMemo(() => rows.map((row) => row.type), [rows]);
  const papers = useScopedQuery<Array<{ id: number; paper_title?: string }>>('structurePapers', [classId, subjectId], async () => (
    ((await examinationsApi.getExamPapers({ class_obj: classId, subject: subjectId, page_size: 50 })).data as { results?: Array<{ id: number; paper_title?: string }> }).results ?? []
  ), { enabled: kind === 'paper' && !!classId && !!subjectId, staleTime: 60 * 1000 });
  const others = (papers.data ?? []).filter((p) => p.id !== paperId);

  const total = structureTotal(rows);
  const goal = target ?? 0;
  const status = goal ? (total === goal ? `${total} of ${goal}` : `${total} of ${goal}, ${goal > total ? `${goal - total} left` : `${total - goal} over`}`) : `${total} marks`;
  const setRow = (key: string, change: Partial<StructureRow>) => setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const move = (index: number, delta: number) => setRows((prev) => {
    const to = index + delta;
    if (to < 0 || to >= prev.length) return prev;
    const next = [...prev];
    [next[index], next[to]] = [next[to], next[index]];
    return next;
  });
  // A template or another paper replaces the rows only when nothing written would be lost; otherwise it is added.
  const takeRows = (incoming: Array<Partial<StructureRow>>) => {
    const fresh = freshStructureRows(incoming);
    const written = rows.some((row) => row.blockId);
    const next = written ? [...rows, ...fresh] : fresh;
    setRows(next);
    if (!written || !target) setTarget(structureTotal(next));
  };
  const copyFrom = async (id: number) => {
    try {
      const response = await examinationsApi.getPaperDocument(id);
      takeRows(structureFromBlocks((response.data as { document?: { blocks?: Block[] } })?.document?.blocks ?? [], registry));
    } catch {
      // The picker stays; trying again is one tap.
    }
  };
  const newRow = (type: string, list: StructureRow[]): StructureRow => {
    const spec = blockSpec(registry, type);
    const same = [...list].reverse().find((row) => row.type === type);
    const row: StructureRow = { key: newId(), type, marks: same ? same.marks : 5 };
    if (structureLists(spec).length) row.parts = same?.parts ?? 5;
    return row;
  };
  const addMany = (picked: Array<{ type: string; count: number }>) => setRows((prev) => picked.reduce((list, { type, count }) => {
    let next = list;
    for (let i = 0; i < count; i += 1) next = [...next, newRow(type, next)];
    return next;
  }, prev));
  const apply = async () => {
    const result = applyStructure(blocks, rows, registry, kind);
    const losing = result.removed.filter((block) => blockHasContent(block, registry)).length;
    if (losing && !(await confirm({
      title: 'Remove questions?',
      message: `${losing === 1 ? 'One question you already wrote is' : `${losing} questions you already wrote are`} not in the structure any more and will be removed.`,
      confirmLabel: 'Remove', destructive: true,
    }))) return;
    onApply(result.blocks);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Structure of the {kind === 'worksheet' ? 'worksheet' : 'paper'}</Text>
      <Text style={styles.sub}>Which questions, how many parts and marks. The questions are made at once; you write them on the paper next.</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Total marks</Text>
        <NumBox value={target} onCommit={(v) => setTarget(v || undefined)} min={0} max={1000} integer label="Total marks" readOnly={readOnly} />
        <Text style={[styles.sub, goal && total !== goal ? styles.warn : null]} accessibilityLiveRegion="polite">{status}</Text>
      </View>

      {!readOnly && (templates.length > 0 || others.length > 0) ? (
        <View style={styles.gap}>
          <Text style={styles.label}>Start from</Text>
          <View style={styles.chips}>
            {templates.map((t) => <Button key={t.id} title={t.label} size="sm" variant="outline" onPress={() => takeRows(t.rows)} />)}
          </View>
          {others.length > 0 ? (
            <Select hiddenLabel="Copy the structure of another paper" placeholder="Copy from a paper…" value={null}
              options={others.map((p) => ({ value: p.id, label: p.paper_title || `Paper ${p.id}` }))} onChange={(v) => copyFrom(Number(v))} />
          ) : null}
        </View>
      ) : null}

      {rows.length === 0 ? <Text style={styles.sub}>No questions yet. Add a row, or start from a template or another paper.</Text> : null}
      {rows.map((row, index) => {
        const spec = blockSpec(registry, row.type);
        const [list] = structureLists(spec);
        const choices = (spec?.fields ?? []).filter((field) => field.kind === 'choice' && !field.optional);
        return (
          <View key={row.key} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.qnum}>Q{index + 1}</Text>
              <Text style={[styles.title, styles.flex]} numberOfLines={2}>{spec?.label ?? row.type}{row.blockId ? '  · in the paper' : ''}</Text>
            </View>
            <View style={styles.row}>
              {list ? (
                <>
                  <Text style={styles.sub}>Parts</Text>
                  <NumBox value={row.parts} onCommit={(v) => setRow(row.key, { parts: v })} min={0} max={list.max ?? 60} integer label={`Question ${index + 1} parts`} readOnly={readOnly} />
                </>
              ) : null}
              <Text style={styles.sub}>Marks</Text>
              <NumBox value={row.marks} onCommit={(v) => setRow(row.key, { marks: v })} min={0} max={1000} integer={false} label={`Question ${index + 1} marks`} readOnly={readOnly} />
            </View>
            {choices.map((field) => (
              <Select key={field.name} hiddenLabel={`Question ${index + 1} ${field.label}`} disabled={readOnly}
                value={(row.data?.[field.name] as string | undefined) ?? (field.default as string | undefined) ?? field.choices?.[0]}
                options={(field.choices ?? []).map((c) => ({ value: c, label: field.labels?.[c] ?? c }))}
                onChange={(v) => setRow(row.key, { data: { ...(row.data ?? {}), [field.name]: v } })} />
            ))}
            {!readOnly ? (
              <View style={styles.actions}>
                <Tap label="↑" hint={`Move question ${index + 1} up`} disabled={index === 0} onPress={() => move(index, -1)} />
                <Tap label="↓" hint={`Move question ${index + 1} down`} disabled={index === rows.length - 1} onPress={() => move(index, 1)} />
                <Tap label="Remove" hint={`Remove question ${index + 1}`} danger onPress={() => setRows((prev) => prev.filter((r) => r.key !== row.key))} />
              </View>
            ) : null}
          </View>
        );
      })}

      {!readOnly ? (
        <>
          <Button title="+ Add questions" variant="outline" onPress={() => setPickerOpen(true)} />
          <Button title="Make the questions" onPress={apply} disabled={rows.length === 0 && blocks.length === 0} />
          <Button title="Skip, add questions one by one" variant="ghost" onPress={onSkip} />
        </>
      ) : null}
      <TypePickerSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} registry={registry} early={isEarlyClass(className)}
        used={usedTypes} layout={false} multiple onAddMany={addMany} />
    </View>
  );
}

function Tap({ label, hint, onPress, disabled, danger }: { label: string; hint: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={hint} disabled={disabled} onPress={onPress} style={styles.tap}>
      <Text style={[styles.tapText, danger && styles.danger, disabled && styles.off]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  gap: { gap: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  heading: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  title: { fontSize: FontSize.md, color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  warn: { color: Colors.warningText },
  qnum: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary, minWidth: 30 },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.sm, gap: Spacing.xs },
  num: { minWidth: 64, minHeight: 44, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.sm, fontSize: FontSize.md, color: Colors.text, backgroundColor: Colors.surface },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
  tap: { minWidth: 48, minHeight: 44, paddingHorizontal: Spacing.sm, alignItems: 'center', justifyContent: 'center' },
  tapText: { fontSize: FontSize.md, color: Colors.primary },
  danger: { color: Colors.errorText },
  off: { opacity: 0.3 },
});
