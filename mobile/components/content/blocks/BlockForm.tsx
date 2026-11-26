import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import Input from '../../ui/Input';
import Select from '../../ui/Select';
import Button from '../../ui/Button';
import FormSheet from '../../inventory/FormSheet';
import RichTextField from '../RichTextField';
import PicturePickerSheet from './PicturePickerSheet';
import { usePictureLookups } from '../../../hooks/useBlockPaper';
import { blockSpec, countingList, isDefaultTitle, isQuestionBlock, newListItem, splitListText, type Block, type FieldSpec, type PictureRef, type Registry, withMarks } from '../../../services/shared/blockDocument';
import { describePicture } from '../../../services/shared/pictureRefs';
import {
  fieldControl, fieldLabel, letterRowsToText, listItemLabel, listSingular, moveItem, numberFromInput, richSummary, setBlockData, textToLetterRows, thumbUrl, withKey,
} from '../../../services/blockPaper';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

// The form for one block, built from the field list the server sends (GET paper-blocks/), as the web's
// blocks/BlockForm.jsx is: a new block type on the server needs no change here. Rich text opens one editor at a
// time in a sheet, because a block with many parts would otherwise need a WebView for each.

type Dir = 'ltr' | 'rtl';

function PictureField({ value, onChange, optional, readOnly }: { value: PictureRef | undefined; onChange: (v: PictureRef | undefined) => void; optional?: boolean; readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const lookups = usePictureLookups();
  const shown = describePicture(value, lookups);
  const uri = thumbUrl(shown?.image);
  return (
    <View style={styles.row}>
      <View style={styles.pictureBox}>
        {uri ? <Image source={{ uri }} style={styles.pictureImg} contentFit="contain" /> : <Text style={styles.tiny}>{value ? 'drawn' : 'none'}</Text>}
      </View>
      <View style={styles.flex}>
        <Text style={styles.text} numberOfLines={2}>{shown?.label || 'No picture'}</Text>
        {!readOnly ? (
          <View style={styles.row}>
            <Button title={value ? 'Change' : 'Choose'} size="sm" variant="outline" onPress={() => setOpen(true)} />
            {optional && value ? <Button title="Remove" size="sm" variant="ghost" onPress={() => onChange(undefined)} /> : null}
          </View>
        ) : null}
      </View>
      <PicturePickerSheet visible={open} onClose={() => setOpen(false)} onPick={onChange} />
    </View>
  );
}

function RichField({ label, value, onChange, readOnly, direction }: { label: string; value: string; onChange: (v: string) => void; readOnly: boolean; direction: Dir }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const summary = richSummary(value);
  return (
    <>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Edit ${label}`} disabled={readOnly} style={styles.richBox}
        onPress={() => { setDraft(value); setOpen(true); }}>
        <Text style={[styles.text, !summary && styles.placeholder]} numberOfLines={3}>{summary || (readOnly ? '—' : `Tap to write ${label.toLowerCase()}`)}</Text>
      </TouchableOpacity>
      <FormSheet visible={open} title={label} onClose={() => setOpen(false)} submitLabel="Done" onSubmit={() => { onChange(draft); setOpen(false); }}
        secondaryLabel="Cancel" onSecondary={() => setOpen(false)}>
        {open ? <RichTextField value={draft} onChange={setDraft} placeholder={label} defaultLanguage={direction === 'rtl' ? 'ur' : 'en'} /> : null}
      </FormSheet>
    </>
  );
}

function TextList({ field, value, onChange, readOnly }: { field: FieldSpec; value: unknown; onChange: (v: string[]) => void; readOnly: boolean }) {
  const entries = Array.isArray(value) ? value.map(String) : [];
  const max = field.max ?? 60;
  const inputs = useRef<Array<TextInput | null>>([]);
  const focusNext = useRef<number | null>(null);
  const [all, setAll] = useState('');
  const [upTo, setUpTo] = useState('10');
  const [gap, setGap] = useState('2');
  // "+ Add" and the keyboard's next key put the cursor in the new box (demo findings B2).
  const add = () => {
    if (entries.length >= max) return;
    focusNext.current = entries.length;
    onChange([...entries, '']);
  };
  useEffect(() => {
    if (focusNext.current === null) return;
    inputs.current[focusNext.current]?.focus();
    focusNext.current = null;
  });
  // One line for the whole list instead of a tap per box (demo findings B1).
  const fillAll = () => {
    if (!all.trim()) return;
    onChange(splitListText(all, max));
    setAll('');
  };
  return (
    <View>
      <View style={styles.chips}>
        {entries.map((entry, index) => (
          // eslint-disable-next-line react/no-array-index-key -- plain strings, often repeated
          <View key={index} style={styles.chip}>
            <TextInput ref={(el) => { inputs.current[index] = el; }} value={entry} editable={!readOnly} placeholder="empty"
              accessibilityLabel={`${field.label} ${index + 1}`} style={styles.chipInput} returnKeyType="next" blurOnSubmit={false}
              onSubmitEditing={() => (index === entries.length - 1 ? add() : inputs.current[index + 1]?.focus())}
              onChangeText={(t) => onChange(entries.map((e, i) => (i === index ? t : e)))} />
            {!readOnly ? (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove ${field.label} ${index + 1}`} style={styles.chipX} onPress={() => onChange(entries.filter((_, i) => i !== index))}>
                <Text style={styles.danger}>×</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
      </View>
      {!readOnly && entries.length < max ? <Button title="+ Add" size="sm" variant="ghost" onPress={add} /> : null}
      {!readOnly ? (
        <View style={styles.row}>
          <TextInput value={all} onChangeText={setAll} placeholder="Or type them all: 1, , 3, , 5" accessibilityLabel={`${field.label}: type them all`}
            style={[styles.box, { flex: 1 }]} returnKeyType="done" onSubmitEditing={fillAll} />
          <Button title="Fill" size="sm" variant="outline" onPress={fillAll} disabled={!all.trim()} />
        </View>
      ) : null}
      {!readOnly && field.counting ? (
        // 10 clouds took ten "+ Add" taps and five typed boxes (demo findings, faster 1).
        <View style={styles.row}>
          <Text style={styles.text}>Count 1 to</Text>
          <TextInput value={upTo} onChangeText={setUpTo} keyboardType="number-pad" accessibilityLabel={`${field.label}: count up to`}
            style={[styles.box, { width: 52 }]} />
          <Text style={styles.text}>, a box empty every</Text>
          <TextInput value={gap} onChangeText={setGap} keyboardType="number-pad" accessibilityLabel={`${field.label}: leave a box empty every`}
            style={[styles.box, { width: 44 }]} />
          <Button title="Fill" size="sm" variant="outline" onPress={() => onChange(countingList(upTo, gap, max))} disabled={!(Number(upTo) >= 1)} />
        </View>
      ) : null}
    </View>
  );
}

function LetterRows({ value, onChange, readOnly }: { value: unknown; onChange: (v: string[][]) => void; readOnly: boolean }) {
  const [text, setText] = useState(() => letterRowsToText(value));
  return (
    <View>
      <TextInput value={text} onChangeText={setText} onBlur={() => onChange(textToLetterRows(text))} editable={!readOnly} multiline
        accessibilityLabel="Letter rows" style={[styles.box, styles.multi]} />
      <Text style={styles.help}>One row per line, letters separated by spaces.</Text>
    </View>
  );
}

function ListField({ field, value, onChange, readOnly, depth, direction }: { field: FieldSpec; value: unknown; onChange: (v: unknown[]) => void; readOnly: boolean; depth: number; direction: Dir }) {
  const items = (Array.isArray(value) ? value : []) as Array<Record<string, any>>;
  const max = field.max ?? 60;
  const min = field.min ?? 0;
  const update = (index: number, next: Record<string, any>) => onChange(items.map((item, i) => (i === index ? next : item)));
  // A row that needs a picture is added only once its picture is chosen (demo findings A5).
  const pictureSub = (field.fields ?? []).find((sub) => sub.kind === 'picture' && !sub.optional);
  const [pickingNew, setPickingNew] = useState(false);
  const addItem = (picture?: PictureRef) => onChange([...items, { ...newListItem(field), ...(pictureSub ? { [pictureSub.name]: picture } : {}) }]);
  return (
    <View style={styles.gap}>
      {items.map((item, index) => (
        <View key={item?.key ?? index} style={[styles.item, depth > 0 && styles.itemInner]}>
          <View style={styles.itemHead}>
            <Text style={styles.itemLabel}>{listItemLabel(field, index)}</Text>
            {!readOnly ? (
              <View style={styles.row}>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Move ${listItemLabel(field, index)} up`} disabled={index === 0} style={styles.iconBtn} onPress={() => onChange(moveItem(items, index, -1))}>
                  <Text style={[styles.icon, index === 0 && styles.off]}>↑</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Move ${listItemLabel(field, index)} down`} disabled={index === items.length - 1} style={styles.iconBtn} onPress={() => onChange(moveItem(items, index, 1))}>
                  <Text style={[styles.icon, index === items.length - 1 && styles.off]}>↓</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove ${listItemLabel(field, index)}`} disabled={items.length <= min} style={styles.iconBtn} onPress={() => onChange(items.filter((_, i) => i !== index))}>
                  <Text style={[styles.danger, items.length <= min && styles.off]}>Remove</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
          {(field.fields ?? []).map((sub) => (
            <FieldInput key={sub.name} field={sub} value={item?.[sub.name]} readOnly={readOnly} depth={depth + 1} direction={direction}
              onChange={(next) => update(index, withKey(item, sub.name, next))} />
          ))}
        </View>
      ))}
      {!readOnly && items.length < max ? <Button title={`+ Add ${listSingular(field)}`} size="sm" variant="outline" onPress={() => (pictureSub ? setPickingNew(true) : addItem())} /> : null}
      {pictureSub ? <PicturePickerSheet visible={pickingNew} onClose={() => setPickingNew(false)} onPick={(ref) => { setPickingNew(false); addItem(ref); }} /> : null}
    </View>
  );
}

export function FieldInput({ field, value, onChange, readOnly, depth = 0, direction }: {
  field: FieldSpec; value: any; onChange: (v: any) => void; readOnly: boolean; depth?: number; direction: Dir;
}) {
  const label = fieldLabel(field);
  const control = fieldControl(field);
  if (control === 'bool') {
    return (
      <View style={styles.row}>
        <Text style={[styles.label, styles.flex]}>{field.label}</Text>
        <Switch value={Boolean(value)} onValueChange={onChange} disabled={readOnly} accessibilityLabel={field.label} />
      </View>
    );
  }
  let body: React.ReactNode;
  switch (control) {
    case 'richtext':
      body = <RichField label={field.label} value={String(value ?? '')} onChange={onChange} readOnly={readOnly} direction={direction} />;
      break;
    case 'text':
      body = <TextInput value={value ?? ''} onChangeText={onChange} editable={!readOnly} maxLength={field.max_length} accessibilityLabel={label} style={styles.box} />;
      break;
    case 'number':
      body = <NumberBox field={field} value={value} onChange={onChange} readOnly={readOnly} label={label} />;
      break;
    case 'choice':
      return (
        <Select label={label} value={value ?? ''} disabled={readOnly} onChange={(v) => onChange(v === '' ? undefined : v)}
          options={[...(field.optional ? [{ value: '', label: '—' }] : []), ...(field.choices ?? []).map((c) => ({ value: c, label: field.labels?.[c] ?? c }))]} />
      );
    case 'picture':
      body = <PictureField value={value} onChange={onChange} optional={field.optional} readOnly={readOnly} />;
      break;
    case 'text_list':
      body = <TextList field={field} value={value} onChange={onChange} readOnly={readOnly} />;
      break;
    case 'letter_rows':
      body = <LetterRows value={value} onChange={onChange} readOnly={readOnly} />;
      break;
    case 'list':
      body = <ListField field={field} value={value} onChange={onChange} readOnly={readOnly} depth={depth} direction={direction} />;
      break;
    default:
      body = <Text style={styles.help}>Unsupported field “{field.kind}”: edit it on the website.</Text>;
  }
  return (
    <View style={styles.field}>
      <Text style={depth ? styles.labelSmall : styles.label}>{label}</Text>
      {field.help ? <Text style={styles.help}>{field.help}</Text> : null}
      {body}
    </View>
  );
}

// Typed text is kept while typing ("1." or an empty box), and the number is sent on each change.
function NumberBox({ field, value, onChange, readOnly, label }: { field: FieldSpec; value: any; onChange: (v: any) => void; readOnly: boolean; label: string }) {
  const [text, setText] = useState(value === undefined || value === null ? '' : String(value));
  return (
    <TextInput value={text} editable={!readOnly} keyboardType="decimal-pad" accessibilityLabel={label} style={[styles.box, styles.narrow]}
      onChangeText={(t) => { setText(t); onChange(numberFromInput(t, field)); }} />
  );
}

/** Title, marks and the block's own fields. */
export default function BlockForm({ block, registry, onChange, readOnly, problems, direction, optionalMarks = false }: {
  block: Block | null; registry: Registry | null; onChange: (b: Block) => void; readOnly: boolean; problems: string[]; direction: Dir;
  /** A worksheet: an empty marks box means no marks, not 0. */
  optionalMarks?: boolean;
}) {
  const spec = blockSpec(registry, block?.type);
  if (!block || !spec) return <Text style={styles.help}>Choose a question in the Questions tab to edit it.</Text>;
  const question = isQuestionBlock(block, registry);
  return (
    <View style={styles.gap}>
      <Text style={styles.kind}>{spec.label}</Text>
      {problems.length > 0 ? (
        <View style={styles.problems} accessibilityRole="alert">
          {problems.map((p) => <Text key={p} style={styles.problemText}>• {p}</Text>)}
        </View>
      ) : null}
      {/* A generic heading ("Count and write.") is selected on tap, so typing replaces it (demo findings, faster 6). */}
      <Input label={question ? 'Question heading' : 'Heading'} value={block.title ?? ''} editable={!readOnly} selectTextOnFocus={isDefaultTitle(block)}
        onChangeText={(t) => onChange({ ...block, title: t })} />
      {question ? (
        <View style={styles.field}>
          <Text style={styles.label}>{optionalMarks ? 'Marks (optional)' : 'Marks'}</Text>
          <NumberBox field={{ name: 'marks', label: 'Marks', kind: 'number', min: 0 }} value={block.marks} readOnly={readOnly} label="Marks"
            onChange={(v) => onChange(withMarks(block, v ?? '', optionalMarks))} />
        </View>
      ) : null}
      {spec.fields.map((field) => (
        <FieldInput key={field.name} field={field} value={block.data?.[field.name]} readOnly={readOnly} direction={direction}
          onChange={(v) => onChange(setBlockData(block, field.name, v))} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: Spacing.sm },
  field: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap' },
  flex: { flex: 1 },
  kind: { fontSize: FontSize.xs, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  labelSmall: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary },
  help: { fontSize: FontSize.xs, color: Colors.textSecondary },
  text: { fontSize: FontSize.md, color: Colors.text },
  placeholder: { color: Colors.textTertiary },
  tiny: { fontSize: FontSize.xxs, color: Colors.textTertiary },
  box: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 8, fontSize: FontSize.md, color: Colors.text, backgroundColor: Colors.surface, minHeight: 44 },
  narrow: { maxWidth: 140 },
  multi: { minHeight: 96, textAlignVertical: 'top' },
  richBox: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, padding: Spacing.sm, minHeight: 44, backgroundColor: Colors.surface, justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, backgroundColor: Colors.surface },
  chipInput: { minWidth: 56, paddingHorizontal: 8, paddingVertical: 6, fontSize: FontSize.md, color: Colors.text },
  chipX: { minWidth: 36, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  item: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, padding: Spacing.sm, gap: Spacing.xs, backgroundColor: Colors.surfaceSecondary },
  itemInner: { backgroundColor: Colors.surface },
  itemHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemLabel: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary },
  iconBtn: { minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: FontSize.lg, color: Colors.primary },
  off: { opacity: 0.3 },
  danger: { color: Colors.error, fontSize: FontSize.sm },
  pictureBox: { width: 64, height: 56, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface, overflow: 'hidden' },
  pictureImg: { width: '100%', height: '100%' },
  problems: { backgroundColor: Colors.errorLight, borderRadius: BorderRadius.sm, padding: Spacing.sm, gap: 2 },
  problemText: { color: Colors.errorText ?? Colors.error, fontSize: FontSize.sm },
});
