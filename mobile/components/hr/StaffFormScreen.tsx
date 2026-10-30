import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Switch, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useDepartments, useDesignations, useHrActions, useNextEmployeeId, useStaffMember } from '../../hooks/useHrAdmin';
import {
  buildStaffPayload, designationsFor, EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES, emptyStaffForm, GENDERS, staffAccountRoles, staffHasLeft,
  staffToForm, validateStaff, withDepartment, withDesignation, type StaffForm,
} from '../../services/hrAdmin';
import { allowableRoles, roleLabel } from '../../services/schoolUsers';
import { inventoryErrorMessage } from '../../services/inventory';
import Input from '../ui/Input';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import Card from '../ui/Card';
import ErrorState from '../ui/ErrorState';
import Skeleton from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Add a staff member, or change one. A new member can get a sign-in account in the same step. Leaving
// is a deactivation, not a delete: the record, payslips and history stay, and Reactivate undoes it.
export default function StaffFormScreen({ id }: { id: number | null }) {
  const router = useRouter();
  const toast = useToast();
  const { effectiveRole } = useAuth();
  const creating = id == null;
  const member = useStaffMember(id);
  const nextId = useNextEmployeeId(creating);
  const departments = useDepartments();
  const designations = useDesignations();
  const actions = useHrActions();
  const accountRoles = useMemo(() => staffAccountRoles(allowableRoles(effectiveRole)), [effectiveRole]);
  const [form, setForm] = useState<StaffForm>(emptyStaffForm());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof StaffForm>(k: K, v: StaffForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Start from the saved record (or the next free employee id) once it arrives, and only once: a
  // refetch while typing must not wipe the form.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (seeded) return;
    if (!creating && member.data) { setForm(staffToForm(member.data)); setSeeded(true); }
    if (creating && nextId.data !== undefined) { setForm(emptyStaffForm(nextId.data)); setSeeded(true); }
  }, [seeded, creating, member.data, nextId.data]);

  const saving = actions.createStaff.isPending || actions.updateStaff.isPending;

  const submit = async () => {
    const problem = validateStaff(form, creating, accountRoles);
    if (problem) return setError(problem);
    setError(null);
    try {
      const payload = buildStaffPayload(form, creating);
      if (creating) await actions.createStaff.mutateAsync(payload);
      else await actions.updateStaff.mutateAsync({ id: id as number, data: payload });
      toast.success(creating ? 'Staff member added.' : 'Staff member updated.');
      router.back();
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  const toggleActive = async () => {
    if (!member.data) return;
    const leaving = !staffHasLeft(member.data);
    if (!(await confirm({
      title: leaving ? `Deactivate ${member.data.full_name}?` : `Reactivate ${member.data.full_name}?`,
      message: leaving ? 'They are marked as terminated and leave the working list. Their records and payslips are kept.' : 'They are marked active again.',
      confirmLabel: leaving ? 'Deactivate' : 'Reactivate', destructive: leaving,
    }))) return;
    try {
      await (leaving ? actions.deactivateStaff : actions.reactivateStaff).mutateAsync(id as number);
      toast.success(leaving ? 'Staff member deactivated.' : 'Staff member reactivated.');
      router.back();
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not change the staff member.'));
    }
  };

  if (!creating && member.isLoading) return <Skeleton />;
  if (!creating && member.isError) return <ErrorState error={member.error} onRetry={() => member.refetch()} />;

  const deptOptions = (departments.data ?? []).filter((d) => d.is_active || d.id === form.department).map((d) => ({ value: d.id, label: d.name }));
  const desigOptions = designationsFor((designations.data ?? []).filter((d) => d.is_active || d.id === form.designation), form.department).map((d) => ({ value: d.id, label: d.name }));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card style={styles.card}>
        <Text style={styles.section}>Personal</Text>
        <Input label="First name" value={form.firstName} onChangeText={(v) => set('firstName', v)} />
        <Input label="Last name" value={form.lastName} onChangeText={(v) => set('lastName', v)} />
        <Select label="Gender" value={form.gender} onChange={(v) => set('gender', String(v))} placeholder="Not set" options={[{ value: '', label: 'Not set' }, ...GENDERS]} />
        <DateField label="Date of birth" value={form.dob} onChange={(v) => set('dob', v)} maximumDate={new Date()} />
        <Input label="Phone" value={form.phone} onChangeText={(v) => set('phone', v)} keyboardType="phone-pad" />
        <Input label="Email" value={form.email} onChangeText={(v) => set('email', v)} keyboardType="email-address" autoCapitalize="none" />
        <Input label="Address" value={form.address} onChangeText={(v) => set('address', v)} multiline />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.section}>Job</Text>
        <Input label="Employee ID" value={form.employeeId} onChangeText={(v) => set('employeeId', v)} autoCapitalize="characters" />
        <Select<string | number> label="Department" searchable value={form.department} onChange={(v) => setForm((f) => withDepartment(f, v === '' ? null : Number(v)))} placeholder="Not set"
          options={[{ value: '', label: 'Not set' }, ...deptOptions]} />
        <Select<string | number> label="Designation" searchable value={form.designation}
          onChange={(v) => setForm((f) => withDesignation(f, v === '' ? null : Number(v), designations.data ?? []))} placeholder="Not set"
          options={[{ value: '', label: 'Not set' }, ...desigOptions]} />
        <Select label="Employment type" value={form.employmentType} onChange={(v) => set('employmentType', String(v))} options={EMPLOYMENT_TYPES} />
        <Select label="Status" value={form.employmentStatus} onChange={(v) => set('employmentStatus', String(v))} options={EMPLOYMENT_STATUSES} />
        <DateField label="Date of joining" value={form.joined} onChange={(v) => set('joined', v)} />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.section}>Emergency contact</Text>
        <Input label="Name" value={form.emergencyName} onChangeText={(v) => set('emergencyName', v)} />
        <Input label="Phone" value={form.emergencyPhone} onChangeText={(v) => set('emergencyPhone', v)} keyboardType="phone-pad" />
        <Input label="Notes" value={form.notes} onChangeText={(v) => set('notes', v)} multiline />
      </Card>

      {creating && accountRoles.length > 0 ? (
        <Card style={styles.card}>
          <View style={styles.toggle}>
            <View style={styles.flex}>
              <Text style={styles.section}>Sign-in account</Text>
              <Text style={styles.hint}>Let this person sign in to the app.</Text>
            </View>
            <Switch value={form.createAccount} onValueChange={(v) => set('createAccount', v)} accessibilityLabel="Create a sign-in account" />
          </View>
          {form.createAccount ? (
            <>
              <Input label="Username" value={form.username} onChangeText={(v) => set('username', v)} autoCapitalize="none" autoCorrect={false} />
              <Select label="Role" value={form.userRole} onChange={(v) => set('userRole', String(v))} options={accountRoles.map((r) => ({ value: r, label: roleLabel(r) }))} />
              <Input label="Password (8 or more characters)" value={form.password} onChangeText={(v) => set('password', v)} secureTextEntry autoCapitalize="none" />
              <Input label="Confirm password" value={form.confirm} onChangeText={(v) => set('confirm', v)} secureTextEntry autoCapitalize="none" />
            </>
          ) : null}
        </Card>
      ) : null}

      {!creating && member.data?.user_username ? <Text style={styles.hint}>{`Signs in as @${member.data.user_username}${member.data.user_role ? ` (${roleLabel(member.data.user_role)})` : ''}. Change roles under Settings, Users and roles.`}</Text> : null}

      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <Button title={creating ? 'Add staff member' : 'Save changes'} onPress={submit} loading={saving} disabled={saving || !seeded} />
      {!creating && member.data ? (
        <Button title={staffHasLeft(member.data) ? 'Reactivate' : 'Deactivate'} variant={staffHasLeft(member.data) ? 'secondary' : 'danger'} onPress={toggleActive} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  card: { gap: Spacing.md },
  section: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  flex: { flex: 1 },
  error: { color: Colors.error, fontSize: FontSize.sm },
});
