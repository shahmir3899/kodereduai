import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { examinationsApi } from '../../services/api';
import { makeReportCardPdf } from '../../services/reportCardPdf';
import type { CardReport } from '../../services/reportCardHtml';
import { useSchoolProfile } from '../../hooks/useSchoolProfile';
import { shareFileBytes } from '../../services/reportShare';
import { reportCardQueryParams, type ReportTemplate } from '../../services/reportCard';
import {
  buildBulkZip, needsConfirm, progressText, resultText, zipFileName, type BulkResult, type BulkStudent,
} from '../../services/bulkReportCards';
import BottomSheet from '../ui/BottomSheet';
import Button from '../ui/Button';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Props {
  visible: boolean;
  onClose: () => void;
  students: BulkStudent[];
  yearId: number;
  examIds: number[];
  template: ReportTemplate;
  className: string;
}

// Make every student's report card for the chosen class and exams, pack them into one ZIP and share
// it. Runs a few students at a time, shows progress, and can be cancelled. A student the server cannot
// make a card for is skipped and listed with the reason. A big class asks before it starts.
export default function BulkReportCardsSheet({ visible, onClose, students, yearId, examIds, template, className }: Props) {
  const school = useSchoolProfile();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [zip, setZip] = useState<Uint8Array | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (visible) { setRunning(false); setResult(null); setZip(null); setShareError(null); setConfirmed(false); setProgress([0, students.length]); }
  }, [visible, students.length]);

  const share = async (bytes: Uint8Array) => {
    setShareError(null);
    try { await shareFileBytes(bytes, zipFileName(className), 'zip'); }
    catch (e) { setShareError((e as Error)?.message || 'Could not open the share sheet.'); }
  };

  const start = async () => {
    if (needsConfirm(students.length) && !confirmed) { setConfirmed(true); return; }
    cancelRef.current = false;
    setRunning(true);
    setResult(null);
    setZip(null);
    setProgress([0, students.length]);
    const { zip: bytes, result: r } = await buildBulkZip({
      students,
      // Each card's data comes from the server (the same call the screen makes); the phone draws the PDF.
      fetchPdf: async (s) => {
        const res = await examinationsApi.getReportCard(
          reportCardQueryParams({ studentId: s.studentId, enrollmentId: s.enrollmentId, yearId, examIds }),
        );
        return makeReportCardPdf(res.data as CardReport, school.data, template);
      },
      onProgress: (done, total) => setProgress([done, total]),
      shouldCancel: () => cancelRef.current,
    });
    setRunning(false);
    setResult(r);
    setZip(bytes);
    if (bytes) await share(bytes);
  };

  const cancel = () => { cancelRef.current = true; };

  const close = () => { if (running) cancel(); onClose(); };

  return (
    <BottomSheet visible={visible} onClose={close} title="All report cards">
      <View style={styles.body}>
        <Text style={styles.line}>{students.length} student{students.length === 1 ? '' : 's'} in {className}, {examIds.length} exam{examIds.length === 1 ? '' : 's'}, {template} layout.</Text>
        <Text style={styles.hint}>Each card is drawn on your phone, then packed into one ZIP file that opens in the share sheet.</Text>

        {running ? (
          <>
            <Text style={styles.progress}>{progressText(progress[0], progress[1])}</Text>
            <View style={styles.bar}><View style={[styles.fill, { width: `${progress[1] ? Math.round((progress[0] / progress[1]) * 100) : 0}%` }]} /></View>
            <Button title="Cancel" variant="outline" onPress={cancel} />
          </>
        ) : (
          <>
            {!result && needsConfirm(students.length) && confirmed ? (
              <Text style={styles.warn}>This is a large class. It needs a good connection and uses the phone's memory while it runs. Tap again to continue.</Text>
            ) : null}
            {result ? (
              <View>
                <Text style={styles.result}>{resultText(result)}</Text>
                {result.skipped.map((s, i) => <Text key={i} style={styles.skip}>{s.name}: {s.reason}</Text>)}
                {shareError ? <Text style={styles.error}>{shareError}</Text> : null}
              </View>
            ) : null}
            <View style={styles.actions}>
              <Button title={result ? 'Run again' : confirmed && needsConfirm(students.length) ? 'Continue' : 'Start'} onPress={start} disabled={students.length === 0 || examIds.length === 0} />
              {zip ? <Button title="Share the ZIP again" variant="outline" onPress={() => share(zip)} /> : null}
            </View>
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
  progress: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primary, marginTop: Spacing.sm },
  bar: { height: 8, borderRadius: 4, backgroundColor: Colors.surfaceSecondary, overflow: 'hidden', marginBottom: Spacing.sm },
  fill: { height: 8, backgroundColor: Colors.primary },
  warn: { fontSize: FontSize.sm, color: Colors.warning, backgroundColor: Colors.warningLight, borderRadius: BorderRadius.md, padding: Spacing.md },
  result: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginTop: Spacing.sm },
  skip: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  error: { fontSize: FontSize.sm, color: Colors.error, marginTop: Spacing.sm },
  actions: { gap: Spacing.sm, marginTop: Spacing.sm },
});
