import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, Switch, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useBooksPaged, useCategories, useLibraryActions } from '../../hooks/useLibrary';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  bookLine, bookToForm, buildBookPayload, copiesLine, copiesOut, deleteBookText, deleteCategoryText, emptyBookForm, validateBook, validateCategory,
  type BookForm, type BookRow, type CategoryRow,
} from '../../services/library';
import { inventoryErrorMessage } from '../../services/inventory';
import SearchBar from '../ui/SearchBar';
import Select from '../ui/Select';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const ALL = -1;

// The book catalog: search, category filter, add, edit and delete a book, and manage categories.
// Admin and principal manage it; a teacher can search and read it (the server refuses their writes, so the buttons are hidden).
export default function CatalogScreen() {
  const toast = useToast();
  const { isSchoolAdminNav: canManage } = useAuth();
  const actions = useLibraryActions();
  const categories = useCategories();
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const [category, setCategory] = useState<number>(ALL);
  const query = useBooksPaged(term, category === ALL ? null : category, false);
  const refreshControl = useRefreshControl(query.refetch) as React.ReactElement<RefreshControlProps>;
  const books = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);
  const total = query.data?.pages[0]?.count ?? 0;

  const [editing, setEditing] = useState<BookRow | 'new' | null>(null);
  const [form, setForm] = useState<BookForm>(emptyBookForm());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof BookForm>(k: K, v: BookForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const [catOpen, setCatOpen] = useState(false);
  const [catEditing, setCatEditing] = useState<CategoryRow | 'new' | null>(null);
  const [catName, setCatName] = useState('');
  const [catError, setCatError] = useState<string | null>(null);

  const openBook = (b: BookRow | 'new') => { setError(null); setForm(b === 'new' ? emptyBookForm() : bookToForm(b)); setEditing(b); };
  const existing = editing && editing !== 'new' ? editing : null;

  const save = async () => {
    const problem = validateBook(form, existing);
    if (problem) return setError(problem);
    setError(null);
    try {
      if (existing) await actions.updateBook.mutateAsync({ id: existing.id, data: buildBookPayload(form) });
      else await actions.createBook.mutateAsync(buildBookPayload(form));
      toast.success(existing ? 'Book saved.' : 'Book added.');
      setEditing(null);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  const removeBook = async () => {
    if (!existing) return;
    if (!(await confirm({ title: 'Delete this book?', message: deleteBookText(existing), confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteBook.mutateAsync(existing.id);
      toast.success('Book deleted.');
      setEditing(null);
    } catch (e) { setError(inventoryErrorMessage(e, 'Could not delete the book.')); }
  };

  const saveCategory = async () => {
    const problem = validateCategory(catName);
    if (problem) return setCatError(problem);
    setCatError(null);
    try {
      if (catEditing && catEditing !== 'new') await actions.updateCategory.mutateAsync({ id: catEditing.id, data: { name: catName.trim() } });
      else await actions.createCategory.mutateAsync({ name: catName.trim() });
      toast.success('Category saved.');
      setCatEditing(null); setCatName('');
    } catch (e) { setCatError(inventoryErrorMessage(e)); }
  };

  const removeCategory = async (c: CategoryRow) => {
    if (!(await confirm({ title: 'Delete this category?', message: deleteCategoryText(c), confirmLabel: 'Delete', destructive: true }))) return;
    try { await actions.deleteCategory.mutateAsync(c.id); toast.success('Category deleted.'); setCatEditing(null); }
    catch (e) { setCatError(inventoryErrorMessage(e, 'Could not delete the category.')); }
  };

  const header = (
    <View style={styles.header}>
      {canManage ? <Button title="+ Add a book" size="sm" onPress={() => openBook('new')} /> : null}
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search title, author or ISBN..." />
      <Select<number> label="Category" value={category} onChange={setCategory} placeholder="All categories"
        options={[{ value: ALL, label: 'All categories' }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
      {canManage ? <Button title="Manage categories" size="sm" variant="ghost" onPress={() => { setCatError(null); setCatEditing(null); setCatOpen(true); }} /> : null}
      <Text style={styles.sub}>{`${total} book${total === 1 ? '' : 's'}`}</Text>
    </View>
  );

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton variant="list" /></View>;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={books}
        keyExtractor={(b) => String(b.id)}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<EmptyState title="No books" message={term ? 'No book matches your search.' : 'Add the first book to the catalog.'} />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
        renderItem={({ item: b }) => (
          <TouchableOpacity accessibilityRole="button" style={[styles.row, !b.is_active && styles.inactive]} onPress={() => { if (canManage) openBook(b); }} disabled={!canManage}>
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={2}>{b.title}</Text>
              <Text style={styles.sub} numberOfLines={1}>{bookLine(b)}</Text>
              <Text style={styles.sub}>{copiesLine(b)}</Text>
            </View>
            {!b.is_active ? <StatusPill label="Inactive" tone="neutral" /> : b.available_copies === 0 ? <StatusPill label="All out" tone="warning" /> : null}
          </TouchableOpacity>
        )}
      />

      <FormSheet visible={editing !== null} title={existing ? 'Edit book' : 'Add a book'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.createBook.isPending || actions.updateBook.isPending} error={error}>
        <Input label="Title" value={form.title} onChangeText={(v) => set('title', v)} />
        <Input label="Author" value={form.author} onChangeText={(v) => set('author', v)} />
        <Input label="ISBN (optional)" value={form.isbn} onChangeText={(v) => set('isbn', v)} autoCapitalize="characters" />
        <Input label="Publisher (optional)" value={form.publisher} onChangeText={(v) => set('publisher', v)} />
        <Select<number | ''> label="Category" value={form.category ?? ''} onChange={(v) => set('category', v === '' ? null : Number(v))} placeholder="No category"
          options={[{ value: '', label: 'No category' }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
        <Input label={existing ? `Total copies (${copiesOut(existing)} out now)` : 'Total copies'} value={form.totalCopies} onChangeText={(v) => set('totalCopies', v)} keyboardType="number-pad" />
        <Input label="Shelf location (optional)" value={form.shelf} onChangeText={(v) => set('shelf', v)} />
        <View style={styles.toggle}>
          <Text style={styles.name}>Active in the catalog</Text>
          <Switch value={form.active} onValueChange={(v) => set('active', v)} accessibilityLabel="Active in the catalog" />
        </View>
        {existing ? <Button title="Delete book" variant="danger" size="sm" onPress={removeBook} loading={actions.deleteBook.isPending} /> : null}
      </FormSheet>

      <FormSheet visible={catOpen} title="Categories" onClose={() => setCatOpen(false)} onSubmit={saveCategory} submitLabel={catEditing && catEditing !== 'new' ? 'Rename' : 'Add category'}
        busy={actions.createCategory.isPending || actions.updateCategory.isPending} error={catError}>
        {(categories.data ?? []).map((c) => (
          <View key={c.id} style={styles.catRow}>
            <TouchableOpacity accessibilityRole="button" style={styles.who} onPress={() => { setCatEditing(c); setCatName(c.name); setCatError(null); }}>
              <Text style={styles.name}>{c.name}</Text>
            </TouchableOpacity>
            <Button title="Delete" size="sm" variant="ghost" onPress={() => removeCategory(c)} />
          </View>
        ))}
        {(categories.data ?? []).length === 0 ? <Text style={styles.sub}>No categories yet.</Text> : null}
        <Input label={catEditing && catEditing !== 'new' ? 'Rename category' : 'New category'} value={catName} onChangeText={setCatName} placeholder="e.g. Science" />
        {catEditing && catEditing !== 'new' ? <Button title="Cancel rename" size="sm" variant="ghost" onPress={() => { setCatEditing(null); setCatName(''); setCatError(null); }} /> : null}
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  header: { gap: Spacing.md, marginBottom: Spacing.sm },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.md },
  inactive: { opacity: 0.6 },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border, minHeight: 44 },
});
