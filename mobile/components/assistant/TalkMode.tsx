import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';
import { clock, PHASE_HEADING, SEND_AFTER, type TalkPhase } from '../../services/assistantTalk';
import { themeFor } from '../../services/assistantTheme';
import type { Card, Step } from '../../services/assistantState';
import ActionCard from './ActionCard';
import StepTrail from './StepTrail';
import TalkOrb from './TalkOrb';

/** The words just heard, held for a few seconds so a wrong word can be fixed before anything is sent. */
export function HeardBox({ text, onSend, onCancel }: { text: string; onSend: (t: string) => void; onCancel: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const [left, setLeft] = useState(SEND_AFTER);
  // The parent re-renders often (levels); the countdown must not restart each time, so the callback lives in a ref.
  const sendRef = useRef(onSend);
  sendRef.current = onSend;
  const sent = useRef(false);
  const send = (t: string) => { if (!sent.current) { sent.current = true; sendRef.current(t); } };

  useEffect(() => {
    if (editing || sent.current) return undefined;
    if (left <= 0) { send(value); return undefined; }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, left, value]);

  return (
    <View style={styles.heard} testID="heard-box">
      <View style={styles.heardTop}>
        <Text style={styles.pill}>Check your words</Text>
        {!editing && <Text accessibilityRole="text" style={styles.small}>Sending in {left}</Text>}
      </View>
      {editing ? (
        <TextInput autoFocus multiline value={value} onChangeText={setValue} accessibilityLabel="Edit what I heard" style={styles.heardInput} />
      ) : (
        <Text style={styles.heardText}>{value}</Text>
      )}
      <View style={styles.row}>
        {editing ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={() => value.trim() && send(value)} style={styles.dark}><Text style={styles.darkText}>Send</Text></Pressable>
        ) : (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel="Send now" onPress={() => send(value)} style={styles.dark}><Text style={styles.darkText}>Send now</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Edit what I heard" onPress={() => setEditing(true)} style={styles.light}><Text style={styles.lightText}>Edit</Text></Pressable>
          </>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel} style={styles.light}><Text style={styles.lightText}>Cancel</Text></Pressable>
      </View>
    </View>
  );
}

/**
 * Voice-first view of Aura: one large orb, one line of status, the words, and any change waiting for approval.
 * Everything it shows comes from the same state as the text chat. A change card stays on screen until a person
 * taps Approve, Edit or Reject: voice never approves.
 */
export default function TalkMode(p: {
  phase: TalkPhase; level: number; seconds: number; maxSeconds: number; agent?: string; steps: Step[]; agents: string[];
  heard: { id: number; text: string } | null; onHeardSend: (t: string) => void; onHeardCancel: () => void;
  onOrbTap: () => void; onCancelListening: () => void; onStopSpeaking: () => void;
  caption: string; lastReply: string; onListen: (t: string) => void; canListen: boolean;
  choices: { label: string; send: string }[]; onChoose: (t: string) => void;
  cards: Card[]; cardNotes: Record<number, any>; onApprove: (id: number) => void; onReject: (id: number) => void; onEdit: (id: number, edits: object) => Promise<void> | void;
  errors: { text: string; dismiss?: () => void }[];
}) {
  const t = themeFor(p.agent);
  const heading = p.phase === 'thinking' ? (t.label === 'Assistant' ? 'Working on it' : `${t.label} agent`) : PHASE_HEADING[p.phase];

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: Spacing.xl }} keyboardShouldPersistTaps="handled" testID="talk-mode">
      <View style={styles.top}>
        {/* A smaller orb while a change waits, so its Approve / Edit / Reject buttons stay within reach. */}
        <TalkOrb phase={p.phase} level={p.level} agent={p.agent} onPress={p.onOrbTap} size={p.cards.length > 0 ? 120 : 168} />
        <View accessibilityLiveRegion="polite" style={{ minHeight: 24, alignItems: 'center' }}>
          {heading ? <Text style={styles.heading}>{heading}</Text> : null}
          {p.phase === 'ready' && <Text style={styles.small}>English, Urdu or Roman Urdu</Text>}
          {p.phase === 'listening' && (
            <>
              <Text style={styles.small}>{clock(p.seconds)} / {clock(p.maxSeconds)}</Text>
              <Text style={styles.small}>It stops by itself when you pause, or tap the orb</Text>
            </>
          )}
        </View>

        {p.phase === 'listening' && (
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel listening" onPress={p.onCancelListening} style={styles.light}><Text style={styles.lightText}>Cancel</Text></Pressable>
        )}
        {p.phase === 'heard' && p.heard && <HeardBox key={p.heard.id} text={p.heard.text} onSend={p.onHeardSend} onCancel={p.onHeardCancel} />}
        {p.phase === 'thinking' && <View style={{ alignSelf: 'stretch' }}><StepTrail live steps={p.steps} agents={p.agents} /></View>}
        {p.phase === 'speaking' && (
          <View style={{ alignSelf: 'stretch', gap: Spacing.sm }}>
            <Text testID="talk-caption" style={styles.caption}>{p.caption}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Stop speaking" onPress={p.onStopSpeaking} style={[styles.dark, { backgroundColor: Colors.primary, alignSelf: 'flex-start' }]}><Text style={styles.darkText}>Stop</Text></Pressable>
          </View>
        )}
        {p.phase === 'ready' && p.lastReply ? (
          <View style={styles.last}>
            <Text style={styles.lastLabel}>LAST REPLY</Text>
            <Text style={styles.lastText}>{p.lastReply}</Text>
            {p.canListen && (
              <Pressable accessibilityRole="button" accessibilityLabel="Listen to the last reply" onPress={() => p.onListen(p.lastReply)} hitSlop={8} style={{ marginTop: Spacing.xs }}>
                <Text style={styles.small}>Listen</Text>
              </Pressable>
            )}
          </View>
        ) : null}
        {p.phase === 'ready' && p.choices.length > 0 && (
          <View style={styles.choices}>
            {p.choices.map((c) => (
              <Pressable key={c.send} accessibilityRole="button" accessibilityLabel={c.label} onPress={() => p.onChoose(c.send)} style={styles.choice}><Text style={styles.choiceText}>{c.label}</Text></Pressable>
            ))}
          </View>
        )}
        {p.errors.map((e) => (
          <Pressable key={e.text} accessibilityRole="alert" onPress={e.dismiss} style={styles.error}><Text style={styles.errorText}>{e.text}{e.dismiss ? '  Dismiss' : ''}</Text></Pressable>
        ))}
      </View>

      {p.cards.length > 0 && (
        <View style={styles.cards} accessibilityLabel="Changes waiting for you">
          {p.cards.map((a) => <ActionCard key={a.id} action={a} note={p.cardNotes[a.id]} onApprove={p.onApprove} onReject={p.onReject} onEdit={p.onEdit} />)}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingTop: Spacing.lg },
  heading: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text, textAlign: 'center' },
  small: { fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: 'center' },
  pill: { fontSize: FontSize.xs, color: Colors.textSecondary, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  heard: { alignSelf: 'stretch', gap: Spacing.sm },
  heardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heardText: { fontSize: FontSize.md, color: Colors.text, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md },
  heardInput: { fontSize: FontSize.md, color: Colors.text, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, minHeight: 64, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: Spacing.sm },
  dark: { backgroundColor: Colors.text, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, minHeight: 40, justifyContent: 'center' },
  darkText: { color: Colors.textInverse, fontSize: FontSize.sm, fontWeight: '600' },
  light: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, minHeight: 40, justifyContent: 'center' },
  lightText: { color: Colors.text, fontSize: FontSize.sm },
  caption: { fontSize: FontSize.md, color: Colors.primary, backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.md, padding: Spacing.md },
  last: { alignSelf: 'stretch', borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md },
  lastLabel: { fontSize: 11, letterSpacing: 0.6, color: Colors.textSecondary, marginBottom: Spacing.xs },
  lastText: { fontSize: FontSize.sm, color: Colors.text },
  choices: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  choice: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.md, minHeight: 36, justifyContent: 'center' },
  choiceText: { fontSize: FontSize.sm, color: Colors.text },
  error: { alignSelf: 'stretch', backgroundColor: Colors.errorLight, borderRadius: BorderRadius.md, padding: Spacing.md },
  errorText: { color: Colors.errorText, fontSize: FontSize.sm },
  cards: { marginTop: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
});
