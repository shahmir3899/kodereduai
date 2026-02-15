import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Alert } from 'react-native';
import { libraryApi } from '../../../services/api';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

interface SearchResult { id: number; name: string; class_name?: string; roll_number?: string; title?: string; isbn?: string; available_copies?: number; }

export default function LibraryIssue() {
  const [studentSearch, setStudentSearch] = useState('');
  const [bookSearch, setBookSearch] = useState('');
  const [students, setStudents] = useState<SearchResult[]>([]);
  const [books, setBooks] = useState<SearchResult[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<SearchResult | null>(null);
  const [selectedBook, setSelectedBook] = useState<SearchResult | null>(null);
  const [issuing, setIssuing] = useState(false);

  const searchStudents = async () => {
    if (!studentSearch.trim()) return;
    try {
      const response = await libraryApi.searchStudents({ search: studentSearch.trim() });
      setStudents(response.data.results || response.data || []);
    } catch (error) { console.error('Failed to search students:', error); }
  };

  const searchBooks = async () => {
    if (!bookSearch.trim()) return;
    try {
      const response = await libraryApi.getBooks({ search: bookSearch.trim() });
      setBooks(response.data.results || response.data || []);
    } catch (error) { console.error('Failed to search books:', error); }
  };

  const handleIssue = async () => {
    if (!selectedStudent || !selectedBook) {
      Alert.alert('Required', 'Please select both a student and a book.');
      return;
    }
    setIssuing(true);
    try {
      await libraryApi.createIssue({ student_id: selectedStudent.id, book_id: selectedBook.id });
      Alert.alert('Success', `Book issued to ${selectedStudent.name} successfully.`);
      setSelectedStudent(null); setSelectedBook(null);
      setStudentSearch(''); setBookSearch('');
      setStudents([]); setBooks([]);
    } catch (error) {
      console.error('Failed to issue book:', error);
      Alert.alert('Error', 'Failed to issue book.');
    } finally { setIssuing(false); }
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
      <Button title="Issue Book" onPress={handleIssue} loading={issuing}
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
