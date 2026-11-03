import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Card from '../ui/Card';
import CopyableNumber from '../ui/CopyableNumber';
import { useChildKuickpayBill } from '../../hooks/useParent';
import { kuickpayBillCard } from '../../services/kuickpayBill';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// The child's current Kuickpay bill, for the parent to pay from. Shows nothing while loading, on an
// error, for a school without Kuickpay, or when there is no open bill: the fees list below stands alone.
export default function KuickpayBillCard({ studentId }: { studentId: number }) {
  const { data } = useChildKuickpayBill(studentId);
  const card = kuickpayBillCard(data);
  if (!card) return null;

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{card.title}</Text>
        <Text style={styles.month}>Bill for {card.month}</Text>
      </View>
      {card.kind === 'pay' ? (
        <>
          <Text style={styles.label}>Consumer number</Text>
          <CopyableNumber value={card.number} textStyle={styles.number} />
          <Text style={styles.amount}>Amount to pay: <Text style={styles.amountValue}>{card.amount}</Text></Text>
          {card.processing ? <Text style={styles.note}>{card.processing} is still being processed.</Text> : null}
          <Text style={styles.note}>{card.note}</Text>
        </>
      ) : card.kind === 'suspended' ? (
        <Text style={styles.body}>{card.message}</Text>
      ) : (
        <Text style={styles.body}>Nothing is due on the {card.month} bill.</Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Spacing.md, gap: Spacing.xs },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  month: { fontSize: FontSize.xs, color: Colors.textSecondary },
  label: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: Spacing.xs },
  number: { fontSize: FontSize.xl, fontWeight: '700' },
  amount: { fontSize: FontSize.sm, color: Colors.text, marginTop: Spacing.sm },
  amountValue: { fontWeight: '700' },
  note: { fontSize: FontSize.xs, color: Colors.textSecondary },
  body: { fontSize: FontSize.sm, color: Colors.text, marginTop: Spacing.xs },
});
