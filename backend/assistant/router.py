"""Sub-agent router.

Sending every tool definition on every question burns Groq's daily token budget (the
free tier allows 200k/day) and makes the model pick worse. The router first asks a tiny
question - which sub-agents does this message need? - and only those agents' tools are
offered for the real turn. It costs a few hundred tokens and skips itself whenever the
choice is already obvious.
"""
import logging

from . import llm

logger = logging.getLogger(__name__)

# One line each: this is what the routing model reads.
AGENTS = {
    'finance': 'fees, pending/unpaid students, payments, expenses, income, account balances, discounts',
    'academics': 'timetable, teacher/class/room schedules, substitutes, workload, curriculum gaps',
    'communication': 'one student or class in detail for parent contact: attendance, marks, fee status, transport, drafting messages to parents',
    'study': "the student's own marks, homework, attendance, exams, study help",
    'attendance': "today's or any day's attendance: who is absent, which classes have not marked, marking a class register",
}


def pick_agents(available: dict, message: str, recent_agents=()) -> list:
    """available: {agent_name: [tools]} for this user. Returns the agents whose tools to offer.
    Falls back to every available agent when the router cannot decide."""
    names = [n for n in available if n in AGENTS]
    if len(names) <= 1:
        return names
    options = '\n'.join(f'- {n}: {AGENTS[n]}' for n in names)
    hint = f'\nThe previous question used: {", ".join(recent_agents)}.' if recent_agents else ''
    prompt = [
        {'role': 'system', 'content': (
            'Choose which assistants are needed to answer the school user\'s message. '
            f'Options:\n{options}{hint}\n'
            'Reply with the option names only, comma separated (usually one). '
            'Reply "none" if no data lookup is needed (greeting, general question).')},
        {'role': 'user', 'content': message[:500]},
    ]
    try:
        reply = llm.complete(prompt, max_tokens=20, temperature=0, retries=0, tier='fast')
    except Exception:
        logger.info('router unavailable; offering all tools')
        return names
    text = reply.content.lower()
    if 'none' in text and not any(n in text for n in names):
        return []
    chosen = [n for n in names if n in text]
    return chosen or names
