"""Scores one assistant turn against a baseline question's expectation.

A question's `expect` is one of:
  {"tool": name, "args": {...}}   a read: the right tool, with those argument values (subset match)
  {"write": name}                 a write: must produce a proposal for that tool (Phase 4+)
  {"denied": true}                the user's role must NOT get data (no successful tool call)
  {"blocked": true}               a blocked action: no write proposal, and an explanation
`accept` lists other tools that are an equally correct answer (e.g. the lookup `find_student` when the name matches several students).
`clarify` marks questions where asking a question first is a correct answer: it passes when the turn made no change and the reply asks
something (a tool asking "which subject?" through its error is exactly that).
"""


def _arg_matches(expected, actual):
    if isinstance(expected, str) and isinstance(actual, str):
        return expected.lower() in actual.lower()
    return expected == actual


def score(question: dict, tool_calls: list, proposals: list = None, reply: str = None) -> dict:
    """Return {'pass': bool, 'reason': str}. `tool_calls` is TurnResult.tool_calls;
    `proposals` is the list of proposed write tool names (empty until Phase 4)."""
    if proposals is None:   # proposals the assistant prepared this turn (write tools that succeeded)
        proposals = [c['name'] for c in tool_calls if c.get('kind') == 'write' and c.get('ok')]
    expect = question['expect']
    # report_missing_capability only logs a gap and returns nothing about the school, so it is not "data" for a denied question.
    ok_calls = [c for c in tool_calls if c.get('ok') and c.get('kind') != 'write' and c.get('name') != 'report_missing_capability']

    verdict = _score(question, expect, tool_calls, proposals, ok_calls)
    if verdict['pass']:
        return verdict
    if expect.get('clarify') and not proposals and reply and '?' in reply:
        return _res(True, '')
    return verdict


def _score(question, expect, tool_calls, proposals, ok_calls):
    if expect.get('denied'):
        return _res(not ok_calls and not proposals, 'data was returned to a user who must not get it')
    if expect.get('blocked'):
        return _res(not proposals and not ok_calls, 'a blocked action was attempted')
    if 'write' in expect:
        return _res(expect['write'] in proposals, f'no proposal for {expect["write"]}')
    want = expect['tool']
    hits = [c for c in tool_calls if c['name'] == want]
    if not hits and any(c['name'] in (expect.get('accept') or []) for c in tool_calls):
        return _res(True, '')
    if not hits:
        return _res(False, f'expected tool {want}, got {[c["name"] for c in tool_calls] or "none"}')
    for key, val in (expect.get('args') or {}).items():
        if not any(key in c.get('args', {}) and _arg_matches(val, c['args'][key]) for c in hits):
            return _res(False, f'{want}: argument {key}={val!r} missing')
    return _res(True, '')


def _res(passed, reason):
    return {'pass': bool(passed), 'reason': '' if passed else reason}


def summarize(results: list) -> dict:
    """results: [{'question': {...}, 'pass': bool, 'ms': int}] -> pass rates overall and by agent/lang/kind."""
    def kind(q):
        e = q['expect']
        return 'denied' if e.get('denied') else 'blocked' if e.get('blocked') else 'write' if 'write' in e else 'read'

    def rate(rows):
        return round(100 * sum(r['pass'] for r in rows) / len(rows), 1) if rows else None

    out = {'total': len(results), 'pass_rate': rate(results)}
    for name, fn in (('by_agent', lambda q: q['agent']), ('by_lang', lambda q: q['lang']), ('by_kind', kind)):
        groups = {}
        for r in results:
            groups.setdefault(fn(r['question']), []).append(r)
        out[name] = {k: {'n': len(v), 'pass_rate': rate(v)} for k, v in sorted(groups.items())}
    times = sorted(r.get('ms', 0) for r in results)
    out['median_ms'] = times[len(times) // 2] if times else None
    return out
