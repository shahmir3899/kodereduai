import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { pickedBlock, previewPage } from '../../../services/blockPaper';
import { Colors } from '../../../constants/colors';

const WAITING = '<p style="font-family:sans-serif;color:#64748b;padding:16px">Making the preview…</p>';

interface Props {
  html: string;
  height: number;
  /** The question to keep in view (the one being written). */
  show?: string | null;
  /** A question tapped on the page (the server's preview page says which). */
  onPick?: (blockId: string) => void;
}

// The server's HTML page of the paper. On the phone it is a WebView loaded from the HTML text (not the URL), so the
// page's own Content-Security-Policy header never applies; in the browser preview of the app it is a sandboxed
// frame like the web editor's. Links cannot open: the page is the paper only. The page's small script (server
// PREVIEW_SCRIPT) scrolls to the question being written and reports taps, so the teacher writes "on the paper".
export default function PaperPreview({ html, height, show, onPick }: Props) {
  const page = html ? previewPage(html) : WAITING;
  const webRef = useRef<WebView>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    const id = JSON.stringify(show ?? '');
    if (Platform.OS === 'web') frameRef.current?.contentWindow?.postMessage({ paperShow: show ?? '' }, '*');
    else webRef.current?.injectJavaScript(`window.paperShow && window.paperShow(${id}); true;`);
  }, [show]);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const listen = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const id = pickedBlock(event.data);
      if (id) onPickRef.current?.(id);
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);

  return (
    <View style={[styles.wrap, { height }]} accessibilityLabel="Paper preview. Tap a question to write it.">
      {Platform.OS === 'web'
        ? React.createElement('iframe', {
          ref: frameRef, title: 'Paper preview', sandbox: 'allow-scripts', srcDoc: page,
          style: { border: 0, width: '100%', height: '100%', background: Colors.surfaceSecondary },
        })
        : (
          <WebView
            ref={webRef}
            originWhitelist={['*']} source={{ html: page }} javaScriptEnabled setSupportMultipleWindows={false}
            onShouldStartLoadWithRequest={(req) => req.url === 'about:blank' || req.url.startsWith('data:')}
            onMessage={(event) => { const id = pickedBlock(event.nativeEvent.data); if (id) onPickRef.current?.(id); }}
            scalesPageToFit nestedScrollEnabled style={styles.web}
          />
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, overflow: 'hidden', backgroundColor: Colors.surface },
  web: { flex: 1, backgroundColor: Colors.surfaceSecondary },
});
