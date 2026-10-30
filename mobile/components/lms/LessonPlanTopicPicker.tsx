import React from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import BottomSheet from '../ui/BottomSheet';
import Button from '../ui/Button';
import { toggleChapter, toggleId, type BookChoice } from '../../services/lessonPlanTools';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Tick the book topics a lesson covers (or a whole chapter). The same topics feed the AI draft
// and the syllabus coverage on the web.
export default function LessonPlanTopicPicker({ visible, books, loading, value, onChange, onClose }: {
  visible: boolean; books: BookChoice[]; loading: boolean; value: number[]; onChange: (ids: number[]) => void; onClose: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Topics from the book">
      <ScrollView contentContainerStyle={styles.body}>
        {loading ? <Text style={styles.muted}>Loading…</Text> : books.length === 0 ? (
          <Text style={styles.muted}>No book with topics is set up for this class and subject. Add a book and its chapters under Curriculum.</Text>
        ) : books.map((b) => (
          <View key={b.id}>
            <Text style={styles.book}>{b.title}</Text>
            {b.chapters.map((c) => {
              const all = c.topics.every((t) => value.includes(t.id));
              return (
                <View key={c.id} style={styles.chapter}>
                  <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: all }} style={styles.row} onPress={() => onChange(toggleChapter(value, c))}>
                    <Text style={styles.check}>{all ? '☑' : '☐'}</Text>
                    <Text style={styles.chapterTitle}>{c.chapter_number != null ? `${c.chapter_number}. ` : ''}{c.title}</Text>
                  </TouchableOpacity>
                  {c.topics.map((t) => {
                    const on = value.includes(t.id);
                    return (
                      <TouchableOpacity key={t.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={[styles.row, styles.topic]} onPress={() => onChange(toggleId(value, t.id))}>
                        <Text style={styles.check}>{on ? '☑' : '☐'}</Text>
                        <Text style={styles.topicTitle}>{t.title}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })}
          </View>
        ))}
        <Button title={`Done (${value.length} chosen)`} onPress={onClose} />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.xs },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  book: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginTop: Spacing.sm },
  chapter: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.xs, marginTop: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 44 },
  topic: { paddingLeft: Spacing.lg },
  check: { fontSize: FontSize.lg, color: Colors.primary },
  chapterTitle: { flex: 1, fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  topicTitle: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
});
