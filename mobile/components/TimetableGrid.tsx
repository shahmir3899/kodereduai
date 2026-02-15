import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/colors';

interface TimetableEntry {
  day: string;
  slot_name?: string;
  start_time: string;
  end_time: string;
  subject_name: string;
  teacher_name?: string;
}

interface TimetableGridProps {
  entries: TimetableEntry[];
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT: Record<string, string> = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
};

const SUBJECT_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

export default function TimetableGrid({ entries }: TimetableGridProps) {
  const grouped = DAYS.reduce<Record<string, TimetableEntry[]>>((acc, day) => {
    acc[day] = entries
      .filter((e) => e.day === day)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    return acc;
  }, {});

  const subjectColorMap = new Map<string, string>();
  let colorIndex = 0;
  entries.forEach((e) => {
    if (!subjectColorMap.has(e.subject_name)) {
      subjectColorMap.set(e.subject_name, SUBJECT_COLORS[colorIndex % SUBJECT_COLORS.length]);
      colorIndex++;
    }
  });

  if (entries.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No timetable available</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {DAYS.map((day) => {
        const dayEntries = grouped[day];
        if (!dayEntries || dayEntries.length === 0) return null;

        return (
          <View key={day} style={styles.daySection}>
            <Text style={styles.dayTitle}>{DAY_SHORT[day] || day}</Text>
            <View style={styles.entries}>
              {dayEntries.map((entry, idx) => {
                const color = subjectColorMap.get(entry.subject_name) || Colors.primary;
                return (
                  <View key={idx} style={[styles.entry, { borderLeftColor: color }]}>
                    <Text style={styles.time}>
                      {entry.start_time.slice(0, 5)} - {entry.end_time.slice(0, 5)}
                    </Text>
                    <Text style={styles.subject}>{entry.subject_name}</Text>
                    {entry.teacher_name && (
                      <Text style={styles.teacher}>{entry.teacher_name}</Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  daySection: {
    marginBottom: Spacing.lg,
  },
  dayTitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  entries: {
    gap: Spacing.sm,
  },
  entry: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    borderLeftWidth: 3,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  time: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    fontWeight: '500',
  },
  subject: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
    marginTop: 2,
  },
  teacher: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  empty: {
    alignItems: 'center',
    padding: Spacing.xxxl,
  },
  emptyText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
});
