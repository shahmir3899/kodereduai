import { applyEvent, beginTurn, cardUpdated, initialState, loadMessages, pendingCards, type AssistantState } from '../services/assistantState';

const run = (events: any[]): AssistantState => events.reduce(applyEvent, beginTurn(initialState, 'hello'));

describe('assistant state', () => {
  it('adds the question and starts a live turn', () => {
    const s = beginTurn(initialState, 'hello');
    expect(s.status).toBe('working');
    expect(s.messages[0]).toMatchObject({ role: 'user', content: 'hello' });
    expect(s.live).toEqual({ steps: [], agents: [], cards: [] });
  });

  it('tracks steps from start to end', () => {
    const s = run([
      { type: 'route', agents: ['finance'] },
      { type: 'step', phase: 'start', index: 0, name: 'find_student', sub_agent: 'finance', label: 'Looking up' },
      { type: 'step', phase: 'end', index: 0, ok: true },
      { type: 'step', phase: 'start', index: 1, name: 'x' },
      { type: 'step', phase: 'end', index: 1, ok: false },
    ]);
    expect(s.live!.agents).toEqual(['finance']);
    expect(s.live!.steps.map((x) => x.status)).toEqual(['ok', 'failed']);
  });

  it('falls back to the streamed cards when the final message has none', () => {
    const card = { id: 5, can_act: true };
    const s = run([{ type: 'card', action: card }, { type: 'final', content: 'ok', memory: { used: 2, limit: 10 }, choices: [{ label: 'A', send: 'a' }] }]);
    const last = s.messages[s.messages.length - 1];
    expect(last.actions).toEqual([card]);
    expect(last.choices).toHaveLength(1);
    expect(s.status).toBe('idle');
    expect(s.live).toBeNull();
    expect(s.memory.used).toBe(2);
  });

  it('prefers the saved message from the server', () => {
    const s = run([{ type: 'final', message: { id: 9, role: 'assistant', content: 'saved', actions: [{ id: 1 }] } }]);
    expect(s.messages[1]).toMatchObject({ id: 9, content: 'saved', actions: [{ id: 1 }] });
  });

  it('reports an error and clears the live turn', () => {
    const s = run([{ type: 'error', message: 'Quota' }]);
    expect(s).toMatchObject({ status: 'error', error: 'Quota', live: null });
  });

  it('replaces a card everywhere after approve and lists only actionable cards as pending', () => {
    let s = run([{ type: 'final', message: { id: 9, role: 'assistant', content: 'x', actions: [{ id: 1, can_act: true }, { id: 2, can_act: true }] } }]);
    expect(pendingCards(s)).toHaveLength(2);
    s = cardUpdated(s, { id: 1, can_act: false, status: 'executed' });
    expect(pendingCards(s).map((c) => c.id)).toEqual([2]);
  });

  it('loads a saved conversation', () => {
    const s = loadMessages(initialState, { messages: [{ id: 1, role: 'user', content: 'q', actions: [], tool_calls: [] }], memory: { used: 1, limit: 10 } });
    expect(s.messages).toHaveLength(1);
    expect(s.memory.used).toBe(1);
  });
});
