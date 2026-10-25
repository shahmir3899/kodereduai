"""
Holiday suggestions for the academic calendar, read from Google's public "Holidays in Pakistan" calendar.

Suggestions only: nothing here writes to the calendar. The admin picks which ones to add, and each becomes
an ordinary OFF-day entry through the normal create API. The feed is public (no key, no school data is
sent); it is fetched at most once a day and cached. If Google cannot be reached the caller gets
``available: False`` and the page simply says suggestions cannot load right now.

The feed lists multi-day holidays as separate single days with slightly different names
("Eid-ul-Fitr", "Eid-ul-Fitr Holiday"), so consecutive days of the same holiday are merged into one range.
"""
import logging
import re
from datetime import date, timedelta

import requests
from django.conf import settings
from django.core.cache import cache

from .models import SchoolCalendarEntry

logger = logging.getLogger(__name__)

FEED_URL = 'https://calendar.google.com/calendar/ical/en.pk%23holiday%40group.v.calendar.google.com/public/basic.ics'
CACHE_KEY = 'holiday_feed:pk:v1'
CACHE_SECONDS = 24 * 60 * 60
FETCH_TIMEOUT = 8
# An existing OFF entry this short is treated as that holiday already being entered; a long one (a
# summer vacation) overlaps many holidays without naming them.
ALREADY_ENTERED_MAX_DAYS = 7

RELIGIOUS_WORDS = ('eid', 'ashura', 'milad', 'ramadan', 'muharram', 'shab', 'giarhwin', 'nabi')


def _unescape(value):
    return value.replace('\\n', ' ').replace('\\,', ',').replace('\\;', ';').replace('\\\\', '\\').strip()


def _parse_day(value):
    # DTSTART;VALUE=DATE:20260101 -> 2026-01-01 (a timed value keeps just its date part)
    digits = re.sub(r'\D', '', value)[:8]
    return date(int(digits[:4]), int(digits[4:6]), int(digits[6:8])) if len(digits) == 8 else None


def parse_ics(text):
    """Events of an iCalendar file as dicts: name, start, end (inclusive), public (bool)."""
    lines = []
    for raw in text.replace('\r\n', '\n').split('\n'):
        if raw.startswith((' ', '\t')) and lines:
            lines[-1] += raw[1:]  # a folded line continues the previous one
        else:
            lines.append(raw)

    events, current = [], None
    for line in lines:
        if line == 'BEGIN:VEVENT':
            current = {}
        elif line == 'END:VEVENT':
            if current and current.get('DTSTART') and current.get('SUMMARY'):
                start = _parse_day(current['DTSTART'])
                end_exclusive = _parse_day(current['DTEND']) if current.get('DTEND') else None
                if start:
                    end = (end_exclusive - timedelta(days=1)) if end_exclusive and end_exclusive > start else start
                    events.append({
                        'name': _unescape(current['SUMMARY']),
                        'start': start,
                        'end': end,
                        'public': _unescape(current.get('DESCRIPTION', '')).lower().startswith('public holiday'),
                    })
            current = None
        elif current is not None and ':' in line:
            key, _, value = line.partition(':')
            current.setdefault(key.split(';')[0], value)
    return events


def _fetch_feed():
    cached = cache.get(CACHE_KEY)
    if cached is not None:
        return cached
    response = requests.get(FEED_URL, timeout=FETCH_TIMEOUT, headers={'User-Agent': 'EducationAI-calendar/1.0'})
    response.raise_for_status()
    events = parse_ics(response.content.decode('utf-8', errors='replace'))
    cache.set(CACHE_KEY, events, CACHE_SECONDS)
    return events


def _plain_name(name):
    return re.sub(r'\s*\(tentative\)\s*$', '', name, flags=re.IGNORECASE).strip()


def _base_name(name):
    return re.sub(r'\s+Holiday$', '', _plain_name(name), flags=re.IGNORECASE).strip()


def _merge(events):
    """One range per holiday: same base name and kind, on consecutive days."""
    groups = {}
    for ev in events:
        groups.setdefault((_base_name(ev['name']).lower(), ev['public']), []).append(ev)

    merged = []
    for (_, public), items in groups.items():
        items.sort(key=lambda e: e['start'])
        run = None
        for ev in items:
            if run and ev['start'] <= run['end'] + timedelta(days=1):
                run['end'] = max(run['end'], ev['end'])
                run['tentative'] = run['tentative'] or '(tentative)' in ev['name'].lower()
            else:
                if run:
                    merged.append(run)
                run = {
                    # Shown as the shortest spelling in the group ("Eid-ul-Fitr" over "Eid-ul-Fitr Holiday"),
                    # so a holiday whose real name ends in "Holiday" ("July 1 Bank Holiday") keeps it.
                    'name': min((_plain_name(e['name']) for e in items if _base_name(e['name']) == _base_name(ev['name'])), key=len),
                    'start': ev['start'],
                    'end': ev['end'],
                    'public': public,
                    'tentative': '(tentative)' in ev['name'].lower(),
                }
        if run:
            merged.append(run)
    return merged


def _suggested_type(item):
    if not item['public']:
        return SchoolCalendarEntry.OffDayType.OTHER
    lowered = item['name'].lower()
    if any(word in lowered for word in RELIGIOUS_WORDS):
        return SchoolCalendarEntry.OffDayType.RELIGIOUS_HOLIDAY
    return SchoolCalendarEntry.OffDayType.NATIONAL_HOLIDAY


def holiday_suggestions(school_id, academic_year):
    if not getattr(settings, 'HOLIDAY_SUGGESTIONS_ENABLED', True):
        return {'available': False, 'reason': 'disabled', 'suggestions': []}
    try:
        events = _fetch_feed()
    except Exception:  # noqa: BLE001 - any network or parse failure just means "not available right now"
        logger.warning('Holiday feed unavailable', exc_info=True)
        return {'available': False, 'reason': 'unreachable', 'suggestions': []}

    start, end = academic_year.start_date, academic_year.end_date
    in_year = [e for e in events if e['end'] >= start and e['start'] <= end]

    existing = [
        (e.start_date, e.end_date)
        for e in SchoolCalendarEntry.objects.filter(
            school_id=school_id, academic_year=academic_year, is_active=True,
            entry_kind=SchoolCalendarEntry.EntryKind.OFF_DAY,
        )
        if (e.end_date - e.start_date).days + 1 <= ALREADY_ENTERED_MAX_DAYS
    ]

    suggestions = []
    for item in sorted(_merge(in_year), key=lambda i: (i['start'], i['name'])):
        days = [item['start'] + timedelta(days=n) for n in range((item['end'] - item['start']).days + 1)]
        suggestions.append({
            'name': item['name'],
            'start_date': item['start'].isoformat(),
            'end_date': item['end'].isoformat(),
            'kind': 'public' if item['public'] else 'observance',
            'tentative': item['tentative'],
            'suggested_type': _suggested_type(item),
            'falls_on_sunday': all(d.weekday() == 6 for d in days),
            'already_entered': any(s <= item['end'] and e >= item['start'] for s, e in existing),
        })

    return {
        'available': True,
        'reason': '',
        'source': 'Google Calendar: Holidays in Pakistan',
        # The feed only runs to some date; holidays after it have to be entered by hand.
        'covered_until': max(e['end'] for e in events).isoformat() if events else None,
        'suggestions': suggestions,
    }
