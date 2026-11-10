import React, { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import {
  EXIT_TYPES, ITEM_STATE_LABELS, ITEM_STATE_TONES, awaySinceText, buildReadmitPayload, buildStartPayload, buildUpdatePayload,
  canFinalize, carryLines, carryText, conflictSummary, emptyExitForm, emptyReadmitForm, exitProblem, exitToForm, finalizeConfirmText,
  finalizeEffects, finalizedText, isTransfer, itemDetailLines, itemsOf, nextFreeRoll, openItems, openItemsText, readmitConfirmText,
  validateDetails, validateReadmit, waiverProblem, waivedNote,
  type ExitForm, type ExitItem, type LeavingConflict, type ReadmitForm,
} from '../../services/studentExit';
import { todayString } from '../../services/attendanceEntry';
import { useDestinationClasses, useExitActions, useExitDestinations, useOpenExit } from '../../hooks/useStudentExit';
import { useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Base { visible: boolean; onClose: () => void; student: { id: number; name: string } }

const STEPS = ['Details', 'Clearance', 'Review'];
const TONE_COLOR = { success: Colors.success, error: Colors.error, warning: Colors.warning, info: Colors.primary } as const;

// Withdraw or transfer a student, the phone's version of the web wizard: details, then the clearance
// list (fees, library books, gate passes) where an open item is waived with a reason or, for a
// transfer, its fees carried to the new branch, then a review and a confirmed finalize. Closing the
// sheet keeps the exit open on the server, so it is picked up again at the clearance step.
export function StudentExitSheet({ visible, onClose, student }: Base) {
  const toast = useToast();
  const open = useOpenExit(student.id, visible);
  const exitCase = open.data ?? null;
  const actions = useExitActions();
  const destinations = useExitDestinations(visible);

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<ExitForm>(emptyExitForm(todayString()));
  const [rollTyped, setRollTyped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<LeavingConflict | null>(null);
  const [waiving, setWaiving] = useState<{ kind: string; reason: string } | null>(null);
  const [carrying, setCarrying] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  // Each opening starts clean; an exit already on the server resumes at the clearance step.
  useEffect(() => {
    if (!visible) { setStarted(false); return; }
    if (started || open.isLoading) return;
    setForm(exitCase ? exitToForm(exitCase) : emptyExitForm(todayString()));
    setRollTyped(!!exitCase?.destination_roll_number);
    setStep(exitCase ? 1 : 0);
    setError(null); setConflict(null); setWaiving(null); setCarrying(false); setCancelling(null);
    setStarted(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, open.isLoading]);

  const transfer = isTransfer(form);
  const classes = useDestinationClasses(form.destinationSchool, form.leavingDate, visible && transfer && step === 0);
  const targetClass = classes.data?.classes?.find((c) => c.id === form.destinationClass);
  const suggestedRoll = useMemo(() => (targetClass ? nextFreeRoll(targetClass.rolls) : null), [targetClass]);
  useEffect(() => {
    if (!rollTyped && suggestedRoll) setForm((f) => (f.destinationRoll === suggestedRoll ? f : { ...f, destinationRoll: suggestedRoll }));
  }, [suggestedRoll, rollTyped]);

  const busy = Object.values(actions).some((m) => m.isPending);
  const items = itemsOf(exitCase);
  const stillOpen = openItems(exitCase);
  const destinationName = destinations.data?.find((d) => d.id === form.destinationSchool)?.name ?? exitCase?.destination_school_name ?? 'the new branch';

  const set = <K extends keyof ExitForm>(k: K, v: ExitForm[K]) => {
    setForm((f) => ({
      ...f, [k]: v,
      // Another branch, or another date (so maybe another year), means another set of classes.
      ...(k === 'destinationSchool' || k === 'leavingDate' ? { destinationClass: null, destinationRoll: '' } : {}),
    }));
    if (k === 'destinationSchool' || k === 'leavingDate') setRollTyped(false);
    setConflict(null); setError(null);
  };

  const run = async <T,>(action: () => Promise<T>): Promise<T | null> => {
    setError(null);
    try { return await action(); } catch (e) {
      const p = exitProblem(e);
      if (p.kind === 'conflict') setConflict(p.conflict); else setError(p.message);
      return null;
    }
  };

  const saveDetails = async () => {
    const problem = validateDetails(form);
    if (problem) return setError(problem);
    const ok = await run(() => (exitCase
      ? actions.update.mutateAsync({ id: exitCase.id, data: buildUpdatePayload(form) })
      : actions.start.mutateAsync(buildStartPayload(student.id, form))));
    if (ok) { await open.refetch(); setStep(1); }
  };

  const reload = async (ok: unknown) => { if (ok) await open.refetch(); return !!ok; };

  const waive = async () => {
    if (!exitCase || !waiving) return;
    const problem = waiverProblem(waiving.reason);
    if (problem) return setError(problem);
    if (await reload(await run(() => actions.waive.mutateAsync({ id: exitCase.id, kind: waiving.kind, reason: waiving.reason.trim() })))) setWaiving(null);
  };
  const undo = async (kind: string) => { if (exitCase) await reload(await run(() => actions.unwaive.mutateAsync({ id: exitCase.id, kind }))); };
  const carry = async () => {
    if (!exitCase) return;
    if (await reload(await run(() => actions.carry.mutateAsync({ id: exitCase.id, kind: 'FEES' })))) setCarrying(false);
  };
  const checkAgain = async () => { if (exitCase) await reload(await run(() => actions.refresh.mutateAsync(exitCase.id))); };

  const finalize = async () => {
    if (!exitCase) return;
    if (!canFinalize(exitCase)) return; // the review step already says what is still open
    const yes = await confirm({ title: 'Finalize this exit?', message: finalizeConfirmText({ ...exitCase, student_name: exitCase.student_name ?? student.name }), confirmLabel: 'Finalize', destructive: true });
    if (!yes) return;
    if (await run(() => actions.finalize.mutateAsync(exitCase.id))) {
      toast.success(finalizedText({ student_name: student.name, exit_type: exitCase.exit_type }));
      onClose();
    }
  };

  const cancelExit = async () => {
    if (!exitCase || cancelling === null) return;
    if (await run(() => actions.cancel.mutateAsync({ id: exitCase.id, reason: cancelling.trim() }))) {
      toast.success('Exit cancelled. The student is unchanged.');
      onClose();
    }
  };

  const submit = step === 0 ? saveDetails : step === 1 ? () => { setError(null); setStep(2); } : finalize;
  const submitLabel = step === 0 ? 'Continue' : step === 1 ? 'Review' : actions.finalize.isPending ? 'Finalizing, this can take a minute...' : 'Finalize exit';

  return (
    <FormSheet visible={visible} title="Leaving or transfer" onClose={onClose} onSubmit={submit} submitLabel={submitLabel} busy={busy || open.isLoading} error={error}
      secondaryLabel={step === 1 ? 'Check again' : step === 2 ? 'Back' : undefined}
      onSecondary={step === 1 ? checkAgain : step === 2 ? () => { setError(null); setStep(1); } : undefined}>
      <Text style={styles.sub}>{student.name}</Text>
      <View style={styles.steps} accessibilityLabel={`Step ${step + 1} of 3: ${STEPS[step]}`}>
        {STEPS.map((label, i) => (
          <Text key={label} style={[styles.step, i === step && styles.stepOn, i < step && styles.stepDone]}>{i + 1}. {label}</Text>
        ))}
      </View>

      {open.isLoading ? <Text style={styles.hint}>Checking for an exit already started...</Text> : null}

      {step === 0 && !open.isLoading ? (
        <>
          {EXIT_TYPES.map((t) => (
            <TouchableOpacity key={t.value} accessibilityRole="radio" accessibilityState={{ selected: form.exitType === t.value, disabled: !!exitCase }}
              disabled={!!exitCase} onPress={() => set('exitType', t.value)} style={[styles.option, form.exitType === t.value && styles.optionOn]}>
              <Text style={styles.optionTitle}>{t.label}</Text>
              <Text style={styles.optionHint}>{t.hint}</Text>
            </TouchableOpacity>
          ))}
          <DateField label="Leaving date (the first day the student is gone)" value={form.leavingDate || null} onChange={(v) => set('leavingDate', v)} />
          {transfer ? (
            <>
              <Select label="Transferring to" value={form.destinationSchool} placeholder="Select a branch"
                options={(destinations.data ?? []).map((d) => ({ value: d.id, label: d.name }))} onChange={(v) => set('destinationSchool', Number(v))} />
              {destinations.data && destinations.data.length === 0 ? <Text style={styles.warn}>There is no other active branch in your organization.</Text> : null}
              {form.destinationSchool ? (
                <>
                  {classes.isError ? <Text style={styles.warn}>{exitProblem(classes.error, 'Could not load the classes of that branch.').message}</Text> : null}
                  <Select label={`Class at ${destinationName}${classes.data?.academic_year ? ` (${classes.data.academic_year.name})` : ''}`} value={form.destinationClass}
                    placeholder={classes.isLoading ? 'Loading classes...' : 'Select a class'} disabled={classes.isLoading}
                    options={(classes.data?.classes ?? []).map((c) => ({ value: c.id, label: c.label }))}
                    onChange={(v) => { setRollTyped(false); setForm((f) => ({ ...f, destinationClass: Number(v), destinationRoll: '' })); setError(null); }} />
                  <Input label="Roll number at the new branch" value={form.destinationRoll} onChangeText={(v) => { setRollTyped(true); setForm((f) => ({ ...f, destinationRoll: v })); }} />
                  {suggestedRoll ? <Text style={styles.hint}>Next free roll in that class: {suggestedRoll}</Text> : null}
                  <Text style={styles.hint}>A new student record is created at {destinationName} from the leaving date. The record here stays.</Text>
                </>
              ) : null}
            </>
          ) : null}
          {conflict ? (
            <View style={styles.notice} accessibilityRole="alert">
              <Text style={styles.noticeTitle}>{conflict.detail}</Text>
              <Text style={styles.noticeText}>Recorded on or after that date: {conflictSummary(conflict) || 'some records'}.</Text>
              {conflict.suggested_leaving_date ? (
                <Button title={`Use ${conflict.suggested_leaving_date} instead`} size="sm" variant="outline"
                  onPress={() => { setForm((f) => ({ ...f, leavingDate: conflict.suggested_leaving_date! })); setConflict(null); }} />
              ) : null}
              <Text style={styles.noticeText}>Removing those records instead is only possible on the web app.</Text>
            </View>
          ) : null}
          <Input label="Reason" value={form.reason} onChangeText={(v) => set('reason', v)} placeholder="Brief reason" multiline style={styles.area} />
        </>
      ) : null}

      {step === 1 && exitCase ? (
        <>
          <Text style={styles.hint}>Every item must be clear, or waived with a reason, before you can finalize. An item clears itself once the problem is fixed: use Check again.</Text>
          {items.map((item) => (
            <ItemCard key={item.kind} item={item} busy={busy} destinationName={destinationName}
              carryPlan={transfer && item.kind === 'FEES' ? exitCase.fee_carry_plan ?? null : null}
              carrying={carrying && item.kind === 'FEES'} onCarryOpen={() => { setWaiving(null); setCarrying(true); }} onCarryClose={() => setCarrying(false)} onCarry={carry}
              waiveReason={waiving?.kind === item.kind ? waiving.reason : null}
              onWaiveOpen={() => { setCarrying(false); setError(null); setWaiving({ kind: item.kind, reason: '' }); }}
              onWaiveText={(reason) => setWaiving({ kind: item.kind, reason })} onWaiveClose={() => setWaiving(null)} onWaive={waive} onUndo={() => undo(item.kind)} />
          ))}
          <Button title="Back to details" size="sm" variant="ghost" onPress={() => { setError(null); setStep(0); }} />
        </>
      ) : null}

      {step === 2 && exitCase ? (
        <>
          <Row label="Type" value={exitCase.exit_type_label ?? exitCase.exit_type} />
          {exitCase.destination_school_name ? <Row label="Transferring to" value={exitCase.destination_school_name} /> : null}
          {exitCase.destination_class_label ? <Row label="Class at the new branch" value={`${exitCase.destination_class_label}  ·  Roll ${exitCase.destination_roll_number ?? ''}`} /> : null}
          <Row label="Leaving date" value={exitCase.leaving_date} />
          <Row label="Reason" value={exitCase.reason || 'None given'} />
          {items.filter((i) => i.state === 'WAIVED').map((i) => <Text key={i.kind} style={styles.warn}>{i.kind_label ?? i.kind}: {waivedNote(i)}</Text>)}
          {items.filter((i) => i.state === 'CARRIED').map((i) => <Text key={i.kind} style={styles.hint}>Fees carried to {destinationName}: {i.summary}. Created there as unpaid and no longer counted here.</Text>)}
          <Text style={styles.label}>When you finalize</Text>
          {finalizeEffects(exitCase).map((line) => <Text key={line} style={styles.bullet}>•  {line}</Text>)}
          {stillOpen.length > 0 ? <Text style={styles.warn} accessibilityRole="alert">{openItemsText(stillOpen.length)}</Text> : null}
        </>
      ) : null}

      {exitCase && !open.isLoading ? (cancelling === null ? (
        <Button title="Cancel this exit" size="sm" variant="ghost" onPress={() => setCancelling('')} />
      ) : (
        <View style={styles.notice}>
          <Input label="Why is this exit being cancelled? (optional)" value={cancelling} onChangeText={setCancelling} />
          <View style={styles.rowButtons}>
            <Button title="Keep exit" size="sm" variant="outline" onPress={() => setCancelling(null)} />
            <Button title="Cancel exit" size="sm" variant="danger" loading={actions.cancel.isPending} onPress={cancelExit} />
          </View>
        </View>
      )) : null}
    </FormSheet>
  );
}

interface ItemCardProps {
  item: ExitItem; busy: boolean; destinationName: string;
  carryPlan: NonNullable<Parameters<typeof carryLines>[0]> | null;
  carrying: boolean; onCarryOpen: () => void; onCarryClose: () => void; onCarry: () => void;
  waiveReason: string | null; onWaiveOpen: () => void; onWaiveText: (v: string) => void; onWaiveClose: () => void; onWaive: () => void;
  onUndo: () => void;
}

function ItemCard({ item, busy, destinationName, carryPlan, carrying, onCarryOpen, onCarryClose, onCarry, waiveReason, onWaiveOpen, onWaiveText, onWaiveClose, onWaive, onUndo }: ItemCardProps) {
  const lines = itemDetailLines(item);
  return (
    <View style={styles.item}>
      <View style={styles.itemHead}>
        <View style={styles.flex}>
          <Text style={styles.itemTitle}>{item.kind_label ?? item.kind}</Text>
          <Text style={styles.itemSub}>{item.summary || 'Nothing outstanding'}</Text>
        </View>
        <Text style={[styles.state, { color: TONE_COLOR[ITEM_STATE_TONES[item.state]] }]}>{ITEM_STATE_LABELS[item.state]}</Text>
      </View>
      {lines.map((l, i) => <Text key={i} style={styles.line}>{l}</Text>)}

      {item.state === 'WAIVED' ? (
        <>
          <Text style={styles.warn}>{waivedNote(item)}</Text>
          <Button title="Undo waiver" size="sm" variant="ghost" disabled={busy} onPress={onUndo} />
        </>
      ) : null}
      {item.state === 'CARRIED' ? (
        <>
          <Text style={styles.hint}>{item.waiver_reason ?? 'Carried'}. It becomes {destinationName}'s to collect.</Text>
          <Button title="Undo" size="sm" variant="ghost" disabled={busy} onPress={onUndo} />
        </>
      ) : null}

      {item.state === 'OPEN' && carrying && carryPlan ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>What {carryPlan.destination} will receive</Text>
          {carryLines(carryPlan).map((l, i) => <Text key={i} style={styles.line}>{l}</Text>)}
          <Text style={styles.noticeText}>{carryText(carryPlan)} Nothing is marked as paid.</Text>
          <View style={styles.rowButtons}>
            <Button title="Cancel" size="sm" variant="outline" onPress={onCarryClose} />
            <Button title={`Carry to ${carryPlan.destination}`} size="sm" loading={busy} onPress={onCarry} />
          </View>
        </View>
      ) : null}

      {item.state === 'OPEN' && !carrying ? (waiveReason !== null ? (
        <View style={styles.notice}>
          <Input label="Reason for waiving (at least 10 characters)" value={waiveReason} onChangeText={onWaiveText} multiline style={styles.area} />
          <View style={styles.rowButtons}>
            <Button title="Cancel" size="sm" variant="outline" onPress={onWaiveClose} />
            <Button title="Confirm waiver" size="sm" loading={busy} onPress={onWaive} />
          </View>
        </View>
      ) : (
        <View style={styles.rowButtons}>
          {carryPlan ? <Button title={`Carry to ${carryPlan.destination}`} size="sm" variant="outline" onPress={onCarryOpen} /> : null}
          <Button title="Waive" size="sm" variant="outline" onPress={onWaiveOpen} />
        </View>
      )) : null}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

interface ReadmitProps extends Base { awaySince?: string | null }

// Bring back a student who left. It is the same record: earlier attendance, marks and fees stay and
// the time away stays empty. Returning in the year they left keeps their class and roll unless one is
// chosen here; the server asks for a class when it needs one.
export function StudentReadmitSheet({ visible, onClose, student, awaySince }: ReadmitProps) {
  const toast = useToast();
  const { readmit } = useExitActions();
  const { options } = useAttendanceClassOptions();
  const sections = useMemo(() => options.filter((o) => o.isSession), [options]);
  const [form, setForm] = useState<ReadmitForm>(emptyReadmitForm(todayString()));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (visible) { setForm(emptyReadmitForm(todayString())); setError(null); } }, [visible]);

  const submit = async () => {
    const problem = validateReadmit(form, awaySince);
    if (problem) return setError(problem);
    const yes = await confirm({ title: 'Re-admit this student?', message: readmitConfirmText(student.name, form), confirmLabel: 'Re-admit' });
    if (!yes) return;
    setError(null);
    try {
      await readmit.mutateAsync(buildReadmitPayload(student.id, form));
      toast.success(`${student.name} has been re-admitted.`);
      onClose();
    } catch (e) { setError(exitProblem(e, 'Could not re-admit the student.').message); }
  };

  return (
    <FormSheet visible={visible} title="Re-admit student" onClose={onClose} onSubmit={submit} submitLabel="Re-admit" busy={readmit.isPending} error={error}>
      <Text style={styles.hint}>{awaySinceText(student.name, awaySince)} Their earlier records stay; the time away stays empty.</Text>
      <DateField label="Return date" value={form.returnDate || null} onChange={(v) => setForm((f) => ({ ...f, returnDate: v }))} />
      <Select label="Class (leave empty to keep their class)" value={form.sessionClass} placeholder="Same class as before"
        options={sections.map((o) => ({ value: o.id, label: o.label }))} onChange={(v) => setForm((f) => ({ ...f, sessionClass: Number(v) }))} />
      <Input label="Roll number (leave empty to keep their roll)" value={form.roll} onChangeText={(v) => setForm((f) => ({ ...f, roll: v }))} />
      <Input label="Reason" value={form.reason} onChangeText={(v) => setForm((f) => ({ ...f, reason: v }))} placeholder="Why are they returning?" multiline style={styles.area} />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  steps: { flexDirection: 'row', gap: Spacing.xs, marginVertical: Spacing.xs },
  step: { fontSize: FontSize.xs, color: Colors.textSecondary, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  stepOn: { color: Colors.textInverse, backgroundColor: Colors.primary, borderColor: Colors.primary, overflow: 'hidden' },
  stepDone: { color: Colors.primary, borderColor: Colors.primary },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary, marginVertical: Spacing.xs },
  warn: { fontSize: FontSize.sm, color: Colors.warning, marginVertical: Spacing.xs },
  option: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  optionOn: { borderColor: Colors.primary, backgroundColor: Colors.infoLight },
  optionTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  optionHint: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  area: { minHeight: 72, textAlignVertical: 'top' },
  notice: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.xs, marginVertical: Spacing.xs },
  noticeTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  noticeText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  rowButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.xs },
  item: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  itemHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  itemTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  itemSub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  state: { fontSize: FontSize.xs, fontWeight: '700' },
  line: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  kv: { marginBottom: Spacing.xs },
  label: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', marginTop: Spacing.xs },
  value: { fontSize: FontSize.md, color: Colors.text },
  bullet: { fontSize: FontSize.sm, color: Colors.text, marginTop: 2 },
});
