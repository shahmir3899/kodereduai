import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useScopedQuery } from './useScopedQuery';
import { assistantApi, eventsFromReply, streamMessage, StreamUnavailable } from '../services/assistantApi';
import type { AssistantEvent } from '../services/assistantSse';
import {
  applyEvent, beginTurn, cardUpdated, initialState, loadMessages, pendingCards,
  type AssistantState, type Card,
} from '../services/assistantState';

type Action =
  | { type: 'begin'; text: string }
  | { type: 'event'; event: AssistantEvent }
  | { type: 'loaded'; data: any }
  | { type: 'card'; action: Card }
  | { type: 'reset' };

function reducer(state: AssistantState, action: Action): AssistantState {
  switch (action.type) {
    case 'begin': return beginTurn(state, action.text);
    case 'event': return applyEvent(state, action.event);
    case 'loaded': return loadMessages(state, action.data);
    case 'card': return cardUpdated(state, action.action);
    case 'reset': return { ...initialState };
    default: return state;
  }
}

function errorText(err: any, fallback: string): string {
  return err?.response?.data?.error || err?.response?.data?.detail || err?.message || fallback;
}

export interface CardNote { busy: boolean; error: string | null }

/**
 * Everything the chat screen needs: the conversation, the live turn, and approve/edit/reject on cards.
 * `enabled` gates every request, so a school or role without the assistant makes no calls.
 */
export default function useAssistant({ enabled }: { enabled: boolean }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [cardNotes, setCardNotes] = useState<Record<number, CardNote>>({});
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const loadedRef = useRef(false);

  const capabilities = useScopedQuery<any>('assistant-capabilities', [], async () => (await assistantApi.capabilities()).data, {
    enabled, staleTime: 5 * 60 * 1000, retry: false,
  });

  // Pick up the latest conversation the first time the screen opens.
  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      try {
        const list = (await assistantApi.listConversations()).data;
        if (list.length) {
          setConversationId(list[0].id);
          dispatch({ type: 'loaded', data: (await assistantApi.getMessages(list[0].id)).data });
        }
      } catch {
        // No history is not fatal: the first message starts a new conversation.
      }
    })();
  }, [enabled]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || state.status === 'working') return;
    let id = conversationId;
    try {
      if (!id) {
        id = (await assistantApi.createConversation()).data.id as number;
        setConversationId(id);
      }
    } catch (err) {
      dispatch({ type: 'begin', text: message });
      dispatch({ type: 'event', event: { type: 'error', message: errorText(err, 'Could not start a conversation.') } });
      return;
    }
    dispatch({ type: 'begin', text: message });
    abortRef.current = new AbortController();
    const onEvent = (event: AssistantEvent) => dispatch({ type: 'event', event });
    try {
      await streamMessage(id!, message, onEvent, abortRef.current.signal);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (err instanceof StreamUnavailable) {
        // Some networks and proxies hold a stream back: the plain endpoint gives the same answer without live steps.
        try {
          const { data } = await assistantApi.sendMessage(id!, message);
          eventsFromReply(data).forEach(onEvent);
        } catch (inner) {
          onEvent({ type: 'error', message: errorText(inner, 'Aura could not answer.') });
        }
      } else {
        onEvent({ type: 'error', message: errorText(err, 'Aura could not answer.') });
      }
    }
  }, [conversationId, state.status]);

  const runCardAction = useCallback(async (id: number, call: () => Promise<{ data: Card }>) => {
    setCardNotes((n) => ({ ...n, [id]: { busy: true, error: null } }));
    try {
      const { data } = await call();
      dispatch({ type: 'card', action: data });
      setCardNotes((n) => ({ ...n, [id]: { busy: false, error: null } }));
    } catch (err: any) {
      const body = err?.response?.data;
      // 409 "changed": the server rebuilt the card from fresh data. Show it instead of failing.
      if (body?.action) dispatch({ type: 'card', action: body.action });
      setCardNotes((n) => ({ ...n, [id]: { busy: false, error: errorText(err, 'That did not work. Please try again.') } }));
    }
  }, []);

  const approve = useCallback((id: number) => runCardAction(id, () => assistantApi.approveAction(id)), [runCardAction]);
  const reject = useCallback((id: number) => runCardAction(id, () => assistantApi.rejectAction(id)), [runCardAction]);
  const edit = useCallback((id: number, edits: object) => runCardAction(id, () => assistantApi.editAction(id, edits)), [runCardAction]);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setConversationId(null);
    setCardNotes({});
    dispatch({ type: 'reset' });
  }, []);

  const history = useScopedQuery<any[]>('assistant-conversations', [], async () => (await assistantApi.listConversations()).data, {
    enabled, staleTime: 0, retry: false,
  });
  const refreshHistory = useCallback(() => queryClient.invalidateQueries({ queryKey: ['assistant-conversations'] }), [queryClient]);

  const openConversation = useCallback(async (id: number) => {
    abortRef.current?.abort();
    setCardNotes({});
    setConversationId(id);
    dispatch({ type: 'reset' });
    try {
      dispatch({ type: 'loaded', data: (await assistantApi.getMessages(id)).data });
    } catch (err) {
      dispatch({ type: 'event', event: { type: 'error', message: errorText(err, 'Could not open that conversation.') } });
    }
  }, []);

  const pinConversation = useCallback(async (id: number, pinned: boolean) => {
    await assistantApi.updateConversation(id, { pinned });
    refreshHistory();
  }, [refreshHistory]);

  const removeConversation = useCallback(async (id: number) => {
    await assistantApi.deleteConversation(id);
    if (id === conversationId) newChat();
    refreshHistory();
  }, [conversationId, newChat, refreshHistory]);

  return {
    state, capabilities: capabilities.data, cardNotes, send, approve, reject, edit, newChat,
    conversationId, history, openConversation, pinConversation, removeConversation,
    pending: pendingCards(state).length,
  };
}
