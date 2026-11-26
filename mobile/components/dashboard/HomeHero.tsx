import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MenuButton from '../nav/MenuButton';
import HeaderActions from '../nav/HeaderActions';
import SchoolSwitcher from '../nav/SchoolSwitcher';
import type { Tile } from './StatTiles';
import { greetingFor, HERO_MAX } from '../../services/homeHero';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const TONE: Record<NonNullable<Tile['tone']>, string> = {
  good: Colors.successText,
  warn: Colors.warningText,
  bad: Colors.errorText,
};

// Every role's Home starts with this: a blue band (the white header is hidden on Home, so the menu
// button, year, bell and photo sit on it), the greeting and school, and a white card overlapping
// the band's bottom edge with the role's key figures. Figures come only from data the Home
// already loads. It must be the first child of a ScrollView whose content has Spacing.lg padding:
// it pulls itself out to the screen edges.
export default function HomeHero({ name, subtitle, stats = [], onPress }: {
  name: string;
  // A line under the school name (class and roll number, children linked...).
  subtitle?: string;
  stats?: Tile[];
  onPress?: (route: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const shown = stats.slice(0, HERO_MAX);
  const twoRows = shown.length === 4;
  return (
    <View style={styles.bleed}>
      {/* White status bar text only while Home is on screen. */}
      {focused ? <StatusBar style="light" /> : null}
      <LinearGradient colors={[Colors.primary, Colors.primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[styles.band, { paddingTop: insets.top + Spacing.xs }, shown.length > 0 && styles.bandWithCard]}>
        <View style={styles.bar}>
          <MenuButton color={Colors.textInverse} />
          <View style={styles.flex} />
          <HeaderActions light />
        </View>
        <Text style={styles.greeting} numberOfLines={2} accessibilityRole="header">
          {greetingFor(new Date().getHours())}, {name}
        </Text>
        <SchoolSwitcher light />
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </LinearGradient>
      {shown.length > 0 ? (
        <View style={[styles.card, twoRows && styles.cardGrid]}>
          {shown.map((t, i) => {
            const tappable = !!t.route && !!onPress;
            return (
              <TouchableOpacity key={t.label} accessibilityRole={tappable ? 'button' : 'text'}
                accessibilityLabel={`${t.label}: ${t.value ?? 'not available'}`} disabled={!tappable}
                onPress={() => t.route && onPress?.(t.route)}
                style={[styles.stat, twoRows ? styles.statGrid : i > 0 && styles.statDivider]}>
                <Text style={[styles.value, t.tone && { color: TONE[t.tone] }]} numberOfLines={1} adjustsFontSizeToFit>{t.value ?? '–'}</Text>
                <Text style={styles.label} numberOfLines={2}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// Home's loading and error states: Home has no white header, so they keep the banner (and with it
// the menu button) above them.
export function HomeShell({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <ScrollView style={styles.shell} contentContainerStyle={styles.shellContent}>
      <HomeHero name={name} />
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: Colors.background },
  shellContent: { padding: Spacing.lg },
  bleed: { marginHorizontal: -Spacing.lg, marginTop: -Spacing.lg, marginBottom: Spacing.md },
  band: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  // Room under the text for the card to overlap.
  bandWithCard: { paddingBottom: 56 },
  bar: { flexDirection: 'row', alignItems: 'center', marginLeft: -Spacing.sm, marginRight: -Spacing.md, marginBottom: Spacing.sm },
  flex: { flex: 1 },
  greeting: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.textInverse, marginBottom: 2 },
  subtitle: { fontSize: FontSize.sm, color: 'rgba(255, 255, 255, 0.85)', marginTop: 2 },
  card: {
    flexDirection: 'row',
    marginHorizontal: Spacing.lg,
    marginTop: -40,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    ...Platform.select({
      web: { boxShadow: '0 6px 18px rgba(15, 23, 42, 0.12)' } as object,
      default: { shadowColor: Colors.shadow, shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
    }),
  },
  cardGrid: { flexWrap: 'wrap', paddingVertical: Spacing.xs },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: Spacing.sm, minHeight: 44, justifyContent: 'center' },
  statDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: Colors.border },
  statGrid: { flexBasis: '50%', flexGrow: 0, paddingVertical: Spacing.sm },
  value: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.primary },
  label: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2, textAlign: 'center' },
});
