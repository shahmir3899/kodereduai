import React from 'react';
import { View } from 'react-native';
import StatusPill, { type Tone } from '../ui/StatusPill';
import type { Scope } from '../../services/teacherScope';

const TONE: Record<Scope['kind'], Tone> = { class: 'success', subject: 'warning', out: 'error' };

// "Class teacher" / "Subject teacher" next to a row, so a teacher sees why it is theirs. Nothing
// shows for anyone who is not a teacher (the scope is null).
export default function ScopeBadge({ scope }: { scope: Scope | null }) {
  if (!scope) return null;
  return (
    <View accessible accessibilityLabel={`${scope.label}. ${scope.detail}`}>
      <StatusPill label={scope.label} tone={TONE[scope.kind]} />
    </View>
  );
}
