import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Share, StyleSheet } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { parentsApi, reportsApi, studentsApi } from '../../services/api';
import { shareReportFile } from '../../services/reportShare';
import { durationLabel, singleReportFileName } from '../../services/studentReportNames';
import { todayString } from '../../services/attendanceEntry';
import {
  REPORT_PERIODS, RELATIONS, buildInvitePayload, buildOutcomePayload, buildReportRequest, inviteShareText, offeredOutcomes,
  reportPeriodParams, validateOutcome, webOnlyOutcomes, type ReportPeriod,
} from '../../services/studentLifecycle';
import { saveFailureMessage } from '../../services/errorKind';
import { accountErrorText, accountProblem, buildAccountPayload, emptyAccountForm, PASSWORD_MIN_LENGTH, type AccountForm } from '../../services/studentAccount';
import { staffLeaveErrorMessage } from '../../services/staffLeave';
import { useRemovalPreview } from '../../hooks/useStudents';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import { useToast } from '../ui/Toast';
import FormSheet from '../inventory/FormSheet';
import { StudentMoveSheet, StudentRemoveSheet } from './StudentMoveSheets';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Props {
  student: { id: number; name: string; roll?: string | number | null; className?: string | null; status?: string | null; has_user_account?: boolean; sectionId?: number | null };
}

type Open = 'status' | 'invite' | 'report' | 'move' | 'remove' | 'account' | null;

// Admin and principal actions on one student: mark Graduated or Repeat, make a parent invite code,
// and make the student report PDF. Leaving, transfer and re-admission go through a checklist that
// stays on the web.
export default function StudentAdminActions({ student }: Props) {
  const toast = useToast();
  const qc = useQueryClient();
  const year = useAcademicYear();
  const [open, setOpen] = useState<Open>(null);
  const [error, setError] = useState<string | null>(null);

  // status
  const preview = useRemovalPreview(student.id, open === 'status');
  const [outcome, setOutcome] = useState('');
  const [reason, setReason] = useState('');
  const setOutcomeMutation = useMutation({
    mutationFn: () => studentsApi.setOutcome(student.id, buildOutcomePayload(outcome, reason)),
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => ['students', 'student', 'student-edit', 'studentProfileSummary', 'studentEnrollmentHistory'].includes(q.queryKey[0] as string) });
    },
  });

  // invite
  const [relation, setRelation] = useState('FATHER');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const invite = useMutation({ mutationFn: async () => (await parentsApi.generateInvite(buildInvitePayload(student.id, relation, phone))).data as { invite_code?: string } });

  // login for the student
  const [account, setAccount] = useState<AccountForm>(emptyAccountForm(student.name));
  const setAcc = <K extends keyof AccountForm>(k: K, v: AccountForm[K]) => setAccount((a) => ({ ...a, [k]: v }));
  const createAccount = useMutation({
    mutationFn: () => studentsApi.createUserAccount(student.id, buildAccountPayload(account)),
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => ['students', 'student', 'student-edit', 'studentProfileSummary'].includes(q.queryKey[0] as string) });
    },
  });

  // report
  const [period, setPeriod] = useState<ReportPeriod>('this_month');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [reporting, setReporting] = useState(false);

  const close = () => { setOpen(null); setError(null); };

  const openSheet = (which: Exclude<Open, null>) => {
    setError(null);
    if (which === 'status') { setOutcome(''); setReason(''); }
    if (which === 'invite') { setRelation('FATHER'); setPhone(''); setCode(null); }
    if (which === 'report') { setPeriod('this_month'); setCustom({ from: '', to: '' }); }
    if (which === 'account') setAccount(emptyAccountForm(student.name));
    setOpen(which);
  };

  const saveStatus = async () => {
    const problem = validateOutcome(outcome, reason);
    if (problem) return setError(problem);
    setError(null);
    try {
      await setOutcomeMutation.mutateAsync();
      toast.success(outcome === 'GRADUATED' ? 'Marked as graduated.' : 'Marked as repeating.');
      close();
    } catch (e) { setError(staffLeaveErrorMessage(e, 'Could not change the status.')); }
  };

  const saveAccount = async () => {
    const problem = accountProblem(account);
    if (problem) return setError(problem);
    setError(null);
    try {
      await createAccount.mutateAsync();
      toast.success(`Login created for ${student.name}. Username: ${account.username.trim()}`);
      close();
    } catch (e) { setError(accountErrorText(e)); }
  };

  const makeInvite = async () => {
    setError(null);
    try {
      const res = await invite.mutateAsync();
      if (!res.invite_code) throw new Error('No code returned');
      setCode(res.invite_code);
    } catch (e) { setError(staffLeaveErrorMessage(e, 'Could not make the invite code.')); }
  };

  const shareInvite = async () => {
    if (!code) return;
    try { await Share.share({ message: inviteShareText(student.name, code) }); }
    catch { toast.error('Could not open the share sheet.'); }
  };

  const makeReport = async () => {
    const params = reportPeriodParams(period, todayString(), year.current?.id ?? null, custom);
    if ('error' in params) return setError(params.error as string);
    setError(null);
    setReporting(true);
    try {
      await shareReportFile(() => reportsApi.generateInstant(buildReportRequest(student.id, params)) as Promise<{ data: ArrayBuffer }>,
        singleReportFileName(
          { name: student.name, roll: student.roll, className: student.className }, durationLabel(params, year.current?.name),
        ), 'pdf');
      close();
    } catch (e) { setError(saveFailureMessage(e, (e as Error)?.message || 'Could not make the report.')); }
    finally { setReporting(false); }
  };

  const offered = offeredOutcomes(preview.data?.allowed_outcomes);
  const webOnly = webOnlyOutcomes(preview.data?.allowed_outcomes);

  return (
    <View>
      <View style={styles.row}>
        <Button title="Change status" size="sm" variant="outline" onPress={() => openSheet('status')} />
        <Button title="Student report" size="sm" variant="outline" onPress={() => openSheet('report')} />
        {!student.has_user_account ? <Button title="Parent invite" size="sm" variant="outline" onPress={() => openSheet('invite')} /> : null}
        {!student.has_user_account ? <Button title="Create login" size="sm" variant="outline" onPress={() => openSheet('account')} /> : null}
        <Button title="Change class" size="sm" variant="outline" onPress={() => openSheet('move')} />
        <Button title="Remove" size="sm" variant="danger" onPress={() => openSheet('remove')} />
      </View>

      <StudentMoveSheet visible={open === 'move'} onClose={close} student={student} currentSectionId={student.sectionId ?? null} />
      <StudentRemoveSheet visible={open === 'remove'} onClose={close} student={student} />

      <FormSheet visible={open === 'status'} title="Change status" onClose={close} onSubmit={saveStatus} submitLabel="Save status"
        busy={setOutcomeMutation.isPending} error={error}>
        {preview.isLoading ? <Text style={styles.hint}>Checking what is allowed...</Text> : null}
        {preview.isError ? <Text style={styles.hint}>Could not check what is allowed for this student.</Text> : null}
        {offered.map((o) => (
          <TouchableOpacity key={o.value} accessibilityRole="radio" accessibilityState={{ selected: outcome === o.value }} onPress={() => setOutcome(o.value)}
            style={[styles.option, outcome === o.value && styles.optionOn]}>
            <Text style={styles.optionTitle}>{o.label}</Text>
            <Text style={styles.optionHint}>{o.hint}</Text>
          </TouchableOpacity>
        ))}
        {preview.data && offered.length === 0 ? <Text style={styles.hint}>No status change can be made here for this student.</Text> : null}
        <Input label="Reason" value={reason} onChangeText={setReason} placeholder="Why is the status changing?" multiline style={styles.area} />
        {webOnly.length > 0 ? <Text style={styles.hint}>{webOnly.join(', ')}: use the web app, where the checklist (fees, library books, gate passes) is shown.</Text> : null}
      </FormSheet>

      <FormSheet visible={open === 'invite'} title="Parent invite" onClose={close} onSubmit={code ? shareInvite : makeInvite}
        submitLabel={code ? 'Share code' : 'Make invite code'} busy={invite.isPending} error={error}>
        {code ? (
          <>
            <Text style={styles.hint}>Give this one-time code to the parent so they can create their own login for {student.name}.</Text>
            <Text selectable style={styles.code}>{code}</Text>
          </>
        ) : (
          <>
            <Text style={styles.hint}>Makes a one-time code that links a parent or guardian login to {student.name}.</Text>
            <Select label="Relation to the student" value={relation} options={RELATIONS} onChange={(v) => setRelation(String(v))} />
            <Input label="Parent phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="03001234567" />
          </>
        )}
      </FormSheet>

      <FormSheet visible={open === 'account'} title="Create login" onClose={close} onSubmit={saveAccount} submitLabel="Create login" busy={createAccount.isPending} error={error}>
        <Text style={styles.hint}>A login for {student.name} to use the student app. Give them the username and password yourself; the password is not shown again.</Text>
        <Input label="Username *" value={account.username} onChangeText={(v) => setAcc('username', v)} autoCapitalize="none" autoCorrect={false} />
        <Input label="Email (optional)" value={account.email} onChangeText={(v) => setAcc('email', v)} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
        <Input label="Password *" value={account.password} onChangeText={(v) => setAcc('password', v)} secureTextEntry autoCapitalize="none" placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`} />
        <Input label="Confirm password *" value={account.confirm} onChangeText={(v) => setAcc('confirm', v)} secureTextEntry autoCapitalize="none" />
      </FormSheet>

      <FormSheet visible={open === 'report'} title="Student report" onClose={close} onSubmit={makeReport} submitLabel="Make PDF" busy={reporting} error={error}>
        <Text style={styles.hint}>A PDF with attendance, learning progress, skills, outstanding fees and remarks for the period. It opens in the share sheet.</Text>
        <Select label="Period" value={period} options={REPORT_PERIODS} onChange={(v) => setPeriod(v as ReportPeriod)} />
        {period === 'custom' ? (
          <>
            <DateField label="From" value={custom.from || null} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} />
            <DateField label="To" value={custom.to || null} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} />
          </>
        ) : null}
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary, marginVertical: Spacing.xs },
  option: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  optionOn: { borderColor: Colors.primary, backgroundColor: Colors.infoLight },
  optionTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  optionHint: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  area: { minHeight: 72, textAlignVertical: 'top' },
  code: { fontSize: FontSize.xxl, fontWeight: '800', letterSpacing: 2, color: Colors.primary, textAlign: 'center', paddingVertical: Spacing.lg },
});
