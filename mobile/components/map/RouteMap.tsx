import React from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { parseMapMessage, type MapMessage } from '../../services/routeMap';
import { Colors, BorderRadius } from '../../constants/colors';

interface Props { html: string; height?: number; onMessage?: (m: MapMessage) => void }

// The map page (Leaflet and OpenStreetMap tiles) in a WebView. It needs an internet connection for the
// tiles. The web preview uses RouteMap.web.tsx, which shows the same page in a frame.
export default function RouteMap({ html, height = 320, onMessage }: Props) {
  return (
    <View style={[styles.box, { height }]}>
      <WebView
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://localhost/' }}
        javaScriptEnabled
        domStorageEnabled
        nestedScrollEnabled
        onMessage={(e: WebViewMessageEvent) => { const m = parseMapMessage(e.nativeEvent.data); if (m && onMessage) onMessage(m); }}
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: BorderRadius.md, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  web: { flex: 1 },
});
