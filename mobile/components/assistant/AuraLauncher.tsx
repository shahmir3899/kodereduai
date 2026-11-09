import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { useAuth } from '../../contexts/AuthContext';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { assistantApi } from '../../services/assistantApi';
import { clampDrag, DEFAULT_SPOT, isTap, parseSpot, positionFor, spotFromDrop, type FabBounds, type FabSpot } from '../../services/assistantFab';
import { assistantEnabled } from '../../services/assistantFlag';

// The five bars of the Talk orb, drawn small, so the button and the Talk screen look like one thing.
const BARS = [0.38, 0.62, 0.9, 0.62, 0.38];
const SPOT_KEY = 'aura_fab_spot'; // side + height, remembered per phone
const BOX_W = 56;
const BOX_H = 74; // the round button plus its label

// Floating entry point, mounted once in RoleGuard so every role shell gets it. It asks the server what Aura
// can do for THIS person and shows nothing when the answer is empty (drivers, a school with Aura off).
// Tap opens Aura; press and drag moves it, and on release it settles against the nearer side edge.
export default function AuraLauncher() {
  const { isAuthenticated } = useAuth();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const pathname = usePathname();
  const on = assistantEnabled() && isAuthenticated;
  const caps = useScopedQuery<any>('assistant-capabilities', [], async () => (await assistantApi.capabilities()).data, {
    enabled: on, staleTime: 5 * 60 * 1000, retry: false,
  });
  const visible = on && caps.data?.agents?.length > 0 && !pathname.startsWith('/aura');

  const bounds: FabBounds = useMemo(() => ({
    width, height, boxW: BOX_W, boxH: BOX_H, margin: 16, top: insets.top + 8, bottomReserve: insets.bottom + 84,
  }), [width, height, insets.top, insets.bottom]);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  const [spot, setSpot] = useState<FabSpot>(DEFAULT_SPOT);
  const spotRef = useRef(spot);
  spotRef.current = spot;
  useEffect(() => {
    AsyncStorage.getItem(SPOT_KEY).then((raw) => { const s = parseSpot(raw); if (s) setSpot(s); }).catch(() => {});
  }, []);

  const home = positionFor(spot, bounds);
  const drag = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, y: 0 });

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      const p = positionFor(spotRef.current, boundsRef.current);
      start.current = p;
      drag.stopAnimation();
      drag.setValue({ x: 0, y: 0 });
    },
    onPanResponderMove: (_e, g) => {
      if (isTap(g.dx, g.dy)) return;
      setDragging(true);
      const c = clampDrag(start.current.x + g.dx, start.current.y + g.dy, boundsRef.current);
      drag.setValue({ x: c.x - start.current.x, y: c.y - start.current.y });
    },
    onPanResponderRelease: (_e, g) => {
      setDragging(false);
      if (isTap(g.dx, g.dy)) { router.push('/aura'); return; }
      const b = boundsRef.current;
      const c = clampDrag(start.current.x + g.dx, start.current.y + g.dy, b);
      const next = spotFromDrop(c.x, c.y, b);
      const target = positionFor(next, b);
      Animated.spring(drag, { toValue: { x: target.x - start.current.x, y: target.y - start.current.y }, useNativeDriver: true, bounciness: 6 }).start(() => {
        setSpot(next);
        drag.setValue({ x: 0, y: 0 });
      });
      AsyncStorage.setItem(SPOT_KEY, JSON.stringify(next)).catch(() => {});
    },
    onPanResponderTerminate: () => { setDragging(false); Animated.spring(drag, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start(); },
  }), [drag]);

  // A slow breathing ring says "I am here"; it rests while the button is being moved.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible || dragging) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [visible, dragging, pulse]);

  if (!visible) return null;
  const ring = { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }] };

  return (
    <Animated.View
      {...responder.panHandlers}
      accessible accessibilityRole="button" accessibilityLabel="Open Aura assistant" accessibilityHint="Drag to move the button"
      accessibilityActions={[{ name: 'activate' }]} onAccessibilityAction={() => router.push('/aura')}
      style={[styles.wrap, { left: home.x, top: home.y, transform: drag.getTranslateTransform(), opacity: dragging ? 0.9 : 1 }]}
    >
      <Animated.View pointerEvents="none" style={[styles.ring, ring]} />
      <View style={[styles.fab, dragging && styles.fabLifted]}>
        <View style={styles.bars}>
          {BARS.map((h, i) => <View key={i} style={[styles.bar, { height: 22 * h }]} />)}
        </View>
      </View>
      <Text style={styles.label}>Aura</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', width: BOX_W, alignItems: 'center', gap: 2 },
  ring: { position: 'absolute', top: 0, width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.secondary },
  fab: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.secondary, alignItems: 'center', justifyContent: 'center',
    elevation: 6, shadowColor: Colors.shadow, shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
    borderWidth: 2, borderColor: Colors.secondaryLight,
  },
  fabLifted: { elevation: 12, shadowOpacity: 0.4, shadowRadius: 10 },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  bar: { width: 3.5, borderRadius: 2, backgroundColor: Colors.textInverse },
  label: { fontSize: 11, fontWeight: '700', color: Colors.secondary },
});
