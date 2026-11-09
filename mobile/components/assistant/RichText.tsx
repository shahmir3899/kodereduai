import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Colors, FontSize, Spacing } from '../../constants/colors';
import { splitBlocks } from '../../services/assistantRichText';

const numeric = (v: string) => /^[\s\-+]?[\d,.]+\s*%?$/.test(v);

/** Plain text, with markdown tables drawn as real tables that scroll sideways when they are wide. */
export default function RichText({ text, color = Colors.text }: { text: string; color?: string }) {
  const blocks = splitBlocks(text);
  return (
    <View>
      {blocks.map((b, i) => {
        if (b.type === 'text') {
          const t = b.text.replace(/^\n+|\n+$/g, '');
          return t ? <Text key={i} selectable style={[styles.text, { color }]}>{t}</Text> : null;
        }
        return (
          <ScrollView key={i} horizontal style={styles.tableWrap} accessibilityLabel="Table">
            <View>
              <View style={styles.row}>
                {b.head.map((h, k) => <Text key={k} style={[styles.cell, styles.headCell]}>{h}</Text>)}
              </View>
              {b.rows.map((r, k) => (
                <View key={k} style={styles.row}>
                  {b.head.map((_, c) => (
                    <Text key={c} style={[styles.cell, numeric(r[c] ?? '') && styles.num]}>{r[c] ?? ''}</Text>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: FontSize.md, lineHeight: 22 },
  tableWrap: { marginVertical: Spacing.xs },
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  cell: { minWidth: 80, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, fontSize: FontSize.xs, color: Colors.text },
  headCell: { fontWeight: '700', color: Colors.textSecondary },
  num: { textAlign: 'right' },
});
