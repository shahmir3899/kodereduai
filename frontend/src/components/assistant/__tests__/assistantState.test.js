import { describe, expect, it } from 'vitest'
import { applyEvent, beginTurn, cardUpdated, initialState, loadMessages, pendingCards, reset } from '../assistantState'

const card = (over = {}) => ({ id: 7, status: 'pending', can_act: true, preview: { kind: 'attendance' }, ...over })

function run(events, start = beginTurn(initialState, 'hazri lagao')) {
  return events.reduce(applyEvent, start)
}

describe('assistant stream state', () => {
  it('starts a turn: user bubble, live trail, working', () => {
    const s = beginTurn(initialState, 'hi')
    expect(s.status).toBe('working')
    expect(s.messages.map((m) => [m.role, m.content])).toEqual([['user', 'hi']])
    expect(s.live).toEqual({ steps: [], agents: [], cards: [] })
  })

  it('tracks routing and each step from running to done or failed', () => {
    const s = run([
      { type: 'start', memory: { used: 1, limit: 10 } },
      { type: 'route', agents: ['attendance'] },
      { type: 'step', phase: 'start', index: 0, name: 'get_class_attendance', sub_agent: 'attendance', kind: 'read', label: 'Class attendance' },
      { type: 'step', phase: 'start', index: 1, name: 'mark_attendance', sub_agent: 'attendance', kind: 'write', label: 'Preparing: mark attendance' },
      { type: 'step', phase: 'end', index: 0, ok: true },
      { type: 'step', phase: 'end', index: 1, ok: false },
    ])
    expect(s.memory).toEqual({ used: 1, limit: 10 })
    expect(s.live.agents).toEqual(['attendance'])
    expect(s.live.steps.map((x) => [x.label, x.status])).toEqual([['Class attendance', 'ok'], ['Preparing: mark attendance', 'failed']])
  })

  it('a card arrives before the answer and travels with the final message', () => {
    const s = run([
      { type: 'card', action: card() },
      { type: 'final', content: 'Review it.', message: { id: 5, role: 'assistant', content: 'Review it.', actions: [] }, memory: { used: 2, limit: 10 } },
    ])
    expect(s.status).toBe('idle')
    expect(s.live).toBeNull()
    expect(s.memory.used).toBe(2)
    const reply = s.messages.at(-1)
    expect(reply.role).toBe('assistant')
    expect(reply.actions.map((a) => a.id)).toEqual([7])
  })

  it('prefers the saved cards in the final message over the live ones', () => {
    const s = run([
      { type: 'card', action: card({ status: 'pending' }) },
      { type: 'final', content: 'x', message: { id: 5, role: 'assistant', content: 'x', actions: [card({ status: 'edited' })] } },
    ])
    expect(s.messages.at(-1).actions[0].status).toBe('edited')
  })

  it('keeps the tool steps on the saved message so the trail can be reopened', () => {
    const s = run([{ type: 'final', content: 'ok', tool_calls: [{ name: 'a', ok: true }], sub_agents: ['finance'] }])
    expect(s.messages.at(-1).tool_calls).toHaveLength(1)
    expect(s.messages.at(-1).sub_agents).toEqual(['finance'])
  })

  it('an error ends the turn but keeps what the user typed', () => {
    const s = run([{ type: 'error', message: 'Boom' }])
    expect(s.status).toBe('error')
    expect(s.error).toBe('Boom')
    expect(s.live).toBeNull()
    expect(s.messages).toHaveLength(1)
  })

  it('ignores step events when no turn is running', () => {
    expect(applyEvent(initialState, { type: 'step', phase: 'start', index: 0 })).toBe(initialState)
  })

  it('ignores unknown event types', () => {
    const s = beginTurn(initialState, 'x')
    expect(applyEvent(s, { type: 'surprise' })).toBe(s)
  })

  it('updates a card in saved messages and in the live turn', () => {
    const saved = run([{ type: 'final', content: 'x', message: { id: 1, role: 'assistant', content: 'x', actions: [card()] } }])
    const updated = cardUpdated(saved, card({ status: 'executed', can_act: false }))
    expect(updated.messages.at(-1).actions[0].status).toBe('executed')

    const live = run([{ type: 'card', action: card() }])
    expect(cardUpdated(live, card({ status: 'rejected', can_act: false })).live.cards[0].status).toBe('rejected')
  })

  it('counts only cards that can still be acted on', () => {
    const s = run([
      { type: 'final', content: 'x', message: { id: 1, role: 'assistant', content: 'x', actions: [card({ id: 1 }), card({ id: 2, can_act: false, status: 'executed' })] } },
    ])
    expect(pendingCards(s).map((a) => a.id)).toEqual([1])
  })

  it('loads history and resets', () => {
    const s = loadMessages(initialState, { messages: [{ id: 1, role: 'user', content: 'a' }], memory: { used: 1, limit: 10 } })
    expect(s.messages).toHaveLength(1)
    expect(s.memory.used).toBe(1)
    expect(reset()).toEqual(initialState)
  })
})
