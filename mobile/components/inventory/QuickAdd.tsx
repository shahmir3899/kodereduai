import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { inventoryErrorMessage } from '../../services/inventory';
import { Colors, FontSize, Spacing } from '../../constants/colors';

interface QuickAddProps {
  noun: 'category' | 'vendor';
  // Resolves with the new record's id so the form can select it.
  onCreate: (name: string) => Promise<number | undefined>;
}

// "+ New category" / "+ New vendor" inside a form: one name field, no separate management screen.
export default function QuickAdd({ noun, onCreate }: QuickAddProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <TouchableOpacity accessibilityRole="button" onPress={() => setOpen(true)} style={styles.toggle}>
        <Text style={styles.toggleText}>+ New {noun}</Text>
      </TouchableOpacity>
    );
  }

  const save = async () => {
    if (!name.trim()) {
      setError(`Enter the ${noun} name.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim());
      setName('');
      setOpen(false);
    } catch (e) {
      setError(inventoryErrorMessage(e, `Could not add the ${noun}.`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box}>
      <Input label={`New ${noun} name`} value={name} onChangeText={setName} autoFocus error={error ?? undefined} />
      <View style={styles.row}>
        <Button title="Add" size="sm" onPress={save} loading={busy} disabled={busy} />
        <Button title="Cancel" size="sm" variant="ghost" onPress={() => { setOpen(false); setError(null); }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { minHeight: 44, justifyContent: 'center' },
  toggleText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '600' },
  box: { marginBottom: Spacing.sm },
  row: { flexDirection: 'row', gap: Spacing.sm },
});
