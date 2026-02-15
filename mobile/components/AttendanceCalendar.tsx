import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/colors';

interface AttendanceDay {
  date: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE' | null;
}

interface AttendanceCalendarProps {
  days: AttendanceDay[];
  month: number;
  year: number;
}

const STATUS_COLORS: Record<string, string> = {
  PRESENT: Colors.present,
  ABSENT: Colors.absent,
  LATE: Colors.late,
  LEAVE: Colors.leave,
};

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export default function AttendanceCalendar({ days, month, year }: AttendanceCalendarProps) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });

  const dayMap = new Map(days.map((d) => [new Date(d.date).getDate(), d.status]));

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  // Stats
  const present = days.filter((d) => d.status === 'PRESENT').length;
  const absent = days.filter((d) => d.status === 'ABSENT').length;
  const late = days.filter((d) => d.status === 'LATE').length;
  const leave = days.filter((d) => d.status === 'LEAVE').length;

  return (
    <View style={styles.container}>
      <Text style={styles.monthTitle}>
        {monthName} {year}
      </Text>

      {/* Day headers */}
      <View style={styles.row}>
        {DAY_LABELS.map((label) => (
          <View key={label} style={styles.cell}>
            <Text style={styles.dayLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Calendar grid */}
      <View style={styles.grid}>
        {cells.map((day, index) => (
          <View key={index} style={styles.cell}>
            {day !== null ? (
              <View
                style={[
                  styles.dayCircle,
                  dayMap.has(day) && {
                    backgroundColor: STATUS_COLORS[dayMap.get(day)!] || Colors.surfaceSecondary,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.dayText,
                    dayMap.has(day) && { color: Colors.textInverse },
                  ]}
                >
                  {day}
                </Text>
              </View>
            ) : null}
          </View>
        ))}
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <LegendItem color={Colors.present} label={`Present (${present})`} />
        <LegendItem color={Colors.absent} label={`Absent (${absent})`} />
        <LegendItem color={Colors.late} label={`Late (${late})`} />
        <LegendItem color={Colors.leave} label={`Leave (${leave})`} />
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
  },
  monthTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  row: {
    flexDirection: 'row',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: '14.28%',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  dayLabel: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    fontWeight: '600',
  },
  dayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceSecondary,
  },
  dayText: {
    fontSize: FontSize.sm,
    color: Colors.text,
    fontWeight: '500',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    marginTop: Spacing.lg,
    justifyContent: 'center',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
});
