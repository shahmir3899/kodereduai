import React, { useState } from 'react';
import { View, Text, ScrollView, Share, TouchableOpacity, StyleSheet } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { parentsApi } from '../../services/api';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { RELATIONS, buildInvitePayload, inviteShareText } from '../../services/studentLifecycle';
import {
  buildLinkPayload, linkableParentOptions, linkedParentsOf, parentName, toggleId,
  type Invite, type ParentEntry, type SiblingSuggestion,
} from '../../services/parentLinks';
import { staffLeaveErrorMessage } from '../../services/staffLeave';
import BottomSheet from '../ui/BottomSheet';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const ROOTS = ['parentLinks', 'parentInvites', 'siblingSuggestions', 'students', 'student'];

// Admin and principal: who is linked to this student, link an existing parent (the same parent can be
// linked to every sibling), tick likely siblings, or make an invite code for a parent with no login yet.
export default function ParentLinksSheet({ visible, onClose, student }: { visible: boolean; onClose: () => void; student: { id: number; name: string } }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [parentId, setParentId] = useState<number | null>(null);
  const [relation, setRelation] = useState('FATHER');
  const [invRelation, setInvRelation] = useState('FATHER');
  const [invPhone, setInvPhone] = useState('');
  const [ticked, setTicked] = useState<number[]>([]);

  const parents = useScopedQuery('parentLinks', [], async () => ((await parentsApi.getParentsList()).data ?? []) as ParentEntry[], { enabled: visible, staleTime: 0 });
  const invites = useScopedQuery('parentInvites', [student.id], async () => ((await parentsApi.getStudentInvites(student.id)).data ?? []) as Invite[], { enabled: visible, staleTime: 0 });
  const entries = parents.data ?? [];
  const linked = linkedParentsOf(entries, student.id);
  const options = linkableParentOptions(entries, student.id);
  const first = linked[0];

  const suggestions = useScopedQuery('siblingSuggestions', [student.id, first?.parent.id], async () =>
    ((await parentsApi.getSiblingSuggestions({ student_id: student.id, parent_profile_id: first!.parent.id })).data ?? []) as SiblingSuggestion[],
    { enabled: visible && !!first, staleTime: 0 });

  const refresh = () => qc.invalidateQueries({ predicate: (q) => ROOTS.includes(q.queryKey[0] as string) });
  const run = async (work: () => Promise<unknown>, done: string, fail: string) => {
    setError(null);
    try { await work(); toast.success(done); refresh(); return true; }
    catch (e) { setError(staffLeaveErrorMessage(e, fail)); return false; }
  };

  const link = useMutation({ mutationFn: (v: { parent: number; students: number[]; relation: string }) => parentsApi.linkChildren(buildLinkPayload(v.parent, v.students, v.relation)) });
  const unlink = useMutation({ mutationFn: (linkId: number) => parentsApi.unlinkChild(linkId) });
  const makeInvite = useMutation({ mutationFn: () => parentsApi.generateInvite(buildInvitePayload(student.id, invRelation, invPhone)) });
  const revoke = useMutation({ mutationFn: (id: number) => parentsApi.revokeInvite(id) });

  const linkExisting = async () => {
    if (!parentId) return setError('Choose a parent to link.');
    if (await run(() => link.mutateAsync({ parent: parentId, students: [student.id], relation }), 'Parent linked.', 'Could not link the parent.')) setParentId(null);
  };
  const linkSiblings = async () => {
    if (!first || ticked.length === 0) return;
    if (await run(() => link.mutateAsync({ parent: first.parent.id, students: ticked, relation: first.link.relation }), 'Siblings linked.', 'Could not link the siblings.')) setTicked([]);
  };
  const share = async (code: string) => {
    try { await Share.share({ message: inviteShareText(student.name, code) }); }
    catch { toast.error('Could not open the share sheet.'); }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={`Parents of ${student.name}`}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Linked parents</Text>
        {parents.isLoading ? <Text style={styles.hint}>Loading...</Text> : null}
        {!parents.isLoading && linked.length === 0 ? <Text style={styles.hint}>No parent is linked to this student yet.</Text> : null}
        {linked.map((x) => (
          <View key={x.link.link_id} style={styles.row}>
            <View style={styles.grow}>
              <Text style={styles.name}>{parentName(x.parent)}{x.link.is_primary ? '  ★' : ''}</Text>
              <Text style={styles.hint}>{RELATIONS.find((r) => r.value === x.link.relation)?.label ?? x.link.relation}{x.parent.phone ? ` · ${x.parent.phone}` : ''}</Text>
            </View>
            <Button title="Unlink" size="sm" variant="outline" disabled={unlink.isPending}
              onPress={() => run(() => unlink.mutateAsync(x.link.link_id), 'Parent unlinked.', 'Could not unlink.')} />
          </View>
        ))}

        {(suggestions.data ?? []).length > 0 ? (
          <View style={styles.suggest}>
            <Text style={styles.name}>Possible siblings (same guardian name and phone)</Text>
            {(suggestions.data ?? []).map((s) => (
              <TouchableOpacity key={s.student_id} accessibilityRole="checkbox" accessibilityState={{ checked: ticked.includes(s.student_id) }}
                onPress={() => setTicked((t) => toggleId(t, s.student_id))} style={styles.tick}>
                <Text style={styles.tickBox}>{ticked.includes(s.student_id) ? '☑' : '☐'}</Text>
                <Text style={styles.hint}>{s.student_name}{s.class_name ? ` (${s.class_name})` : ''}</Text>
              </TouchableOpacity>
            ))}
            <Button title={`Link ${ticked.length || ''} to ${first ? parentName(first.parent) : ''}`.replace('  ', ' ')} size="sm"
              disabled={ticked.length === 0 || link.isPending} onPress={linkSiblings} />
          </View>
        ) : null}

        <Text style={styles.heading}>Link an existing parent</Text>
        <Select label="Parent" value={parentId} options={options} onChange={(v) => setParentId(Number(v))} placeholder="Choose a parent" />
        <Select label="Relation to the student" value={relation} options={RELATIONS} onChange={(v) => setRelation(String(v))} />
        <Button title="Link parent" variant="outline" disabled={!parentId || link.isPending} loading={link.isPending} onPress={linkExisting} />
        <Text style={styles.hint}>A parent with several children: open each child and link the same parent.</Text>

        <Text style={styles.heading}>Parent has no login yet?</Text>
        <Select label="Relation to the student" value={invRelation} options={RELATIONS} onChange={(v) => setInvRelation(String(v))} />
        <Input label="Parent phone (optional)" value={invPhone} onChangeText={setInvPhone} keyboardType="phone-pad" placeholder="03001234567" />
        <Button title="Make invite code" variant="outline" loading={makeInvite.isPending} disabled={makeInvite.isPending}
          onPress={async () => { if (await run(() => makeInvite.mutateAsync(), 'Invite code made.', 'Could not make the invite code.')) setInvPhone(''); }} />
        {(invites.data ?? []).map((inv) => (
          <View key={inv.id} style={styles.row}>
            <Text selectable style={[styles.code, styles.grow]}>{inv.invite_code}</Text>
            <Button title="Share" size="sm" variant="outline" onPress={() => share(inv.invite_code)} />
            <Button title="Revoke" size="sm" variant="danger" onPress={() => run(() => revoke.mutateAsync(inv.id), 'Invite revoked.', 'Could not revoke.')} />
          </View>
        ))}

        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        <Button title="Done" onPress={onClose} />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.sm },
  heading: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', marginTop: Spacing.md },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  name: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  grow: { flex: 1 },
  suggest: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.xs, backgroundColor: Colors.infoLight },
  tick: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  tickBox: { fontSize: FontSize.lg, color: Colors.primary },
  code: { fontSize: FontSize.lg, fontWeight: '800', letterSpacing: 1, color: Colors.primary },
  error: { color: Colors.error, fontSize: FontSize.sm, marginVertical: Spacing.xs },
});
