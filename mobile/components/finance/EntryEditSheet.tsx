import React, { useEffect, useState } from 'react';
import { useUpdateEntry } from '../../hooks/useFinanceManager';
import { entryPayload, formFromRow, validateEntry, type EntryForm, type EntryKind, type EntryRow } from '../../services/financeEntry';
import { staffLeaveErrorMessage } from '../../services/staffLeave';
import { useToast } from '../ui/Toast';
import FormSheet from '../inventory/FormSheet';
import EntryFields from './EntryFields';

// Edit one expense or income entry in a sheet. The same fields and the same checks as recording one;
// the server decides who may change it and refuses a closed month, and its message is shown here.
export default function EntryEditSheet({ kind, row, onClose }: { kind: EntryKind; row: EntryRow | null; onClose: () => void }) {
  const toast = useToast();
  const update = useUpdateEntry(kind);
  const [form, setForm] = useState<EntryForm | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setForm(row ? formFromRow(row) : null); setError(null); }, [row]);

  const save = async () => {
    if (!row || !form) return;
    const problem = validateEntry(form);
    if (problem) { setError(problem); return; }
    try {
      await update.mutateAsync({ id: row.id, data: entryPayload(kind, form) });
      toast.success(kind === 'expense' ? 'Expense updated.' : 'Income updated.');
      onClose();
    } catch (e) {
      setError(staffLeaveErrorMessage(e, 'Could not save the changes.'));
    }
  };

  return (
    <FormSheet visible={!!row && !!form} title={kind === 'expense' ? 'Edit expense' : 'Edit income'} onClose={onClose}
      onSubmit={save} submitLabel="Save changes" busy={update.isPending} error={error}>
      {form ? <EntryFields kind={kind} form={form} set={(p) => setForm((f) => (f ? { ...f, ...p } : f))} keepCategoryId={row?.category} /> : null}
    </FormSheet>
  );
}
