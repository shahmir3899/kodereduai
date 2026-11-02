import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { tasksApi } from '../../services/api';
import { routeFor } from '../../navigation/routes';
import { insightList, insightsToggleLabel, insightTone, moduleLabel, visibleInsights, type Insight } from '../../services/aiInsights';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import Card from '../ui/Card';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Short notices the server builds for the school, as on the web home. Shows nothing while loading,
// on a failure, or when there is nothing to say, so it never takes space for no reason.
export default function AIInsightsCard() {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const q = useScopedQuery('aiInsights', [], async () => insightList((await tasksApi.getAIInsights()).data), { staleTime: 5 * 60_000, retry: false });
  const list = q.data ?? [];
  if (list.length === 0) return null;

  const open = (i: Insight) => {
    const route = i.link ? routeFor('admin', i.link.split('?')[0]) : undefined;
    if (route) router.push(route as Href);
  };
  const toggle = insightsToggleLabel(list.length, expanded);

  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.section}>AI insights ({list.length})</Text>
        {toggle ? <TouchableOpacity accessibilityRole="button" onPress={() => setExpanded((e) => !e)}><Text style={styles.link}>{toggle}</Text></TouchableOpacity> : null}
      </View>
      {visibleInsights(list, expanded).map((i, idx) => {
        const route = i.link ? routeFor('admin', i.link.split('?')[0]) : undefined;
        return (
          <TouchableOpacity key={idx} accessibilityRole={route ? 'button' : 'text'} disabled={!route} onPress={() => open(i)}>
            <Card style={styles.card}>
              <View style={styles.top}>
                <Text style={styles.title} numberOfLines={2}>{i.title}</Text>
                <StatusPill label={i.type === 'alert' ? 'Alert' : i.type === 'warning' ? 'Warning' : 'Info'} tone={insightTone(i.type)} />
              </View>
              {i.detail ? <Text style={styles.detail}>{i.detail}</Text> : null}
              {i.module ? <Text style={styles.module}>{moduleLabel(i.module)}{route && i.action ? `  ·  ${i.action}` : ''}</Text> : null}
            </Card>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.xl, marginBottom: Spacing.md },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text },
  link: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  card: { marginBottom: Spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  title: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  detail: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.xs },
  module: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: Spacing.xs },
});
