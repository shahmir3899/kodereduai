import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import StatusPill from '../ui/StatusPill';
import { kuickpayNote, type KuickpayReceived } from '../../services/feeCollect';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// "PKR 6,500 received via Kuickpay (paid in full)" and the Kuickpay reference, under a fee record.
export default function KuickpayReceivedLabel({ kuickpay }: { kuickpay?: KuickpayReceived | null }) {
  const note = kuickpayNote({ kuickpay });
  if (!note) return null;
  return (
    <View style={styles.wrap} testID="kuickpay-received">
      <StatusPill label={note.label} tone={note.tone} />
      <Text style={styles.reference}>{note.reference}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: Spacing.xs, gap: 2 },
  reference: { fontSize: FontSize.xs, color: Colors.textSecondary },
});
