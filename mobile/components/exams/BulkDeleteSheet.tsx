import React, { useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { BULK_DELETE_WORD, bulkDeleteText, bulkDeleteTyped } from '../../services/examsAdmin';
import Input from '../ui/Input';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize } from '../../constants/colors';

interface Props {
  visible: boolean;
  kind: 'exam' | 'group';
  count: number;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

// Deleting exams also deletes the marks entered on them, so a tap is not enough: the word is typed.
export default function BulkDeleteSheet({ visible, kind, count, busy, error, onClose, onConfirm }: Props) {
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { if (visible) { setTyped(''); setProblem(null); } }, [visible]);

  const submit = () => {
    if (!bulkDeleteTyped(typed)) return setProblem(`Type ${BULK_DELETE_WORD} to confirm.`);
    setProblem(null);
    onConfirm();
  };

  return (
    <FormSheet visible={visible} title={kind === 'group' ? 'Delete exam groups' : 'Delete exams'} onClose={onClose} onSubmit={submit}
      submitLabel={`Delete ${count}`} busy={busy} error={problem ?? error}>
      <Text style={styles.warn}>{bulkDeleteText(kind, count)}</Text>
      <Input label={`Type ${BULK_DELETE_WORD} to confirm`} value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} />
    </FormSheet>
  );
}

const styles = StyleSheet.create({ warn: { fontSize: FontSize.sm, color: Colors.error } });
