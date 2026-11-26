import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assistantApi } from '../../services/assistantApi';
import {
  formFromReply, languageOptions, preferencesError, preferencesPayload, type PreferencesForm, type PreferencesReply,
} from '../../services/assistantPreferences';
import Select from '../ui/Select';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { Colors, FontSize, Spacing } from '../../constants/colors';

const ASK_EACH_TIME = 0;

/** What Aura remembers about me: reply language, usual class, usual fee account (web PreferencesSheet). */
export default function PreferencesPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['assistantPreferences'], queryFn: async () => (await assistantApi.getPreferences()).data as PreferencesReply });
  const [form, setForm] = useState<PreferencesForm>(formFromReply(undefined));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (query.data) setForm(formFromReply(query.data)); }, [query.data]);
  const accounts = query.data?.accounts ?? [];

  const save = useMutation({
    mutationFn: () => assistantApi.updatePreferences(preferencesPayload(form, accounts.length > 0)),
    onSuccess: () => { setError(''); setSaved(true); qc.invalidateQueries({ queryKey: ['assistantPreferences'] }); },
    onError: (e) => { setSaved(false); setError(preferencesError(e)); },
  });
  const change = (next: Partial<PreferencesForm>) => { setSaved(false); setForm((f) => ({ ...f, ...next })); };

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.bar}>
        <Text style={styles.heading}>What Aura remembers</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to chat" onPress={onClose} hitSlop={8}><Text style={styles.link}>Back</Text></Pressable>
      </View>
      {query.isLoading ? <Text style={styles.note}>Loading…</Text> : null}
      {query.isError ? <Text accessibilityRole="alert" style={styles.err}>Could not load your preferences.</Text> : null}
      {query.data ? (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Select label="Reply language" value={form.language} options={languageOptions(query.data)} onChange={(v) => change({ language: String(v) })} />
          <Input label="My usual class (for example 5A)" value={form.defaultClass} maxLength={40} onChangeText={(t) => change({ defaultClass: t })} />
          {accounts.length > 0 ? (
            <Select label="Usual fee account" value={form.account ?? ASK_EACH_TIME}
              options={[{ value: ASK_EACH_TIME, label: 'Ask me each time' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
              onChange={(v) => change({ account: v === ASK_EACH_TIME ? null : Number(v) })} />
          ) : null}
          <Text style={styles.note}>Anything you say in a message wins over these. Leave a field empty to make Aura forget it.</Text>
          {error ? <Text accessibilityRole="alert" style={styles.err}>{error}</Text> : null}
          {saved ? <Text accessibilityRole="text" style={styles.ok}>Saved.</Text> : null}
          <Button title="Save" onPress={() => { setSaved(false); save.mutate(); }} loading={save.isPending} disabled={save.isPending} />
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border, backgroundColor: Colors.surface },
  heading: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  link: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  body: { padding: Spacing.lg, gap: Spacing.sm },
  note: { fontSize: FontSize.xs, color: Colors.textSecondary, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xs },
  err: { fontSize: FontSize.sm, color: Colors.error, paddingHorizontal: Spacing.lg },
  ok: { fontSize: FontSize.sm, color: Colors.success },
});
