// Pure state transitions for the assistant chat. Kept free of React so the stream handling,
// the part most likely to break, is unit-tested directly.

export const initialState = {
  messages: [],
  live: null,            // the turn in progress: { steps, agents, cards }
  memory: { used: 0, limit: 10 },
  status: 'idle',        // idle | working | error
  error: null,
}

let tempId = 0
const nextTemp = (prefix) => `${prefix}-${Date.now()}-${++tempId}`

export function beginTurn(state, text) {
  return {
    ...state,
    status: 'working',
    error: null,
    live: { steps: [], agents: [], cards: [] },
    messages: [...state.messages, { id: nextTemp('user'), role: 'user', content: text, actions: [], tool_calls: [] }],
  }
}

export function loadMessages(state, data) {
  return { ...state, messages: data.messages || [], memory: data.memory || state.memory, live: null, status: 'idle', error: null }
}

function replaceCard(cards, action) {
  return (cards || []).map((c) => (c.id === action.id ? action : c))
}

export function applyEvent(state, event) {
  const live = state.live
  switch (event.type) {
    case 'start':
      return { ...state, memory: event.memory || state.memory }
    case 'route':
      return live ? { ...state, live: { ...live, agents: event.agents || [] } } : state
    case 'step': {
      if (!live) return state
      if (event.phase === 'start') {
        const step = {
          index: event.index, name: event.name, sub_agent: event.sub_agent,
          kind: event.kind, label: event.label, status: 'running',
        }
        return { ...state, live: { ...live, steps: [...live.steps, step] } }
      }
      return {
        ...state,
        live: {
          ...live,
          steps: live.steps.map((s) => (s.index === event.index ? { ...s, status: event.ok ? 'ok' : 'failed' } : s)),
        },
      }
    }
    case 'card':
      return live ? { ...state, live: { ...live, cards: [...live.cards, event.action] } } : state
    case 'final': {
      const reply = event.message || { id: nextTemp('assistant'), role: 'assistant', content: event.content }
      const message = {
        ...reply,
        content: reply.content ?? event.content,
        // The final message carries the saved cards; fall back to the ones streamed live.
        actions: reply.actions && reply.actions.length ? reply.actions : live?.cards || [],
        tool_calls: reply.tool_calls || event.tool_calls || [],
        sub_agents: reply.sub_agents || event.sub_agents || [],
        choices: event.choices || [],
        ask_feedback: Boolean(event.ask_feedback),
      }
      return { ...state, messages: [...state.messages, message], live: null, status: 'idle', memory: event.memory || state.memory }
    }
    case 'error':
      return { ...state, live: null, status: 'error', error: event.message || 'Aura hit an error. Please try again.' }
    default:
      return state
  }
}

export function cardUpdated(state, action) {
  return {
    ...state,
    messages: state.messages.map((m) => (m.actions?.some((a) => a.id === action.id) ? { ...m, actions: replaceCard(m.actions, action) } : m)),
    live: state.live ? { ...state.live, cards: replaceCard(state.live.cards, action) } : state.live,
  }
}

export function pendingCards(state) {
  const all = [...state.messages.flatMap((m) => m.actions || []), ...(state.live?.cards || [])]
  return all.filter((a) => a.can_act)
}

export function reset() {
  return { ...initialState }
}
