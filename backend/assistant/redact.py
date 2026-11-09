"""Redaction for text that is stored in AgentGap.

Why it exists: gap rows are read by the owner and school admins weeks later. A question like
"Ali Raza ke parents ka number 0300-1234567 do" must reach them as
"<student> ke parents ka number <phone> do". The raw message is never copied; if names cannot be
loaded we return '' rather than save something unredacted.
"""
import logging
import re

logger = logging.getLogger(__name__)

MAX_CHARS = 300
MIN_NAME_TOKEN = 3     # "Ali" is kept as a name, "a" / "ka" never are

_EMAIL = re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+')
_CNIC = re.compile(r'\b\d{5}-?\d{7}-?\d\b')
# 03xx-xxxxxxx, 0092 / +92 3xx xxxxxxx, with spaces or dashes
_PHONE = re.compile(r'(?:\+|00)?92[\s-]?3\d{2}[\s-]?\d{7}\b|\b03\d{2}[\s-]?\d{7}\b')
_LONG_ID = re.compile(r'\b\d{6,}\b')
_ARABIC = re.compile(r'[؀-ۿ]')
_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)

_ROMAN_URDU_WORDS = {
    'kya', 'hai', 'hain', 'ka', 'ki', 'ke', 'ko', 'mein', 'me', 'se', 'nahi', 'nahin', 'karo', 'karna', 'kar',
    'do', 'dikhao', 'batao', 'bata', 'mera', 'meri', 'mujhe', 'aaj', 'kal', 'wala', 'wali', 'tamam', 'sab',
    'bachon', 'bache', 'kitne', 'kitna', 'kaun', 'kon', 'kis', 'abhi', 'zara', 'liye', 'aur', 'ya',
}


def detect_language(text: str) -> str:
    """Cheap guess: Urdu script, Roman Urdu (several Urdu function words in Latin letters), else English."""
    if _ARABIC.search(text or ''):
        return 'ur'
    words = [w.lower() for w in _WORD.findall(text or '')]
    if sum(1 for w in words if w in _ROMAN_URDU_WORDS) >= 2:
        return 'ur_roman'
    return 'en'


def _tokens(full):
    return {w.lower() for w in _WORD.findall(full or '') if len(w) >= MIN_NAME_TOKEN}


def _names(school_id):
    """(student tokens, staff tokens) for THIS school only, lower-cased."""
    from hr.models import StaffMember
    from students.models import Student

    students = set()
    for full in Student.objects.filter(school_id=school_id).values_list('name', flat=True):
        students |= _tokens(full)
    staff = set()
    for first, last in StaffMember.objects.filter(school_id=school_id).values_list('first_name', 'last_name'):
        staff |= _tokens(first) | _tokens(last)
    # A word that is both a student and a staff name is hidden as a student; either way it is gone.
    return students, staff - students


def redact(text, school_id) -> str:
    """Redacted text, at most MAX_CHARS. Returns '' if redaction itself fails."""
    text = (text or '').strip()
    if not text:
        return ''
    try:
        students, staff = _names(school_id)
    except Exception:
        logger.exception('assistant redaction could not load names')
        return ''

    # Order matters: emails and phones first so their digits/letters are not half-matched later.
    text = _EMAIL.sub('<email>', text)
    text = _CNIC.sub('<id>', text)
    text = _PHONE.sub('<phone>', text)
    text = _LONG_ID.sub('<id>', text)

    def swap(match):
        word = match.group(0).lower()
        if word in students:
            return '<student>'
        if word in staff:
            return '<staff>'
        return match.group(0)

    text = _WORD.sub(swap, text)
    text = re.sub(r'(?:<student>\s*){2,}', '<student> ', text)    # "Ali Raza Khan" -> one marker
    text = re.sub(r'(?:<staff>\s*){2,}', '<staff> ', text)
    return re.sub(r'\s+', ' ', text).strip()[:MAX_CHARS]
