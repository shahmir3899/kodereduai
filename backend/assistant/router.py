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
    'finance': 'fees, LISTS of who owes / has pending or unpaid fees, collection, payments, expenses, income, account balances, a cash or bank ACCOUNT statement (not a student ledger), receipts (payments received in a period), net position, discounts, who has a scholarship, creating or changing discount and scholarship rules. NEVER for staff salary or payroll totals (that is hr), NEVER for the own fee ledger of one student / fee statement (that is students)',
    'academics': 'timetable, teacher/class/room schedules, substitutes, workload, curriculum gaps, lesson plans and class diary, assignment submissions (who handed in, who has not, grading, returning work)',
    'communication': "one student in detail: attendance history, absences, marks, fee status, transport, scholarships; drafting and sending messages to parents. NEVER for 'how many are absent today' or class / school-wide counts (that is attendance)",
    'study': "the student's own marks, homework, attendance, exams, study help, weak subjects, revision plan, practice quiz",
    'exams': 'exams, results, pass/fail, marks, entering marks, marks still missing, creating or rescheduling an exam, grade scale, students at risk of failing',
    'hr': 'staff, teachers and employees by name; staff directory, who is on leave, leave requests and balances, approving or rejecting leave, applying for leave, staff attendance, staff salary, staff contact details, payroll, payslips, generating / approving / paying / deleting payslips. NEVER for parents leave requests for their children (that is students)',
    'students': "a person's student record: one student profile, student counts, admission enquiries and their notes / status, converting an enquiry to a student, editing student details, changing a student class, leave requests that parents sent for their children, the documents on a student file, one student's own monthly fee or discount, one student's fee ledger, fee statement or fee history (for example Ali ka ledger). NEVER for 'who owes fees' lists (finance) or staff / teachers (hr)",
    'operations': "library books (search, issue, return, overdue), hostel (occupancy, rooms, gate passes), inventory (stock, low stock, stock in / out, vendors and suppliers), transport (routes, who rides, assign a student, is a bus running)",
    'family': "a parent asking about their own children: attendance, fees owed, timetable, exam dates and results, library, bus, leave requests, messages",
    'settings': 'saving how the user wants Aura to behave: always reply in a language, my usual class, my usual fee account (for example always reply in Roman Urdu, my class is 5A)',
    'attendance': "class and school-wide attendance COUNTS for a day: how many students are absent today, which classes have not marked, marking a class register. NEVER one student's attendance history (that is communication)",
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
            'If a name could be a student or a staff member, choose both students and hr. '
            'Reply with the option names only, comma separated (usually one). '
            'Reply "none" ONLY for a greeting, thanks or a general-knowledge question that has nothing to do with this school. '
            'Any question about students, staff, fees, attendance, exams, leave, money or classes needs data, even if it is misspelled or '
            'unclear: then pick the closest option, never "none".')},
        {'role': 'user', 'content': message[:500]},
    ]
    try:
        # The fast model reasons before it answers and that counts against max_tokens: at 20 it often returned an empty string for Roman Urdu
        # messages, which silently offered every tool (144, over Groq's 128 limit) and sent the model to the wrong one.
        reply = llm.complete(prompt, max_tokens=200, temperature=0, retries=0, tier='fast')
    except Exception:
        logger.info('router unavailable; offering all tools')
        return names
    text = reply.content.lower()
    if 'none' in text and not any(n in text for n in names):
        return []
    chosen = [n for n in names if n in text]
    return chosen or names
