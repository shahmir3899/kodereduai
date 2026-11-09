// Pure state transitions for the Aura chat. Free of React so the stream handling, the part most
// likely to break, is unit-tested directly. Mirrors frontend/src/components/assistant/assistantState.js.
import type { AssistantEvent } from './assistantSse';

export interface Card { id: number; can_act?: boolean; status?: string; preview?: any; message_id?: number; result?: any; error?: string }
export interface Step { index: number; name: string; sub_agent?: string; kind?: string; label?: string; status: 'running' | 'ok' | 'failed' }
export interface ChatMessage {
  id: number | string; role: 'user' | 'assistant'; content: string;
  actions: Card[]; tool_calls: any[]; sub_agents?: string[]; choices?: any[]; ask_feedback?: boolean;
}
export interface LiveTurn { steps: Step[]; agents: string[]; cards: Card[] }
export interface AssistantState {
  messages: ChatMessage[];
  live: LiveTurn | null;
  memory: { used: number; limit: number };
  status: 'idle' | 'working' | 'error';
  error: string | null;
}

export const initialState: AssistantState = {
  messages: [], live: null, memory: { used: 0, limit: 10 }, status: 'idle', error: null,
};

let tempId = 0;
const nextTemp = (prefix: string) => `${prefix}-${Date.now()}-${++tempId}`;

export function beginTurn(state: AssistantState, text: string): AssistantState {
  return {
    ...state, status: 'working', error: null, live: { steps: [], agents: [], cards: [] },
    messages: [...state.messages, { id: nextTemp('user'), role: 'user', content: text, actions: [], tool_calls: [] }],
  };
}

export function loadMessages(state: AssistantState, data: { messages?: ChatMessage[]; memory?: AssistantState['memory'] }): AssistantState {
  return { ...state, messages: data.messages || [], memory: data.memory || state.memory, live: null, status: 'idle', error: null };
}

const replaceCard = (cards: Card[] | undefined, action: Card) => (cards || []).map((c) => (c.id === action.id ? action : c));

export function applyEvent(state: AssistantState, event: AssistantEvent): AssistantState {
  const live = state.live;
  switch (event.type) {
    case 'start':
      return { ...state, memory: event.memory || state.memory };
    case 'route':
      return live ? { ...state, live: { ...live, agents: event.agents || [] } } : state;
    case 'step': {
      if (!live) return state;
      if (event.phase === 'start') {
        const step: Step = { index: event.index, name: event.name, sub_agent: event.sub_agent, kind: event.kind, label: event.label, status: 'running' };
        return { ...state, live: { ...live, steps: [...live.steps, step] } };
      }
      return { ...state, live: { ...live, steps: live.steps.map((s) => (s.index === event.index ? { ...s, status: event.ok ? 'ok' : 'failed' } : s)) } };
    }
    case 'card':
      return live ? { ...state, live: { ...live, cards: [...live.cards, event.action] } } : state;
    case 'final': {
      const reply = event.message || { id: nextTemp('assistant'), role: 'assistant', content: event.content };
      const message: ChatMessage = {
        ...reply,
        role: 'assistant',
        content: reply.content ?? event.content ?? '',
        // The final message carries the saved cards; fall back to the ones streamed live.
        actions: reply.actions && reply.actions.length ? reply.actions : live?.cards || [],
        tool_calls: reply.tool_calls || event.tool_calls || [],
        sub_agents: reply.sub_agents || event.sub_agents || [],
        choices: event.choices || [],
        ask_feedback: Boolean(event.ask_feedback),
      };
      return { ...state, messages: [...state.messages, message], live: null, status: 'idle', memory: event.memory || state.memory };
    }
    case 'error':
      return { ...state, live: null, status: 'error', error: event.message || 'Aura hit an error. Please try again.' };
    default:
      return state;
  }
}

export function cardUpdated(state: AssistantState, action: Card): AssistantState {
  return {
    ...state,
    messages: state.messages.map((m) => (m.actions?.some((a) => a.id === action.id) ? { ...m, actions: replaceCard(m.actions, action) } : m)),
    live: state.live ? { ...state.live, cards: replaceCard(state.live.cards, action) } : state.live,
  };
}

export function pendingCards(state: AssistantState): Card[] {
  const all = [...state.messages.flatMap((m) => m.actions || []), ...(state.live?.cards || [])];
  return all.filter((a) => a.can_act);
}
