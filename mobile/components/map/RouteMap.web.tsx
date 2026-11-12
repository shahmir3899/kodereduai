import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { parseMapMessage, type MapMessage } from '../../services/routeMap';
import { Colors, BorderRadius } from '../../constants/colors';

interface Props { html: string; height?: number; onMessage?: (m: MapMessage) => void }

// The browser version of the map: the same page in a frame (react-native-webview has no web build).
export default function RouteMap({ html, height = 320, onMessage }: Props) {
  const frame = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const listen = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const m = parseMapMessage(e.data);
      if (m && onMessage) onMessage(m);
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [onMessage]);

  return (
    <View style={[styles.box, { height }]}>
      {React.createElement('iframe', { ref: frame, srcDoc: html, title: 'Route map', style: { border: 0, width: '100%', height: '100%' } })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: BorderRadius.md, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
});
