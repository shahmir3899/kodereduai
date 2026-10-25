"""Server copy of the playback rules in frontend/src/utils/guideProgressRules.js.

Keep COMPLETE_AT in step with the JS file: the browser shows a tick at that point and
the server must agree, otherwise a video looks done on one screen and not on the other.
"""

COMPLETE_AT = 0.85
MAX_RANGES = 200          # a real viewing merges into a handful; more is junk or abuse
MAX_DURATION = 6 * 3600   # longest video we would ever ship


def clean_ranges(raw, duration):
    """Drop malformed pairs and clamp to [0, duration]; returns merged ranges."""
    out = []
    if not isinstance(raw, (list, tuple)):
        return out
    for pair in raw[:MAX_RANGES * 4]:
        try:
            start, end = float(pair[0]), float(pair[1])
        except (TypeError, ValueError, IndexError, KeyError):
            continue
        if start != start or end != end:  # NaN
            continue
        start = max(0.0, start)
        end = min(end, duration) if duration else end
        if end > start:
            out.append([start, end])
    return merge_ranges(out)


def merge_ranges(ranges):
    ordered = sorted(([float(a), float(b)] for a, b in ranges), key=lambda r: r[0])
    merged = []
    for start, end in ordered:
        if merged and start <= merged[-1][1] + 0.5:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged[:MAX_RANGES]


def ranges_total(ranges):
    return sum(end - start for start, end in ranges)


def is_complete(ranges, duration):
    return bool(duration) and ranges_total(ranges) >= COMPLETE_AT * duration


def percent_played(ranges, duration):
    if not duration:
        return 0
    return min(100, round(ranges_total(ranges) / duration * 100))
