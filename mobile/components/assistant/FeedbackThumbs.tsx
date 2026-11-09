import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, FontSize, Spacing } from '../../constants/colors';
import { assistantApi } from '../../services/assistantApi';

/** Thumbs up/down. Shown only when Aura could not help, or after a card was approved or rejected, so it stays a signal. */
export default function FeedbackThumbs({ messageId, label = 'Was this helpful?' }: { messageId?: number | string; label?: string }) {
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!messageId) return null;

  const send = async (rating: 1 | -1) => {
    setFailed(false);
    try {
      await assistantApi.sendFeedback({ message_id: messageId, rating });
      setSent(true);
    } catch {
      setFailed(true);
    }
  };

  if (sent) return <Text style={styles.small}>Thanks for the feedback.</Text>;
  return (
    <View style={styles.row} accessibilityLabel={label}>
      <Text style={styles.small}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Helpful" onPress={() => send(1)} hitSlop={8} style={styles.btn}><Text>👍</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Not helpful" onPress={() => send(-1)} hitSlop={8} style={styles.btn}><Text>👎</Text></Pressable>
      {failed && <Text style={[styles.small, { color: Colors.errorText }]}>Could not send.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  small: { fontSize: FontSize.xs, color: Colors.textSecondary },
  btn: { paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
});
