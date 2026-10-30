import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useSchoolUserActions, useSchoolUsers } from '../../hooks/useSchoolUsers';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  activeToggleText, allowableRoles, buildResetPayload, buildUserPayload, canManageUser, emptyUserForm, FILTER_ROLES, filterUsers, fullName,
  roleLabel, userToForm, validateReset, validateUser, type ResetMode, type SchoolUser, type UserForm,
} from '../../services/schoolUsers';
import { inventoryErrorMessage } from '../../services/inventory';
import SearchBar from '../ui/SearchBar';
import Select from '../ui/Select';
import Input from '../ui/Input';
import Button from '../ui/Button';
import SegmentedTabs from '../ui/SegmentedTabs';
import QueryBoundary from '../ui/QueryBoundary';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Who can sign in to this school and in what role: add a user, change their name, email, phone or
// role, deactivate them, reset their password. Admin and principal only, and only for roles below
// their own, as on the web. A Super Admin manages users from the web (platform level).
export default function UsersScreen() {
  const toast = useToast();
  const { effectiveRole, isSuperAdmin } = useAuth();
  const allowed = useMemo(() => allowableRoles(effectiveRole, false), [effectiveRole]);
  const q = useSchoolUsers();
  const actions = useSchoolUserActions();
  const refreshControl = useRefreshControl(q.refetch);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [editing, setEditing] = useState<SchoolUser | 'new' | null>(null);
  const [form, setForm] = useState<UserForm>(emptyUserForm());
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<SchoolUser | null>(null);
  const [mode, setMode] = useState<ResetMode>('set');
  const [pw, setPw] = useState({ password: '', confirm: '' });
  const set = <K extends keyof UserForm>(k: K, v: UserForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const users = useMemo(() => filterUsers(q.data ?? [], search, role), [q.data, search, role]);

  if (isSuperAdmin || allowed.length === 0) {
    return <View style={styles.container}><Text style={styles.note}>Users are managed by the school admin or principal. A Super Admin manages them on the web.</Text></View>;
  }

  const open = (u: SchoolUser | 'new') => {
    setForm(u === 'new' ? emptyUserForm() : userToForm(u));
    setError(null);
    setEditing(u);
  };

  const save = async () => {
    const creating = editing === 'new';
    const problem = validateUser(form, creating, allowed);
    if (problem) return setError(problem);
    setError(null);
    try {
      const payload = buildUserPayload(form, creating);
      if (creating) await actions.create.mutateAsync(payload);
      else await actions.update.mutateAsync({ id: (editing as SchoolUser).id, data: payload });
      toast.success(creating ? 'User created.' : 'User updated.');
      setEditing(null);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  const toggleActive = async (u: SchoolUser) => {
    const t = activeToggleText(u, fullName(u));
    if (!(await confirm({ title: t.title, message: t.message, confirmLabel: t.confirmLabel, destructive: u.is_active }))) return;
    try {
      await actions.update.mutateAsync({ id: u.id, data: { is_active: !u.is_active } });
      toast.success(u.is_active ? 'User deactivated.' : 'User activated.');
      setEditing(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not change the user.'));
    }
  };

  const startReset = (u: SchoolUser) => {
    setEditing(null);
    setMode('set');
    setPw({ password: '', confirm: '' });
    setError(null);
    setResetting(u);
  };

  const submitReset = async () => {
    if (!resetting) return;
    const problem = validateReset(mode, pw.password, pw.confirm, resetting);
    if (problem) return setError(problem);
    setError(null);
    try {
      const r = await actions.reset.mutateAsync({ id: resetting.id, data: buildResetPayload(mode, pw.password, pw.confirm) });
      toast.success((r.data as { message?: string })?.message || (mode === 'email' ? 'Reset email sent.' : 'Password reset.'));
      setResetting(null);
    } catch (e) {
      setError(inventoryErrorMessage(e, 'Could not reset the password.'));
    }
  };

  const header = (
    <View style={styles.header}>
      <Button title="+ Add user" size="sm" onPress={() => open('new')} />
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search name, username or email" />
      <Select label="Role" value={role} onChange={(v) => setRole(String(v))} placeholder="All roles"
        options={[{ value: '', label: 'All roles' }, ...FILTER_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))]} />
    </View>
  );

  return (
    <View style={styles.container}>
      <QueryBoundary query={q} isEmpty={() => false}>
        {() => (
          <FlatList
            data={users}
            keyExtractor={(u) => String(u.id)}
            refreshControl={refreshControl}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
            ListHeaderComponent={header}
            ListEmptyComponent={<Text style={styles.note}>No users match.</Text>}
            renderItem={({ item: u }) => {
              const manageable = canManageUser(u, allowed);
              return (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${fullName(u)}, ${roleLabel(u.role)}${manageable ? '. Edit' : ''}`}
                  disabled={!manageable} style={styles.row} onPress={() => open(u)}>
                  <View style={styles.who}>
                    <Text style={styles.name} numberOfLines={1}>{fullName(u)}</Text>
                    <Text style={styles.sub} numberOfLines={1}>{[`@${u.username}`, u.email].filter(Boolean).join('  ·  ')}</Text>
                  </View>
                  <View style={styles.pills}>
                    <StatusPill label={roleLabel(u.role)} tone="info" />
                    {!u.is_active ? <StatusPill label="Inactive" tone="neutral" /> : null}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </QueryBoundary>

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New user' : 'Edit user'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.create.isPending || actions.update.isPending} error={error}>
        {editing === 'new' ? <Input label="Username" value={form.username} onChangeText={(v) => set('username', v)} autoCapitalize="none" autoCorrect={false} /> : null}
        <Input label="First name" value={form.firstName} onChangeText={(v) => set('firstName', v)} />
        <Input label="Last name" value={form.lastName} onChangeText={(v) => set('lastName', v)} />
        <Input label="Email" value={form.email} onChangeText={(v) => set('email', v)} keyboardType="email-address" autoCapitalize="none" />
        <Input label="Phone" value={form.phone} onChangeText={(v) => set('phone', v)} keyboardType="phone-pad" />
        <Select label="Role" value={form.role} onChange={(v) => set('role', String(v))} options={allowed.map((r) => ({ value: r, label: roleLabel(r) }))} />
        {editing === 'new' ? (
          <>
            <Input label="Password (8 or more characters)" value={form.password} onChangeText={(v) => set('password', v)} secureTextEntry autoCapitalize="none" />
            <Input label="Confirm password" value={form.confirm} onChangeText={(v) => set('confirm', v)} secureTextEntry autoCapitalize="none" />
          </>
        ) : editing ? (
          <>
            <Button title="Reset password" variant="outline" size="sm" onPress={() => startReset(editing)} />
            <Button title={editing.is_active ? 'Deactivate user' : 'Activate user'} variant={editing.is_active ? 'danger' : 'secondary'} size="sm" onPress={() => toggleActive(editing)} />
          </>
        ) : null}
      </FormSheet>

      <FormSheet visible={resetting !== null} title={resetting ? `Reset password: ${fullName(resetting)}` : ''} onClose={() => setResetting(null)} onSubmit={submitReset}
        submitLabel={mode === 'email' ? 'Send reset link' : 'Set password'} busy={actions.reset.isPending} error={error}>
        <SegmentedTabs tabs={[{ value: 'set', label: 'Set now' }, { value: 'email', label: 'Email a link' }]} value={mode} onChange={(m) => { setMode(m); setError(null); }} />
        {mode === 'set' ? (
          <>
            <Input label="New password (8 or more characters)" value={pw.password} onChangeText={(v) => setPw((p) => ({ ...p, password: v }))} secureTextEntry autoCapitalize="none" />
            <Input label="Confirm new password" value={pw.confirm} onChangeText={(v) => setPw((p) => ({ ...p, confirm: v }))} secureTextEntry autoCapitalize="none" />
          </>
        ) : <Text style={styles.sub}>{resetting?.email ? `A reset link is emailed to ${resetting.email}.` : 'This user has no email on file.'}</Text>}
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  header: { gap: Spacing.md, marginBottom: Spacing.sm },
  note: { padding: Spacing.lg, fontSize: FontSize.sm, color: Colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.md, minHeight: 56 },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  pills: { alignItems: 'flex-end', gap: Spacing.xs },
});
