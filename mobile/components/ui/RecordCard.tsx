import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Avatar from './Avatar';
import Card from './Card';
import StatusPill from './StatusPill';
import { Colors, FontSize, Spacing } from '../../constants/colors';

type Tone = React.ComponentProps<typeof StatusPill>['tone'];

interface RecordCardProps {
  title: string;
  subtitle?: string;
  // A second, smaller line (department, phone, fee line).
  meta?: string;
  // Photo when there is one, otherwise initials; leave out `name` to hide the avatar.
  avatarName?: string;
  avatarUri?: string | null;
  status?: { label: string; tone?: Tone };
  // Right-hand text such as an amount; shown under the status pill.
  trailing?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}

// The one list-row card for people and records: avatar, title and subtitle, status pill, optional
// right-hand text. Mirrors the web's RecordCard so lists look the same in both apps.
export default function RecordCard({ title, subtitle, meta, avatarName, avatarUri, status, trailing, onPress, accessibilityLabel }: RecordCardProps) {
  const body = (
    <Card style={styles.card}>
      {avatarName ? <Avatar name={avatarName} uri={avatarUri} size={44} /> : null}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        {meta ? <Text style={styles.meta} numberOfLines={1}>{meta}</Text> : null}
      </View>
      {status || trailing ? (
        <View style={styles.right}>
          {status ? <StatusPill label={status.label} tone={status.tone} /> : null}
          {trailing ? <Text style={styles.trailing}>{trailing}</Text> : null}
        </View>
      ) : null}
      {onPress ? <Text style={styles.chevron} accessible={false}>›</Text> : null}
    </Card>
  );
  if (!onPress) return body;
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} onPress={onPress} activeOpacity={0.7}>
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.sm, minHeight: 56 },
  info: { flex: 1 },
  title: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  subtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  meta: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 4 },
  trailing: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  chevron: { fontSize: FontSize.xl, color: Colors.textTertiary },
});
