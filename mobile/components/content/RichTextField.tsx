import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { RICH_EDITOR_HTML } from '../../assets/richEditorHtml';
import {
  clampEditorHeight, commandMessage, EDITOR_MAX_HEIGHT, EDITOR_MIN_HEIGHT, initMessage, languageMessage, LANGUAGE_OPTIONS, parsePageMessage,
  TABLE_TOOLBAR, TOOLBAR, type PageMessage, type ToolbarItem,
} from '../../services/richText';
import Select from '../ui/Select';
import { Colors, BorderRadius, FontSize, Spacing } from '../../constants/colors';

interface Props {
  label?: string;
  // The question text as saved: HTML inside the language wrapper (plain old text opens fine too).
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  // Bump to load `value` into the editor again (a sheet that was reset, or opened for another question).
  resetKey?: number | string;
}

// The question-text editor, the same one the web uses: it runs in a WebView built from the web's own editor
// definition (an iframe on Expo web), so both write identical HTML. This component is the toolbar and the bridge.
export default function RichTextField({ label, value, onChange, placeholder = 'Write the question…', resetKey }: Props) {
  const webview = useRef<WebView>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [language, setLanguage] = useState('en');
  const [height, setHeight] = useState(EDITOR_MIN_HEIGHT);
  const latest = useRef(value);
  latest.current = value;

  const send = useCallback((message: string) => {
    if (Platform.OS === 'web') frame.current?.contentWindow?.postMessage(message, '*');
    else webview.current?.postMessage(message);
  }, []);

  const handle = useCallback((msg: PageMessage | null) => {
    if (!msg) return;
    if (msg.type === 'ready') { setReady(true); send(initMessage(latest.current, placeholder)); }
    else if (msg.type === 'change') { latest.current = msg.html; onChange(msg.html); }
    else if (msg.type === 'state') { setActive(msg.active); setLanguage(msg.language); }
    else if (msg.type === 'height') setHeight(clampEditorHeight(msg.px));
  }, [onChange, placeholder, send]);

  // Expo web: the page is an iframe and talks through window messages.
  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const listener = (e: MessageEvent) => { if (e.source === frame.current?.contentWindow) handle(parsePageMessage(e.data)); };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [handle]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (ready) send(initMessage(latest.current, placeholder));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const button = (item: ToolbarItem) => (
    <TouchableOpacity key={item.name} accessibilityRole="button" accessibilityLabel={item.hint} accessibilityState={{ selected: !!(item.flag && active[item.flag]) }}
      style={[styles.tool, item.flag && active[item.flag] ? styles.toolOn : null]} onPress={() => send(commandMessage(item.name))} disabled={!ready}>
      <Text style={[styles.toolText, item.flag && active[item.flag] ? styles.toolTextOn : null]}>{item.label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" style={styles.toolbar} contentContainerStyle={styles.toolbarRow}>
        {TOOLBAR.map(button)}
        {active.inTable ? TABLE_TOOLBAR.map(button) : null}
      </ScrollView>
      <View style={[styles.editor, { height: Math.min(Math.max(height, EDITOR_MIN_HEIGHT), EDITOR_MAX_HEIGHT) }]} accessibilityLabel={label ?? 'Question text editor'}>
        {Platform.OS === 'web'
          ? React.createElement('iframe', { ref: (el: HTMLIFrameElement | null) => { frame.current = el; }, srcDoc: RICH_EDITOR_HTML, title: label ?? 'Question text editor', style: { border: 0, width: '100%', height: '100%' } })
          : (
            <WebView
              ref={webview} originWhitelist={['*']} source={{ html: RICH_EDITOR_HTML }} javaScriptEnabled domStorageEnabled
              onMessage={(e: WebViewMessageEvent) => handle(parsePageMessage(e.nativeEvent.data))}
              hideKeyboardAccessoryView keyboardDisplayRequiresUserAction={false} automaticallyAdjustContentInsets={false}
              scrollEnabled nestedScrollEnabled setSupportMultipleWindows={false} style={styles.web}
            />
          )}
      </View>
      <Select label="Language" value={language} onChange={(code) => { setLanguage(code); send(languageMessage(code)); }}
        options={LANGUAGE_OPTIONS.map((o) => ({ value: o.code as string, label: o.label }))} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  toolbar: { flexGrow: 0 },
  toolbarRow: { gap: Spacing.xs, paddingVertical: 2 },
  tool: { minWidth: 44, minHeight: 40, paddingHorizontal: Spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  toolOn: { backgroundColor: Colors.infoLight, borderColor: Colors.primary },
  toolText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600' },
  toolTextOn: { color: Colors.primary },
  editor: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, overflow: 'hidden', backgroundColor: Colors.surface },
  web: { flex: 1, backgroundColor: 'transparent' },
});
