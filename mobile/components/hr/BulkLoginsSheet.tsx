import React, { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useBulkLogins, useStaffPicker } from '../../hooks/useHrAdmin';
import { allowableRoles, roleLabel } from '../../services/schoolUsers';
import {
  accountErrorText, buildBulkPayload, bulkLoginsSummary, emptyBulkForm, needsLogin, validateBulkLogins, type BulkLoginsForm, type BulkLoginsResult,
} from '../../services/staffAccounts';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Props { visible: boolean; onClose: () => void }

// Give several staff a login in one go: tick the staff without one, choose a role and one shared
// password. Usernames are made by the server from the names; each person should change the password
// after signing in. Admin and principal only.
export default function BulkLoginsSheet({ visible, onClose }: Props) {
  const toast = useToast();
  const { effectiveRole, isSuperAdmin } = useAuth();
  const allowed = useMemo(() => allowableRoles(effectiveRole, isSuperAdmin), [effectiveRole, isSuperAdmin]);
  const staff = useStaffPicker();
  const bulk = useBulkLogins();
  const waiting = useMemo(() => needsLogin(staff.data ?? []), [staff.data]);
  const [picked, setPicked] = useState<number[]>([]);
  const [form, setForm] = useState<BulkLoginsForm>(emptyBulkForm());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkLoginsResult | null>(null);

  useEffect(() => {
    if (visible) { setPicked([]); setError(null); setResult(null); setForm(emptyBulkForm(allowed.includes('TEACHER') ? 'TEACHER' : allowed[0] ?? '')); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const submit = async () => {
    if (result) return onClose();
    const problem = validateBulkLogins(picked, form, allowed);
    if (problem) return setError(problem);
    if (!(await confirm({ title: 'Create logins?', message: `${picked.length} staff member${picked.length === 1 ? '' : 's'} will get a ${roleLabel(form.role)} login with the shared password.`, confirmLabel: 'Create' }))) return;
    setError(null);
    try {
      const res = await bulk.mutateAsync(buildBulkPayload(picked, form));
      const data = res.data as BulkLoginsResult;
      setResult(data);
      toast.success(bulkLoginsSummary(data).headline);
    } catch (e) { setError(accountErrorText(e, 'Could not create the logins.')); }
  };

  const summary = result ? bulkLoginsSummary(result) : null;

  return (
    <FormSheet visible={visible} title="Create logins for several staff" onClose={onClose} onSubmit={submit} submitLabel={result ? 'Done' : `Create ${picked.length || ''} login${picked.length === 1 ? '' : 's'}`.replace('  ', ' ')} busy={bulk.isPending} error={error}>
      {summary ? (
        <>
          <Text style={styles.title}>{summary.headline}</Text>
          {summary.lines.map((l) => <Text key={l} style={styles.hint}>{l}</Text>)}
        </>
      ) : (
        <>
          <Select label="Role for all of them" value={form.role} onChange={(v) => setForm((f) => ({ ...f, role: String(v) }))} options={allowed.map((r) => ({ value: r, label: roleLabel(r) }))} />
          <Input label="Shared password (8 or more characters)" value={form.password} onChangeText={(v) => setForm((f) => ({ ...f, password: v }))} secureTextEntry autoCapitalize="none" />
          <Text style={styles.hint}>{staff.isLoading ? 'Loading staff...' : waiting.length === 0 ? 'Everyone already has a login.' : `${waiting.length} staff without a login. Tick the ones to create.`}</Text>
          {waiting.map((s) => (
            <TouchableOpacity key={s.id} accessibilityRole="checkbox" accessibilityState={{ checked: picked.includes(s.id) }} onPress={() => toggle(s.id)} style={styles.row}>
              <Text style={styles.tick}>{picked.includes(s.id) ? '☑' : '☐'}</Text>
              <Text style={styles.name}>{s.full_name}</Text>
            </TouchableOpacity>
          ))}
        </>
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 44, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md },
  tick: { fontSize: 22, color: Colors.primary },
  name: { fontSize: FontSize.md, color: Colors.text, flex: 1 },
});
