import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';
import useAssistant from '../../hooks/useAssistant';
import useAssistantVoice from '../../hooks/useAssistantVoice';
import useAssistantSpeech from '../../hooks/useAssistantSpeech';
import type { ChatMessage } from '../../services/assistantState';
import ActionCard from './ActionCard';
import FeedbackThumbs from './FeedbackThumbs';
import HistoryList from './HistoryList';
import RichText from './RichText';
import StepTrail from './StepTrail';

function Bubble({ message, latest, onChoose, notes, onApprove, onReject, onEdit }: {
  message: ChatMessage; latest: boolean; onChoose: (text: string) => void; notes: Record<number, any>;
  onApprove: (id: number) => void; onReject: (id: number) => void; onEdit: (id: number, edits: object) => Promise<void> | void;
}) {
  const mine = message.role === 'user';
  return (
    <View style={[styles.bubbleRow, mine && { alignItems: 'flex-end' }]}>
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
        {!mine && message.tool_calls?.length > 0 && (
          <StepTrail steps={message.tool_calls.map((t: any, i: number) => ({ index: i, name: t.name, label: t.label, sub_agent: t.sub_agent, status: t.ok === false ? 'failed' : 'ok' }))} />
        )}
        <RichText text={message.content} color={mine ? Colors.textInverse : Colors.text} />
        {!mine && message.ask_feedback ? <FeedbackThumbs messageId={message.id} /> : null}
        {!mine && latest && (message.choices || []).length > 0 && (
          <View style={styles.choices}>
            {message.choices!.map((c: any) => (
              <Pressable key={c.send} accessibilityRole="button" accessibilityLabel={c.label} onPress={() => onChoose(c.send)} style={styles.choice}>
                <Text style={styles.choiceText}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {(message.actions || []).map((a) => (
          <ActionCard key={a.id} action={a} note={notes[a.id]} onApprove={onApprove} onReject={onReject} onEdit={onEdit} />
        ))}
      </View>
    </View>
  );
}

export default function AuraChat({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const a = useAssistant({ enabled: true });
  const speech = useAssistantSpeech();
  const [text, setText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const speakNext = useRef(false);
  const spokenId = useRef<string | number | null>(null);
  const list = useRef<FlatList>(null);

  const voiceOn = Boolean(a.capabilities?.voice?.enabled);
  const voice = useAssistantVoice({
    enabled: voiceOn,
    maxSeconds: a.capabilities?.voice?.max_seconds ?? 60,
    // The words go to the box so the person can correct them; nothing is sent or approved by voice.
    onTranscript: (t) => { setText((cur) => (cur ? `${cur} ${t}` : t)); speakNext.current = true; },
  });

  const { messages, live, status, error, memory } = a.state;
  const working = status === 'working';
  const agents: any[] = a.capabilities?.agents || [];
  const suggestions: string[] = a.capabilities?.suggestions || [];

  useEffect(() => { list.current?.scrollToEnd({ animated: true }); }, [messages.length, live?.steps.length, live?.cards.length]);

  // Read the answer to a spoken question once. A typed question is never read out loud unprompted.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || last.id === spokenId.current) return;
    spokenId.current = last.id;
    if (speakNext.current && speakReplies) speech.speakReply(last.content);
    speakNext.current = false;
  }, [messages, speakReplies, speech]);

  const submit = (value: string) => {
    const t = value.trim();
    if (!t || working) return;
    speech.stop();
    setText('');
    a.send(t);
  };

  const lastAssistantId = useMemo(() => [...messages].reverse().find((m) => m.role === 'assistant')?.id, [messages]);
  const empty = messages.length === 0 && !live;
  const notice = speech.notice || voice.error;

  if (showHistory) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <HistoryList query={a.history} currentId={a.conversationId} onClose={() => setShowHistory(false)}
          onOpen={(id) => { setShowHistory(false); a.openConversation(id); }} onPin={a.pinConversation} onDelete={a.removeConversation} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={[styles.screen, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close Aura" onPress={onClose} hitSlop={10}><Text style={styles.headLink}>Close</Text></Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.headTitle}>Aura</Text>
          <Text style={styles.memory} accessibilityLabel={`Memory ${memory.used} of ${memory.limit}`}>Memory {memory.used}/{memory.limit}</Text>
        </View>
        <View style={styles.headRight}>
          <Pressable accessibilityRole="button" accessibilityLabel="Past conversations" onPress={() => setShowHistory(true)} hitSlop={10}><Text style={styles.headLink}>History</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="New chat" onPress={a.newChat} hitSlop={10}><Text style={styles.headLink}>New</Text></Pressable>
        </View>
      </View>

      {a.capabilities && agents.length === 0 ? (
        <Text style={styles.empty}>Aura is not available for your account at this school.</Text>
      ) : (
        <FlatList
          ref={list}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: Spacing.md, flexGrow: 1 }}
          data={messages}
          keyExtractor={(m) => String(m.id)}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={empty ? (
            <View>
              <Text style={styles.hello}>Hi, I am Aura. Ask me about your school, or tell me what to prepare.</Text>
              {suggestions.map((s) => (
                <Pressable key={s} accessibilityRole="button" accessibilityLabel={s} onPress={() => submit(s)} style={styles.suggest}><Text style={styles.suggestText}>{s}</Text></Pressable>
              ))}
            </View>
          ) : null}
          renderItem={({ item }) => (
            <Bubble message={item} latest={item.id === lastAssistantId} onChoose={submit} notes={a.cardNotes}
              onApprove={a.approve} onReject={a.reject} onEdit={a.edit} />
          )}
          ListFooterComponent={
            <View>
              {working && live ? <StepTrail live steps={live.steps} agents={live.agents} /> : null}
              {live?.cards.map((c) => (
                <ActionCard key={c.id} action={c} note={a.cardNotes[c.id]} onApprove={a.approve} onReject={a.reject} onEdit={a.edit} />
              ))}
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            </View>
          }
        />
      )}

      {notice ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss notice" onPress={() => { speech.clearNotice(); voice.clearError(); }} style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </Pressable>
      ) : null}

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
        {voice.phase === 'recording' ? (
          <View style={styles.recording}>
            <View style={[styles.meter, { width: `${Math.round(voice.level * 100)}%` }]} />
            <Text style={styles.recText}>Listening… {voice.seconds}s</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Stop and transcribe" onPress={voice.stop} style={styles.stop}><Text style={styles.stopText}>Stop</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel recording" onPress={voice.cancel} hitSlop={8}><Text style={styles.headLink}>Cancel</Text></Pressable>
          </View>
        ) : (
          <>
            {voiceOn && (
              <Pressable accessibilityRole="button" accessibilityLabel="Speak your question" disabled={voice.phase === 'transcribing' || working} onPress={voice.start} style={styles.round}>
                {voice.phase === 'transcribing' ? <ActivityIndicator color={Colors.text} /> : <Text style={styles.roundText}>🎤</Text>}
              </Pressable>
            )}
            <TextInput
              style={styles.input} value={text} onChangeText={setText} multiline placeholder="Ask Aura…" placeholderTextColor={Colors.placeholder}
              accessibilityLabel="Message to Aura" editable={!working} maxLength={2000}
            />
            {voiceOn && (
              <Pressable accessibilityRole="button" accessibilityState={{ selected: speakReplies }} accessibilityLabel={speakReplies ? 'Spoken replies on' : 'Spoken replies off'}
                onPress={() => { if (speech.speaking) speech.stop(); setSpeakReplies((v) => !v); }} style={styles.round}>
                <Text style={styles.roundText}>{speakReplies ? '🔊' : '🔇'}</Text>
              </Pressable>
            )}
            <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={!text.trim() || working} onPress={() => submit(text)} style={[styles.send, (!text.trim() || working) && { opacity: 0.4 }]}>
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, backgroundColor: Colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  headTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  memory: { fontSize: FontSize.xs, color: Colors.textSecondary },
  headLink: { fontSize: FontSize.sm, color: Colors.primary },
  headRight: { flexDirection: 'row', gap: Spacing.md },
  empty: { padding: Spacing.xl, fontSize: FontSize.md, color: Colors.textSecondary },
  hello: { fontSize: FontSize.md, color: Colors.text, marginBottom: Spacing.md },
  suggest: { borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.md, marginBottom: Spacing.sm },
  suggestText: { fontSize: FontSize.sm, color: Colors.text },
  bubbleRow: { marginBottom: Spacing.md },
  bubble: { maxWidth: '92%', borderRadius: BorderRadius.lg, padding: Spacing.md },
  mine: { backgroundColor: Colors.primary },
  theirs: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.sm },
  choice: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, minHeight: 36, justifyContent: 'center' },
  choiceText: { fontSize: FontSize.sm, color: Colors.text },
  error: { fontSize: FontSize.sm, color: Colors.errorText, backgroundColor: Colors.errorLight, borderRadius: BorderRadius.md, padding: Spacing.md },
  notice: { backgroundColor: Colors.warningLight, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  noticeText: { fontSize: FontSize.xs, color: Colors.warningText },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, paddingHorizontal: Spacing.sm, paddingTop: Spacing.sm, backgroundColor: Colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  input: { flex: 1, maxHeight: 120, minHeight: 44, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: FontSize.md, color: Colors.text },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceSecondary },
  roundText: { fontSize: 20 },
  send: { height: 44, paddingHorizontal: Spacing.lg, borderRadius: BorderRadius.lg, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: Colors.textInverse, fontWeight: '600', fontSize: FontSize.sm },
  recording: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 44 },
  meter: { position: 'absolute', left: 0, bottom: 0, height: 3, backgroundColor: Colors.primaryLight },
  recText: { flex: 1, fontSize: FontSize.md, color: Colors.text },
  stop: { backgroundColor: Colors.error, borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.lg, height: 44, justifyContent: 'center' },
  stopText: { color: Colors.textInverse, fontWeight: '600' },
});
