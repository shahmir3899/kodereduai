"""
Info-button content, built from the school's own config so it always states the real numbers.
"""

from .scoring import MEASURE_LABELS


def _hours(n):
    return f'{n} hour' + ('' if n == 1 else 's')


def _days(n):
    return f'{n} day' + ('' if n == 1 else 's')


def rules(cfg):
    cutoff = cfg.attendance_cutoff_time.strftime('%I:%M %p').lstrip('0').lower()
    return {
        'attendance_marking': f'Mark class attendance before {cutoff}. Later the same day earns half; a later day earns nothing.',
        'lesson_plans': 'Publish a lesson plan for each timetable period on or before the lesson date. A plan made afterwards earns half.',
        'marks_entry': f'Enter exam marks (or mark absent) for every student within {_days(cfg.marks_deadline_days)} of the paper. Later entries earn half.',
        'own_attendance': 'Present counts in full; late or half day counts half.',
        'homework': f'Post {cfg.homework_per_week} homework or diary items per class and subject each week.',
        'grading': f'Grade submitted homework within {_days(cfg.grading_deadline_days)}. Later grading earns half.',
        'messages_answered': f'Reply to messages from parents, students and staff within {_hours(cfg.message_reply_hours)}. A later reply earns half.',
        'question_papers': f'Create {cfg.papers_per_month} question paper per class and subject each month (ready or published).',
        'book_content': f'Add or improve {cfg.content_blocks_per_month} book content blocks each month.',
        'login_days': 'Open the app on each working day.',
    }


GENERAL = [
    'Each measure is work done divided by work due, so teachers with more classes are compared fairly.',
    'Holidays and your approved leave never count against you.',
    'Work that is still within its deadline is not counted against you yet.',
    'A measure that does not apply to you is left out and the others are rescaled to 100.',
    'Weekly and monthly targets are pro-rated to the working days in the period.',
    'Student results are shown for information only and never change your score.',
]


def quickest_wins(measures, limit=3):
    """The applicable measures where the teacher lost the most weighted points."""
    lost = []
    for m in measures.values():
        if not m['applicable']:
            continue
        points = m['effective_weight'] * (100 - m['score']) / 100
        if points > 0.05:
            lost.append((points, m))
    lost.sort(key=lambda x: -x[0])
    return [
        {'key': m['key'], 'label': m['label'], 'points_available': round(points, 1)}
        for points, m in lost[:limit]
    ]


def build_explainer(cfg, measures=None):
    text = rules(cfg)
    weights = cfg.weights or {}
    payload = {
        'general': GENERAL,
        'measures': [
            {'key': key, 'label': label, 'weight': weights.get(key, 0), 'rule': text[key]}
            for key, label in MEASURE_LABELS.items()
        ],
        'bands': sorted(cfg.bands, key=lambda b: -b['min']),
        'show_rank_to_teachers': cfg.show_rank_to_teachers,
    }
    if measures is not None:
        payload['quickest_wins'] = quickest_wins(measures)
    return payload
