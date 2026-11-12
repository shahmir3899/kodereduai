import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, ScrollView, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useBookSearch, useBorrowerSearch, useConfig, useLibraryActions, useOpenIssues } from '../../hooks/useLibrary';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { todayString } from '../../services/attendanceEntry';
import {
  BORROWER_TYPES, buildIssuePayload, dueDateIn, emptyIssueForm, isLate, issueLine, issuedText, returnConfirmText, returnedText, validateIssue,
  type BookRow, type IssueForm, type IssueRow,
} from '../../services/library';
import { inventoryErrorMessage } from '../../services/inventory';
import SegmentedTabs from '../ui/SegmentedTabs';
import SearchBar from '../ui/SearchBar';
import Input from '../ui/Input';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type Tab = 'issue' | 'return';

// Issue a book to a student or a staff member, and take books back (with the fine, if any). Admin and
// principal only. Replaces the old quick-issue screen, which sent field names the server does not read.
export default function IssueReturnScreen() {
  const { isSchoolAdminNav: canManage } = useAuth();
  const [tab, setTab] = useState<Tab>('issue');
  // A teacher only reads the list of books that are out: no issuing and no returning.
  if (!canManage) return <View style={styles.container}><ReturnTab readOnly /></View>;
  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <SegmentedTabs tabs={[{ value: 'issue', label: 'Issue a book' }, { value: 'return', label: 'Return a book' }]} value={tab} onChange={(v) => setTab(v as Tab)} />
      </View>
      {tab === 'issue' ? <IssueTab /> : <ReturnTab />}
    </View>
  );
}

function IssueTab() {
  const toast = useToast();
  const actions = useLibraryActions();
  const config = useConfig();
  const loanDays = config.data?.loan_period_days ?? 14;
  const [form, setForm] = useState<IssueForm>(emptyIssueForm(14));
  const [dueTouched, setDueTouched] = useState(false);
  const [borrowerQ, setBorrowerQ] = useState('');
  const [bookQ, setBookQ] = useState('');
  const bq = useDebouncedValue(borrowerQ.trim(), 350);
  const kq = useDebouncedValue(bookQ.trim(), 350);
  const borrowers = useBorrowerSearch(form.borrowerType, bq);
  const books = useBookSearch(kq);
  const [error, setError] = useState<string | null>(null);

  // The due date follows the library's loan period until the person picks their own.
  const due = dueTouched ? form.dueDate : dueDateIn(loanDays);

  const submit = async () => {
    const f = { ...form, dueDate: due };
    const problem = validateIssue(f, todayString());
    if (problem) return setError(problem);
    setError(null);
    try {
      const res = await actions.issue.mutateAsync(buildIssuePayload(f));
      toast.success(issuedText(res.data as { book_title?: string; borrower_name?: string }));
      setForm(emptyIssueForm(loanDays, form.borrowerType)); setDueTouched(false); setBorrowerQ(''); setBookQ('');
    } catch (e) { setError(inventoryErrorMessage(e, 'Could not issue the book.')); }
  };

  const pickBook = (b: BookRow) => setForm((f) => ({ ...f, book: b.id, bookLabel: `${b.title} (${b.available_copies} available)` }));

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <SegmentedTabs tabs={BORROWER_TYPES} value={form.borrowerType} onChange={(v) => { setForm((f) => ({ ...f, borrowerType: v as IssueForm['borrowerType'], borrower: null, borrowerLabel: '' })); setBorrowerQ(''); }} />

      <Card style={styles.card}>
        <Text style={styles.section}>{form.borrowerType === 'STAFF' ? 'Staff member' : 'Student'}</Text>
        {form.borrower ? (
          <View style={styles.picked}><Text style={styles.pickedText}>{form.borrowerLabel}</Text><Button title="Change" size="sm" variant="outline" onPress={() => setForm((f) => ({ ...f, borrower: null, borrowerLabel: '' }))} /></View>
        ) : (
          <>
            <SearchBar value={borrowerQ} onChangeText={setBorrowerQ} placeholder={`Search ${form.borrowerType === 'STAFF' ? 'staff' : 'students'} (2 letters)...`} />
            {bq.length >= 2 && borrowers.isLoading ? <Text style={styles.sub}>Searching...</Text> : null}
            {bq.length >= 2 && !borrowers.isLoading && (borrowers.data ?? []).length === 0 ? <Text style={styles.sub}>No match.</Text> : null}
            {(borrowers.data ?? []).map((p) => (
              <TouchableOpacity key={p.id} accessibilityRole="button" style={styles.option} onPress={() => setForm((f) => ({ ...f, borrower: p.id, borrowerLabel: p.sub ? `${p.label} (${p.sub})` : p.label }))}>
                <Text style={styles.name}>{p.label}</Text>{p.sub ? <Text style={styles.sub}>{p.sub}</Text> : null}
              </TouchableOpacity>
            ))}
          </>
        )}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.section}>Book</Text>
        {form.book ? (
          <View style={styles.picked}><Text style={styles.pickedText}>{form.bookLabel}</Text><Button title="Change" size="sm" variant="outline" onPress={() => setForm((f) => ({ ...f, book: null, bookLabel: '' }))} /></View>
        ) : (
          <>
            <SearchBar value={bookQ} onChangeText={setBookQ} placeholder="Search title, author or ISBN (2 letters)..." />
            {kq.length >= 2 && books.isLoading ? <Text style={styles.sub}>Searching...</Text> : null}
            {kq.length >= 2 && !books.isLoading && (books.data ?? []).length === 0 ? <Text style={styles.sub}>No book with a free copy matches.</Text> : null}
            {(books.data ?? []).map((b) => (
              <TouchableOpacity key={b.id} accessibilityRole="button" style={styles.option} onPress={() => pickBook(b)}>
                <Text style={styles.name}>{b.title}</Text><Text style={styles.sub}>{`${b.author}  ·  ${b.available_copies} available`}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}
      </Card>

      <DateField label="Due date" value={due} onChange={(v) => { setDueTouched(true); setForm((f) => ({ ...f, dueDate: v })); }} />
      <Input label="Notes (optional)" value={form.notes} onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))} />
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <Button title="Issue book" onPress={submit} loading={actions.issue.isPending} disabled={actions.issue.isPending} />
    </ScrollView>
  );
}

function ReturnTab({ readOnly = false }: { readOnly?: boolean }) {
  const toast = useToast();
  const actions = useLibraryActions();
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const query = useOpenIssues(term);
  const refreshControl = useRefreshControl(query.refetch) as React.ReactElement<RefreshControlProps>;
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);
  const [busy, setBusy] = useState<number | null>(null);

  const giveBack = async (i: IssueRow) => {
    if (!(await confirm({ title: 'Return this book?', message: returnConfirmText(i), confirmLabel: 'Return' }))) return;
    setBusy(i.id);
    try {
      const res = await actions.returnBook.mutateAsync(i.id);
      toast.success(returnedText(res.data as { fine_amount?: string | number }));
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not process the return.')); }
    finally { setBusy(null); }
  };

  if (query.isLoading) return <Skeleton variant="list" />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <FlatList
      contentContainerStyle={styles.content}
      data={rows}
      keyExtractor={(i) => String(i.id)}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
      ListHeaderComponent={<SearchBar value={search} onChangeText={setSearch} placeholder="Search borrower or book..." />}
      onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={<EmptyState title="No books out" message={term ? 'Nothing matches your search.' : 'Every book is back on the shelf.'} />}
      ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
      renderItem={({ item: i }) => (
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.name} numberOfLines={2}>{i.book_title}</Text>
            <Text style={styles.sub}>{issueLine(i)}</Text>
            {isLate(i) ? <StatusPill label="Overdue" tone="warning" /> : null}
          </View>
          {readOnly ? null : <Button title="Return" size="sm" variant="outline" loading={busy === i.id} disabled={busy !== null} onPress={() => giveBack(i)} />}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  tabs: { padding: Spacing.lg, paddingBottom: 0 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  card: { gap: Spacing.sm },
  section: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  picked: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, justifyContent: 'space-between' },
  pickedText: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.primary },
  option: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md },
  error: { color: Colors.error, fontSize: FontSize.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm },
  flex: { flex: 1, gap: 2 },
});
