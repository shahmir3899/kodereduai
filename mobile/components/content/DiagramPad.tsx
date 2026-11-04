import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { DIAGRAM_PAD_HTML } from '../../assets/diagramPadHtml';
import { COLORS, padMessage, parsePadMessage, TOOLS, WEIGHTS, type PadMessage } from '../../services/diagrams';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { Colors, BorderRadius, FontSize, Spacing } from '../../constants/colors';

interface Props {
  visible: boolean;
  // Which picture this is for, e.g. "Question picture" (shown as a hint).
  target: string;
  onClose: () => void;
  // The finished drawing as a PNG data URL.
  onDone: (dataUrl: string) => void;
}

// Draw a figure for a question: pen, shapes, arrow, text label and eraser on the same canvas the web uses.
export default function DiagramPad({ visible, target, onClose, onDone }: Props) {
  const webview = useRef<WebView>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const [pad, setPad] = useState({ tool: 'pen', color: COLORS[0] as string, weight: WEIGHTS[1] as number, canUndo: false, canRedo: false, empty: true });
  const [askText, setAskText] = useState(false);
  const [label, setLabel] = useState('');

  const send = useCallback((message: string) => {
    if (Platform.OS === 'web') frame.current?.contentWindow?.postMessage(message, '*');
    else webview.current?.postMessage(message);
  }, []);

  const handle = useCallback((msg: PadMessage | null) => {
    if (!msg) return;
    if (msg.type === 'ready') setReady(true);
    else if (msg.type === 'state') setPad({ tool: msg.tool, color: msg.color, weight: msg.weight, canUndo: msg.canUndo, canRedo: msg.canRedo, empty: msg.empty });
    else if (msg.type === 'needText') { setLabel(''); setAskText(true); }
    else if (msg.type === 'png') onDone(msg.data);
  }, [onDone]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return undefined;
    const listener = (e: MessageEvent) => { if (e.source === frame.current?.contentWindow) handle(parsePadMessage(e.data)); };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [handle, visible]);

  useEffect(() => { if (!visible) { setReady(false); setAskText(false); } }, [visible]);

  const placeText = () => { send(padMessage('text', { value: label })); setAskText(false); };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <Text style={styles.title}>Draw a picture · {target}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.row} contentContainerStyle={styles.rowContent} keyboardShouldPersistTaps="always">
          {TOOLS.map((t) => (
            <TouchableOpacity key={t.id} accessibilityRole="button" accessibilityLabel={t.hint} accessibilityState={{ selected: pad.tool === t.id }} disabled={!ready}
              style={[styles.tool, pad.tool === t.id && styles.toolOn]} onPress={() => send(padMessage('tool', { id: t.id }))}>
              <Text style={[styles.toolText, pad.tool === t.id && styles.toolTextOn]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={styles.rowContent}>
          {COLORS.map((c) => (
            <TouchableOpacity key={c} accessibilityRole="button" accessibilityLabel={`Colour ${c}`} accessibilityState={{ selected: pad.color === c }} disabled={!ready}
              style={[styles.swatch, { backgroundColor: c }, pad.color === c && styles.swatchOn]} onPress={() => send(padMessage('color', { value: c }))} />
          ))}
          {WEIGHTS.map((w) => (
            <TouchableOpacity key={w} accessibilityRole="button" accessibilityLabel={`Line weight ${w}`} accessibilityState={{ selected: pad.weight === w }} disabled={!ready}
              style={[styles.tool, pad.weight === w && styles.toolOn]} onPress={() => send(padMessage('weight', { value: w }))}>
              <View style={[styles.weight, { height: w }]} />
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.rowContent}>
          <Button title="Undo" size="sm" variant="outline" disabled={!ready || !pad.canUndo} onPress={() => send(padMessage('undo'))} />
          <Button title="Redo" size="sm" variant="outline" disabled={!ready || !pad.canRedo} onPress={() => send(padMessage('redo'))} />
          <Button title="Clear" size="sm" variant="ghost" disabled={!ready || pad.empty} onPress={() => send(padMessage('clear'))} />
        </View>
        {askText ? (
          <View style={styles.askText}>
            <Input label="Label text" value={label} onChangeText={setLabel} onSubmitEditing={placeText} returnKeyType="done" autoFocus />
            <View style={styles.rowContent}>
              <Button title="Place label" size="sm" disabled={!label.trim()} onPress={placeText} />
              <Button title="Cancel" size="sm" variant="ghost" onPress={() => { setAskText(false); send(padMessage('text', { value: '' })); }} />
            </View>
          </View>
        ) : null}
        <View style={styles.canvas} accessibilityLabel="Drawing area">
          {visible ? (Platform.OS === 'web'
            ? React.createElement('iframe', { ref: (el: HTMLIFrameElement | null) => { frame.current = el; }, srcDoc: DIAGRAM_PAD_HTML, title: 'Drawing area', style: { border: 0, width: '100%', height: '100%' } })
            : (
              <WebView ref={webview} originWhitelist={['*']} source={{ html: DIAGRAM_PAD_HTML }} javaScriptEnabled onMessage={(e: WebViewMessageEvent) => handle(parsePadMessage(e.nativeEvent.data))}
                scrollEnabled={false} bounces={false} overScrollMode="never" style={styles.web} />
            )) : null}
        </View>
        <View style={styles.footer}>
          <View style={styles.footerCol}><Button title="Cancel" variant="outline" onPress={onClose} /></View>
          <View style={styles.footerCol}><Button title="Use drawing" disabled={!ready || pad.empty} onPress={() => send(padMessage('export'))} /></View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background, padding: Spacing.md, gap: Spacing.sm },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  row: { flexGrow: 0 },
  rowContent: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap' },
  tool: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  toolOn: { backgroundColor: Colors.infoLight, borderColor: Colors.primary },
  toolText: { fontSize: FontSize.lg, color: Colors.textSecondary },
  toolTextOn: { color: Colors.primary },
  swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: Colors.primary },
  weight: { width: 24, backgroundColor: Colors.text, borderRadius: 4 },
  askText: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.sm },
  canvas: { aspectRatio: 860 / 540, width: '100%', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  web: { flex: 1, backgroundColor: 'transparent' },
  footer: { flexDirection: 'row', gap: Spacing.sm, marginTop: 'auto' },
  footerCol: { flex: 1 },
});
