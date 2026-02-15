import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function PaymentResult() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Payment Result</Text>
      <Text style={styles.subtitle}>Coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 14, color: '#64748b', marginTop: 8 },
});
