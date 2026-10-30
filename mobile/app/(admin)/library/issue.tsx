import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { libraryApi } from '../../../services/api';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import { useToast } from '../../../components/ui/Toast';
import { saveFailureMessage } from '../../../services/errorKind';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

interface SearchResult { id: number; name: string; class_name?: string; roll_number?: string; title?: string; isbn?: string; available_copies?: number; }

export default function LibraryIssue() {
  const [studentSearch, setStudentSearch] = useState('');
  const [bookSearch, setBookSearch] = useState('');
  const [students, setStudents] = useState<SearchResult[]>([]);
  const [books, setBooks] = useState<SearchResult[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<SearchResult | null>(null);
  const [selectedBook, setSelectedBook] = useState<SearchResult | null>(null);
  const toast = useToast();

  const searchStudents = async () => {
    if (!studentSearch.trim()) return;
    try {
      const response = await libraryApi.searchStudents({ search: studentSearch.trim() });
      setStudents(response.data.results || response.data || []);
    } catch (error) { toast.error(saveFailureMessage(error, 'Could not search students.')); }
  };

  const searchBooks = async () => {
    if (!bookSearch.trim()) return;
    try {
      const response = await libraryApi.getBooks({ search: bookSearch.trim() });
      setBooks(response.data.results || response.data || []);
    } catch (error) { toast.error(saveFailureMessage(error, 'Could not search books.')); }
  };

  const issue = useMutation({
    mutationFn: (v: { studentId: number; bookId: number }) => libraryApi.createIssue({ student_id: v.studentId, book_id: v.bookId }),
    onSuccess: () => {
      toast.success(`Book issued to ${selectedStudent?.name}.`);
      setSelectedStudent(null); setSelectedBook(null);
      setStudentSearch(''); setBookSearch('');
      setStudents([]); setBooks([]);
    },
    onError: (e) => toast.error(saveFailureMessage(e, 'Could not issue the book.')),
  });

  const handleIssue = () => {
    if (!selectedStudent || !selectedBook) { toast.error('Select both a student and a book.'); return; }
    issue.mutate({ studentId: selectedStudent.id, bookId: selectedBook.id });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Library Quick Issue</Text>

      {/* Step 1: Search Student */}
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>1. Select Student</Text>
        {selectedStudent ? (
          <View style={styles.selectedRow}>
            <Text style={styles.selectedName}>{selectedStudent.name} ({selectedStudent.class_name})</Text>
            <Button title="Change" variant="outline" size="sm" onPress={() => { setSelectedStudent(null); setStudents([]); }} />
          </View>
        ) : (
          <>
            <View style={styles.searchRow}>
              <TextInput style={styles.input} placeholder="Search student..." placeholderTextColor={Colors.placeholder}
                value={studentSearch} onChangeText={setStudentSearch} />
              <Button title="Search" size="sm" onPress={searchStudents} />
            </View>
            {students.map((s) => (
              <Button key={s.id} title={`${s.name} (${s.class_name || 'N/A'})`} variant="ghost" size="sm"
                onPress={() => { setSelectedStudent(s); setStudents([]); }} style={styles.resultBtn} />
            ))}
          </>
        )}
      </Card>

      {/* Step 2: Search Book */}
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>2. Select Book</Text>
        {selectedBook ? (
          <View style={styles.selectedRow}>
            <Text style={styles.selectedName}>{selectedBook.title}</Text>
            <Button title="Change" variant="outline" size="sm" onPress={() => { setSelectedBook(null); setBooks([]); }} />
          </View>
        ) : (
          <>
            <View style={styles.searchRow}>
              <TextInput style={styles.input} placeholder="Search book..." placeholderTextColor={Colors.placeholder}
                value={bookSearch} onChangeText={setBookSearch} />
              <Button title="Search" size="sm" onPress={searchBooks} />
            </View>
            {books.map((b) => (
              <Button key={b.id} title={`${b.title} (${b.available_copies ?? '?'} available)`} variant="ghost" size="sm"
                onPress={() => { setSelectedBook(b); setBooks([]); }} style={styles.resultBtn} />
            ))}
          </>
        )}
      </Card>

      {/* Step 3: Issue */}
      <Button title="Issue Book" onPress={handleIssue} loading={issue.isPending}
        disabled={!selectedStudent || !selectedBook} style={styles.issueBtn} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.lg },
  section: { marginBottom: Spacing.lg },
  sectionTitle: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text, marginBottom: Spacing.md },
  searchRow: { flexDirection: 'row', gap: Spacing.sm },
  input: { flex: 1, backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.md, fontSize: FontSize.sm, color: Colors.text, borderWidth: 1, borderColor: Colors.border },
  selectedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectedName: { fontSize: FontSize.md, fontWeight: '600', color: Colors.primary, flex: 1 },
  resultBtn: { marginTop: Spacing.xs },
  issueBtn: { marginTop: Spacing.lg },
});
