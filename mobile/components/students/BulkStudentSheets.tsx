import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reportsApi, studentsApi } from '../../services/api';
import { todayString } from '../../services/attendanceEntry';
import {
  REPORT_PERIODS, buildReportRequest, reportPeriodParams, type ReportPeriod,
} from '../../services/studentLifecycle';
import { durationLabel, reportsZipFileName, singleReportFileName, uniqueNames } from '../../services/studentReportNames';
import { buildBulkZip, needsConfirm, type BulkResult, type BulkStudent } from '../../services/bulkReportCards';
import { shareFileBytes } from '../../services/reportShare';
import {
  accountsErrorText, bulkAccountsConfirmText, bulkAccountsResultText, bulkPasswordProblem, buildBulkAccountsPayload,
  studentReportsProgress, studentReportsResultText, type BulkAccountsResult,
} from '../../services/studentBulk';
import { PASSWORD_MIN_LENGTH } from '../../services/studentAccount';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import BottomSheet from '../ui/BottomSheet';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import { confirm } from '../ui/confirm';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Logins for the chosen students, all with one starting password (as the web does). The password is
// never shown again; the result lists the usernames that were made.
export function BulkAccountsSheet({ visible, onClose, ids, skipped, onDone }: {
  visible: boolean; onClose: () => void; ids: number[]; skipped: number; onDone: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkAccountsResult | null>(null);
  useEffect(() => { if (visible) { setPassword(''); setError(null); setResult(null); } }, [visible]);

  const create = useMutation({
    mutationFn: async () => (await studentsApi.bulkCreateAccounts(buildBulkAccountsPayload(ids, password))).data as BulkAccountsResult,
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => ['students', 'student', 'student-edit', 'studentProfileSummary'].includes(q.queryKey[0] as string) });
    },
  });

  const run = async () => {
    const problem = bulkPasswordProblem(password);
    if (problem) return setError(problem);
    setError(null);
    const ok = await confirm({ title: 'Create these logins?', message: bulkAccountsConfirmText(ids.length, skipped), confirmLabel: 'Create' });
    if (!ok) return;
    try {
      const res = await create.mutateAsync();
      setResult(res);
      setPassword('');
      toast.success(bulkAccountsResultText(res));
      onDone();
    } catch (e) { setError(accountsErrorText(e)); }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Create logins">
      <View style={styles.body}>
        {result ? (
          <>
            <Text style={styles.line}>{bulkAccountsResultText(result)}</Text>
            {(result.created ?? []).map((c, i) => (
              <View key={`${c.username}-${i}`} style={styles.row}>
                <Text style={styles.name} numberOfLines={1}>{c.student_name}</Text>
                <Text style={styles.mono}>{c.username}</Text>
              </View>
            ))}
            {(result.errors ?? []).map((e, i) => <Text key={i} style={styles.err}>{e.name}: {e.error}</Text>)}
            <Text style={styles.hint}>Give each student their username and the starting password. They can change it after they sign in.</Text>
            <Button title="Done" onPress={onClose} />
          </>
        ) : (
          <>
            <Text style={styles.line}>{ids.length} student{ids.length === 1 ? '' : 's'}</Text>
            <Text style={styles.hint}>Usernames are made from the students' names. Everyone gets the same starting password, so choose one you are happy to tell each student.</Text>
            <Input label="Starting password *" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`} />
            {error ? <Text style={styles.err} accessibilityRole="alert">{error}</Text> : null}
            <Button title={`Create ${ids.length} login${ids.length === 1 ? '' : 's'}`} onPress={run} loading={create.isPending} disabled={create.isPending || ids.length === 0} />
          </>
        )}
      </View>
    </BottomSheet>
  );
}

// One student report PDF for each chosen student, packed into a ZIP and shared, a few at a time with
// progress and a Cancel. A student the server cannot make a report for is skipped and listed.
export function BulkReportsSheet({ visible, onClose, students }: { visible: boolean; onClose: () => void; students: BulkStudent[] }) {
  const year = useAcademicYear();
  const [period, setPeriod] = useState<ReportPeriod>('this_month');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [zip, setZip] = useState<Uint8Array | null>(null);
  const [zipName, setZipName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (visible) { setPeriod('this_month'); setCustom({ from: '', to: '' }); setRunning(false); setResult(null); setZip(null); setError(null); setProgress([0, students.length]); }
  }, [visible, students.length]);

  const share = async (bytes: Uint8Array, name: string) => {
    try { await shareFileBytes(bytes, name, 'zip'); }
    catch (e) { setError((e as Error)?.message || 'Could not open the share sheet.'); }
  };

  const start = async () => {
    const params = reportPeriodParams(period, todayString(), year.current?.id ?? null, custom);
    if ('error' in params) return setError(params.error as string);
    setError(null);
    if (needsConfirm(students.length)) {
      const ok = await confirm({ title: 'Make this many reports?', message: `${students.length} reports need a good connection and use the phone's memory while they are made.`, confirmLabel: 'Start' });
      if (!ok) return;
    }
    cancelRef.current = false;
    setRunning(true);
    setResult(null);
    setZip(null);
    setProgress([0, students.length]);
    const duration = durationLabel(params, year.current?.name);
    const { zip: bytes, result: r } = await buildBulkZip({
      students,
      fileNames: uniqueNames(students.map((s) => singleReportFileName(s, duration))),
      fetchPdf: (s) => reportsApi.generateInstant(buildReportRequest(s.studentId, params)) as Promise<{ data: ArrayBuffer }>,
      onProgress: (done, total) => setProgress([done, total]),
      shouldCancel: () => cancelRef.current,
    });
    setRunning(false);
    setResult(r);
    setZip(bytes);
    // Name the zip for the students actually in it, not everyone picked.
    const name = reportsZipFileName(students.filter((s) => !r.skipped.some((k) => k.name === s.name)), duration);
    setZipName(name);
    if (bytes) await share(bytes, name);
  };

  const close = () => { if (running) cancelRef.current = true; onClose(); };

  return (
    <BottomSheet visible={visible} onClose={close} title="Student reports">
      <View style={styles.body}>
        <Text style={styles.line}>{students.length} student{students.length === 1 ? '' : 's'}</Text>
        <Text style={styles.hint}>A PDF each, with attendance, learning progress, skills, outstanding fees and remarks for the period, packed into one ZIP that opens in the share sheet.</Text>
        {running ? (
          <>
            <Text style={styles.progress}>{studentReportsProgress(progress[0], progress[1])}</Text>
            <View style={styles.bar}><View style={[styles.fill, { width: `${progress[1] ? Math.round((progress[0] / progress[1]) * 100) : 0}%` }]} /></View>
            <Button title="Cancel" variant="outline" onPress={() => { cancelRef.current = true; }} />
          </>
        ) : (
          <>
            <Select label="Period" value={period} options={REPORT_PERIODS} onChange={(v) => setPeriod(v as ReportPeriod)} />
            {period === 'custom' ? (
              <>
                <DateField label="From" value={custom.from || null} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} />
                <DateField label="To" value={custom.to || null} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} />
              </>
            ) : null}
            {result ? (
              <View>
                <Text style={styles.line}>{studentReportsResultText(result)}</Text>
                {result.skipped.map((s, i) => <Text key={i} style={styles.err}>{s.name}: {s.reason}</Text>)}
              </View>
            ) : null}
            {error ? <Text style={styles.err} accessibilityRole="alert">{error}</Text> : null}
            <Button title={result ? 'Run again' : 'Start'} onPress={start} disabled={students.length === 0} />
            {zip ? <Button title="Share the ZIP again" variant="outline" onPress={() => share(zip, zipName)} /> : null}
          </>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.sm },
  line: { fontSize: FontSize.md, color: Colors.text, fontWeight: '600' },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.sm },
  name: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  mono: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  err: { fontSize: FontSize.sm, color: Colors.error },
  progress: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primary },
  bar: { height: 8, borderRadius: 4, backgroundColor: Colors.surfaceSecondary, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: Colors.primary },
});
