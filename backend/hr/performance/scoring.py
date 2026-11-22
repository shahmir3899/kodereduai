"""
Turn per-measure done ÷ due into one score per teacher, a band and a rank.
"""

MEASURE_LABELS = {
    'attendance_marking': 'Class attendance marked',
    'lesson_plans': 'Lesson plans',
    'marks_entry': 'Exam marks entered',
    'own_attendance': 'Own attendance',
    'homework': 'Homework and diary',
    'grading': 'Homework grading',
    'messages_answered': 'Messages answered',
    'question_papers': 'Question papers created',
    'book_content': 'Book content entered',
    'login_days': 'Login days',
}


def _r(value, places=1):
    return round(float(value), places)


def measure_score(row):
    """0-100, or None when nothing was due (the measure does not apply)."""
    if not row or row['due'] <= 0:
        return None
    return min(100.0, 100.0 * row['credit'] / row['due'])


def score_teacher(rows, weights):
    """rows: {measure: metric row or None}. A measure with nothing due, or with weight 0, is
    dropped and the remaining weights are rescaled to 100."""
    measures = {}
    applicable = {}
    for key in MEASURE_LABELS:
        row = rows.get(key)
        score = measure_score(row)
        weight = float(weights.get(key, 0) or 0)
        measures[key] = {
            'key': key,
            'label': MEASURE_LABELS[key],
            'applicable': score is not None and weight > 0,
            'score': None if score is None else _r(score),
            'weight': weight,
            'effective_weight': 0.0,
            'due': _r(row['due']) if row else 0.0,
            'done': _r(row['done']) if row else 0.0,
            'on_time': _r(row['on_time']) if row else 0.0,
            'missed': (row or {}).get('missed', []),
        }
        if measures[key]['applicable']:
            applicable[key] = (score, weight)

    total_weight = sum(w for _, w in applicable.values())
    if not total_weight:
        return None, measures
    overall = 0.0
    for key, (score, weight) in applicable.items():
        share = weight / total_weight
        measures[key]['effective_weight'] = _r(share * 100)
        overall += score * share
    return _r(overall), measures


def band_for(score, bands):
    if score is None:
        return None
    for band in sorted(bands, key=lambda b: b['min'], reverse=True):
        if score >= band['min']:
            return {'key': band['key'], 'label': band['label']}
    return None


def rank(results):
    """Competition ranking (1, 2, 2, 4) on overall score; teachers with no score are unranked.
    Mutates each result with 'rank' and returns the number ranked."""
    scored = sorted((r for r in results if r['overall_score'] is not None), key=lambda r: -r['overall_score'])
    previous, position = None, 0
    for i, r in enumerate(scored, start=1):
        if r['overall_score'] != previous:
            position, previous = i, r['overall_score']
        r['rank'] = position
    for r in results:
        r.setdefault('rank', None)
    return len(scored)


def validate_weights(weights):
    """Error message, or None. Every key known, none negative, total 100."""
    if not isinstance(weights, dict):
        return 'Weights must be an object.'
    unknown = set(weights) - set(MEASURE_LABELS)
    if unknown:
        return f"Unknown measures: {', '.join(sorted(unknown))}."
    try:
        values = [float(v) for v in weights.values()]
    except (TypeError, ValueError):
        return 'Weights must be numbers.'
    if any(v < 0 for v in values):
        return 'Weights cannot be negative.'
    if round(sum(values), 2) != 100:
        return f'Weights must total 100 (they total {sum(values):g}).'
    return None


def validate_bands(bands):
    if not isinstance(bands, list) or not bands:
        return 'Bands must be a non-empty list.'
    for b in bands:
        if not isinstance(b, dict) or not {'key', 'label', 'min'} <= set(b):
            return 'Each band needs key, label and min.'
        try:
            if not 0 <= float(b['min']) <= 100:
                return 'Band minimums must be between 0 and 100.'
        except (TypeError, ValueError):
            return 'Band minimums must be numbers.'
    if not any(float(b['min']) == 0 for b in bands):
        return 'One band must start at 0 so every score has a band.'
    return None
