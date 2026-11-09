import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, FontSize, Spacing } from '../../constants/colors';

export function whenLabel(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((now - d.getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString();
}

/** Past conversations: pinned first, then newest. Opening one replaces the chat; deleting asks once. */
export default function HistoryList({ query, currentId, onOpen, onPin, onDelete, onClose }: {
  query: { data?: any[]; isLoading: boolean; isError: boolean };
  currentId: number | null; onOpen: (id: number) => void; onPin: (id: number, pinned: boolean) => Promise<void>; onDelete: (id: number) => Promise<void>; onClose: () => void;
}) {
  const [confirming, setConfirming] = useState<number | null>(null);
  const [failed, setFailed] = useState('');
  const rows = [...(query.data || [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.last_active).getTime() - new Date(a.last_active).getTime());

  const run = async (fn: () => Promise<void>) => {
    setFailed('');
    try { await fn(); } catch { setFailed('That did not work. Please try again.'); }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.bar}>
        <Text style={styles.heading}>Past conversations</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to chat" onPress={onClose} hitSlop={8}><Text style={styles.link}>Back</Text></Pressable>
      </View>
      {failed ? <Text accessibilityRole="alert" style={styles.err}>{failed}</Text> : null}
      {query.isLoading ? <Text style={styles.note}>Loading…</Text> : null}
      {query.isError ? <Text accessibilityRole="alert" style={styles.err}>Could not load your conversations.</Text> : null}
      {!query.isLoading && !query.isError && rows.length === 0 ? <Text style={styles.note}>Nothing here yet. Your conversations appear after you ask Aura something.</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(c) => String(c.id)}
        renderItem={({ item: c }) => (
          <View style={[styles.item, c.id === currentId && { backgroundColor: Colors.surfaceSecondary }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Open ${c.title || 'conversation'}`} onPress={() => onOpen(c.id)} style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.title}>{c.title || 'New conversation'}</Text>
              <Text style={styles.note}>{whenLabel(c.last_active)}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: !!c.pinned }} accessibilityLabel={c.pinned ? `Unpin ${c.title || 'conversation'}` : `Pin ${c.title || 'conversation'}`} onPress={() => run(() => onPin(c.id, !c.pinned))} hitSlop={8}>
              <Text style={styles.link}>{c.pinned ? 'Pinned' : 'Pin'}</Text>
            </Pressable>
            {confirming === c.id ? (
              <View style={styles.confirm}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Confirm delete ${c.title || 'conversation'}`} onPress={() => { setConfirming(null); run(() => onDelete(c.id)); }} hitSlop={8}><Text style={[styles.link, { color: Colors.error }]}>Delete</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Keep conversation" onPress={() => setConfirming(null)} hitSlop={8}><Text style={styles.link}>Keep</Text></Pressable>
              </View>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${c.title || 'conversation'}`} onPress={() => setConfirming(c.id)} hitSlop={8}><Text style={styles.note}>Delete</Text></Pressable>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  heading: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  item: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  title: { fontSize: FontSize.md, color: Colors.text },
  note: { fontSize: FontSize.xs, color: Colors.textSecondary, padding: 2 },
  link: { fontSize: FontSize.sm, color: Colors.primary },
  err: { fontSize: FontSize.sm, color: Colors.errorText, padding: Spacing.md },
  confirm: { flexDirection: 'row', gap: Spacing.md },
});
