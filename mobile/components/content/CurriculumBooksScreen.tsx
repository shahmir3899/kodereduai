import React, { useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useMasterClasses } from '../../hooks/useAcademicYear';
import { useCurriculumActions } from '../../hooks/useCurriculum';
import { useSubjectsList, booksFetcher } from '../../hooks/useManager';
import { usePersonaBase } from '../../hooks/usePersonaBase';
import { buildBookPayload, emptyBookForm, LANGUAGES, validateBook, type BookForm } from '../../services/curriculum';
import { inventoryErrorMessage } from '../../services/inventory';
import { bookRow, type BookDto } from '../../services/manager';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { useToast } from '../ui/Toast';
import FormSheet from '../inventory/FormSheet';
import ContentListScreen from './ContentListScreen';

// Books for admin, principal, teacher and manager (all may edit curriculum): search, open a
// book's chapters, and add a book.
export default function CurriculumBooksScreen() {
  const router = useRouter();
  const base = usePersonaBase();
  const toast = useToast();
  const { activeSchool } = useAuth();
  const actions = useCurriculumActions();
  const classes = useMasterClasses();
  const subjects = useSubjectsList();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<BookForm>(emptyBookForm());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof BookForm>(k: K, v: BookForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const problem = validateBook(form);
    if (problem || !activeSchool) return setError(problem ?? 'No school selected.');
    setError(null);
    try {
      const res = await actions.createBook.mutateAsync(buildBookPayload(form, activeSchool.id));
      toast.success('Book added.');
      setOpen(false);
      const id = (res.data as { id?: number })?.id;
      if (id) router.push({ pathname: `${base}/curriculum/book`, params: { id } } as Href);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  return (
    <>
      <ContentListScreen<BookDto>
        root="books" fetcher={booksFetcher} toRow={bookRow} searchPlaceholder="Search books..." emptyTitle="No books"
        headerAction={<Button title="+ New book" size="sm" onPress={() => { setForm(emptyBookForm()); setError(null); setOpen(true); }} />}
        onPressRow={(r) => router.push({ pathname: `${base}/curriculum/book`, params: { id: r.id } } as Href)}
      />
      <FormSheet visible={open} title="New book" onClose={() => setOpen(false)} onSubmit={save} submitLabel="Add book" busy={actions.createBook.isPending} error={error}>
        <Input label="Title" value={form.title} onChangeText={(v) => set('title', v)} />
        <Select label="Class" searchable value={form.classObj} onChange={(v) => set('classObj', v)} placeholder="Choose a class"
          options={(classes.data ?? []).map((c) => ({ value: Number(c.id), label: String(c.name) }))} />
        <Select label="Subject" searchable value={form.subject} onChange={(v) => set('subject', v)} placeholder="Choose a subject"
          options={(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <Input label="Author (optional)" value={form.author} onChangeText={(v) => set('author', v)} />
        <Input label="Publisher (optional)" value={form.publisher} onChangeText={(v) => set('publisher', v)} />
        <Input label="Edition (optional)" value={form.edition} onChangeText={(v) => set('edition', v)} />
        <Select label="Language" value={form.language} onChange={(v) => set('language', v)} options={LANGUAGES.map((l) => ({ value: l.value, label: l.label }))} />
      </FormSheet>
    </>
  );
}
