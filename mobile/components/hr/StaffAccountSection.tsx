import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useStaffAccountActions, useStaffPicker, useUserSearch } from '../../hooks/useHrAdmin';
import type { StaffRow } from '../../services/hrAdmin';
import { allowableRoles, roleLabel } from '../../services/schoolUsers';
import {
  accountErrorText, buildAccountPayload, candidateLabel, canSearchUsers, emptyAccountForm, linkCandidates, roleChangeProblem, roleChangeText,
  unlinkText, validateNewAccount, type NewAccountForm,
} from '../../services/staffAccounts';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const name = (m: Pick<StaffRow, 'first_name' | 'last_name'>) => `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || 'This staff member';

// The sign-in account of one staff member, on their profile: with an account, change its role or unlink
// it (the account itself is kept); without one, create it or link an existing user. Admin and principal
// only; the server refuses roles above the signed-in person's.
export default function StaffAccountSection({ member }: { member: StaffRow }) {
  const toast = useToast();
  const { effectiveRole, isSuperAdmin } = useAuth();
  const allowed = useMemo(() => allowableRoles(effectiveRole, isSuperAdmin), [effectiveRole, isSuperAdmin]);
  const actions = useStaffAccountActions();
  const [sheet, setSheet] = useState<'create' | 'link' | null>(null);
  const [form, setForm] = useState<NewAccountForm>(emptyAccountForm());
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string>(member.user_role ?? '');
  const [term, setTerm] = useState('');
  const [canFinance, setCanFinance] = useState<boolean>(!!member.user_can_manage_finance);
  // The role shown follows the saved one (it changes after a create, a link or a role change).
  useEffect(() => { setRole(member.user_role ?? ''); setCanFinance(!!member.user_can_manage_finance); }, [member.user_role, member.user, member.user_can_manage_finance]);
  const search = useUserSearch(term, sheet === 'link');
  const staff = useStaffPicker();
  const candidates = useMemo(() => linkCandidates(search.data ?? [], (staff.data ?? []).map((s) => s.user)), [search.data, staff.data]);

  if (allowed.length === 0) return null;
  const who = name(member);
  const hasAccount = !!member.user;

  const openCreate = () => { setForm(emptyAccountForm(member.first_name, member.last_name, allowed.includes('STAFF') ? 'STAFF' : allowed[allowed.length - 1])); setError(null); setSheet('create'); };
  const openLink = () => { setTerm(''); setError(null); setSheet('link'); };

  const create = async () => {
    const problem = validateNewAccount(form, allowed);
    if (problem) return setError(problem);
    setError(null);
    try {
      await actions.create.mutateAsync({ id: member.id, data: buildAccountPayload(form) });
      toast.success(`Login created: @${form.username.trim()}.`);
      setSheet(null);
    } catch (e) { setError(accountErrorText(e, 'Could not create the account.')); }
  };

  const link = async (id: number, label: string) => {
    if (!(await confirm({ title: 'Link this user?', message: `${label} will sign in as ${who}.`, confirmLabel: 'Link' }))) return;
    setError(null);
    try {
      await actions.link.mutateAsync({ id: member.id, userId: id });
      toast.success('User linked.');
      setSheet(null);
    } catch (e) { setError(accountErrorText(e, 'Could not link the user.')); }
  };

  const unlink = async () => {
    if (!(await confirm({ title: 'Unlink this account?', message: unlinkText(member.user_username ?? '', who), confirmLabel: 'Unlink', destructive: true }))) return;
    try {
      await actions.unlink.mutateAsync(member.id);
      toast.success('Account unlinked.');
    } catch (e) { toast.error(accountErrorText(e, 'Could not unlink the account.')); }
  };

  const changeRole = async () => {
    const problem = roleChangeProblem(member.user_role, role, allowed);
    if (problem) return toast.error(problem);
    if (!(await confirm({ title: 'Change the role?', message: roleChangeText(who, roleLabel(role)), confirmLabel: 'Change role' }))) return;
    try {
      await actions.role.mutateAsync({ id: member.id, role, canManageFinance: canFinance });
      toast.success('Role changed.');
    } catch (e) { toast.error(accountErrorText(e, 'Could not change the role.')); }
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.section}>Sign-in account</Text>
      {hasAccount ? (
        <>
          <Text style={styles.hint}>{`Signs in as @${member.user_username ?? ''}${member.user_role ? ` (${roleLabel(member.user_role)})` : ''}.`}</Text>
          <Select label="Role" value={role || null} onChange={(v) => setRole(String(v))} placeholder="Choose a role"
            options={[...new Set([...(member.user_role ? [member.user_role] : []), ...allowed])].map((r) => ({ value: r, label: roleLabel(r), }))} />
          {role === 'MANAGER' ? (
            <View style={styles.financeRow}>
              <Text style={styles.hint}>Can manage finance and fees</Text>
              <Switch value={canFinance} onValueChange={setCanFinance} accessibilityLabel="Can manage finance and fees" />
            </View>
          ) : null}
          <Button title="Change role" size="sm" variant="outline" onPress={changeRole} loading={actions.role.isPending}
            disabled={role === (member.user_role ?? '') && (role !== 'MANAGER' || canFinance === !!member.user_can_manage_finance)} />
          <Button title="Unlink account" size="sm" variant="danger" onPress={unlink} loading={actions.unlink.isPending} />
        </>
      ) : (
        <>
          <Text style={styles.hint}>This person cannot sign in yet.</Text>
          <Button title="Create a login" size="sm" onPress={openCreate} />
          <Button title="Link an existing user" size="sm" variant="outline" onPress={openLink} />
        </>
      )}

      <FormSheet visible={sheet === 'create'} title="Create a login" onClose={() => setSheet(null)} onSubmit={create} submitLabel="Create login" busy={actions.create.isPending} error={error}>
        <Text style={styles.hint}>For {who}.</Text>
        <Input label="Username" value={form.username} onChangeText={(v) => setForm((f) => ({ ...f, username: v }))} autoCapitalize="none" autoCorrect={false} />
        <Select label="Role" value={form.role} onChange={(v) => setForm((f) => ({ ...f, role: String(v) }))} options={allowed.map((r) => ({ value: r, label: roleLabel(r) }))} />
        {form.role === 'MANAGER' ? (
          <View style={styles.financeRow}>
            <Text style={styles.hint}>Can manage finance and fees</Text>
            <Switch value={form.canManageFinance} onValueChange={(v) => setForm((f) => ({ ...f, canManageFinance: v }))} accessibilityLabel="Can manage finance and fees" />
          </View>
        ) : null}
        <Input label="Password (8 or more characters)" value={form.password} onChangeText={(v) => setForm((f) => ({ ...f, password: v }))} secureTextEntry autoCapitalize="none" />
        <Input label="Confirm password" value={form.confirm} onChangeText={(v) => setForm((f) => ({ ...f, confirm: v }))} secureTextEntry autoCapitalize="none" />
      </FormSheet>

      <FormSheet visible={sheet === 'link'} title="Link an existing user" onClose={() => setSheet(null)} onSubmit={() => setSheet(null)} submitLabel="Close" error={error}>
        <Input label="Search users by name or username" value={term} onChangeText={setTerm} autoCapitalize="none" autoCorrect={false} />
        {!canSearchUsers(term) ? <Text style={styles.hint}>Type at least 2 letters.</Text> : null}
        {canSearchUsers(term) && search.isLoading ? <Text style={styles.hint}>Searching...</Text> : null}
        {canSearchUsers(term) && !search.isLoading && candidates.length === 0 ? <Text style={styles.hint}>No unlinked user matches.</Text> : null}
        {canSearchUsers(term) ? candidates.map((u) => (
          <TouchableOpacity key={u.id} accessibilityRole="button" style={styles.pick} onPress={() => link(u.id, candidateLabel(u))}>
            <Text style={styles.pickName}>{candidateLabel(u)}</Text>
            {u.role ? <Text style={styles.hint}>{roleLabel(u.role)}</Text> : null}
          </TouchableOpacity>
        )) : null}
      </FormSheet>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.md },
  section: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  financeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pick: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md },
  pickName: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
});
