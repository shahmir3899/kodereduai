import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import { themeFor } from '../../services/assistantTheme';
import { ORB_LABEL, type TalkPhase } from '../../services/assistantTalk';

const BLUE = { ring: '#378ADD', fill: '#E6F1FB', ink: '#185FA5' };
const RED = { ring: '#E24B4A', fill: '#FCEBEB', ink: '#A32D2D' };
const SLATE = { ring: '#94A3B8', fill: '#F1F5F9', ink: '#334155' };
const SHAPE = [0.38, 0.62, 0.9, 0.62, 0.38]; // bar heights as a share of the core, as on the web

function loop(value: Animated.Value, ms: number, delay = 0) {
  const a = Animated.loop(Animated.sequence([
    Animated.delay(delay),
    Animated.timing(value, { toValue: 1, duration: ms, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    Animated.timing(value, { toValue: 0, duration: ms, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
  ]));
  a.start();
  return a;
}

/**
 * The big orb of Talk mode, drawn with plain views (no extra package). Six states:
 * ready (calm blue), listening (red, rings swell with the voice), transcribing (grey, turning),
 * heard (small, waiting to send), thinking (the working agent's colour, turning, three dots),
 * speaking (blue, bars moving). It is a button only when tapping it means something.
 */
export default function TalkOrb({ phase, level = 0, agent, onPress, size = 168 }: {
  phase: TalkPhase; level?: number; agent?: string; onPress?: () => void; size?: number;
}) {
  const t = themeFor(agent);
  const palette = phase === 'listening' ? RED : phase === 'thinking' ? t : phase === 'transcribing' ? SLATE : BLUE;
  const tappable = phase === 'ready' || phase === 'listening' || phase === 'speaking';
  const turning = phase === 'thinking' || phase === 'transcribing';
  const px = phase === 'heard' ? Math.round(size * 0.55) : size;

  const spin = useRef(new Animated.Value(0)).current;
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  const bars = useRef(SHAPE.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const running: Animated.CompositeAnimation[] = [];
    if (turning) {
      spin.setValue(0);
      const a = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true }));
      a.start(); running.push(a);
      dots.forEach((d, i) => running.push(loop(d, 450, i * 180)));
    }
    if (phase === 'speaking') bars.forEach((b, i) => running.push(loop(b, 380, i * 110)));
    return () => running.forEach((a) => a.stop());
  }, [turning, phase, spin, dots, bars]);

  const swell = phase === 'listening' ? 1 + Math.min(level, 1) * 0.14 : 1;
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const ring = (frac: number, width: number, opacity: number, dashed?: boolean) => ({
    position: 'absolute' as const, width: px * frac, height: px * frac, borderRadius: px, borderWidth: width,
    borderColor: palette.ring, opacity, borderStyle: dashed ? ('dashed' as const) : ('solid' as const),
  });
  const core = px * 0.625;

  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={ORB_LABEL[phase]} accessibilityState={{ disabled: !tappable }}
      disabled={!tappable} onPress={onPress} testID={`talk-orb-${phase}`}
      style={{ width: px, height: px, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={[ring(0.95, 1, 0.3), { transform: [{ scale: swell }] }]} />
      <Animated.View style={[ring(0.8, 2, turning ? 1 : 0.55, turning), turning && { transform: [{ rotate }] }, phase === 'listening' && { transform: [{ scale: 1 + Math.min(level, 1) * 0.08 }] }]} />
      <View style={{ width: core, height: core, borderRadius: core, backgroundColor: palette.fill, borderWidth: 1.8, borderColor: palette.ink, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: core * 0.07 }}>
        {turning ? dots.map((d, i) => (
          <Animated.View key={i} style={{ width: core * 0.1, height: core * 0.1, borderRadius: core, backgroundColor: palette.ink, opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }} />
        )) : SHAPE.map((share, i) => {
          const live = phase === 'listening' ? Math.max(0.14, Math.min(1, share * (0.35 + level * 1.4))) : share;
          const h = core * 0.56 * live;
          const anim = phase === 'speaking' ? { transform: [{ scaleY: bars[i].interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) }] } : null;
          return <Animated.View key={i} style={[{ width: core * 0.08, height: h, borderRadius: core, backgroundColor: palette.ink }, anim]} />;
        })}
      </View>
    </Pressable>
  );
}
