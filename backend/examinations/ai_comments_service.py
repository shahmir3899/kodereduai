"""
AI Report Card Comment Generator.

One LLM call per student (all of that student's subjects in a single JSON reply)
instead of one call per mark. Facts (percentages, strengths, weaknesses, attendance,
rank band) are computed here in plain code and handed to the model, which only
writes the wording. Every reply is validated; anything that fails validation, or
any failed call, falls back to a profile-based template comment for that student
only, so one bad reply never affects the rest of the class.
"""

import json
import logging
import re
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

SOURCE_AI = 'AI'
SOURCE_FALLBACK = 'FALLBACK'

MAX_PARALLEL_CALLS = 5
MIN_ATTENDANCE_DAYS = 5      # below this, attendance is not mentioned at all
LOW_ATTENDANCE = 80
HIGH_ATTENDANCE = 95
TREND_MIN_POINTS = 5         # smaller changes are noise, not mentioned
MIN_COMMENT_CHARS = 25
MAX_COMMENT_CHARS = 600

# Per-school settings live in School.exam_config (comment_tone / comment_length /
# comment_phrases); anything unrecognised falls back to the defaults below.
TONES = {
    'warm': 'warm, professional and encouraging',
    'formal': 'formal and professional',
    'brief': 'brief, factual and neutral',
}
LENGTHS = {
    'short': {'subject': '1 short sentence', 'overall': '1-2 sentences'},
    'standard': {'subject': '2 short sentences', 'overall': '2-3 sentences'},
    'detailed': {'subject': '3 sentences', 'overall': '3-4 sentences'},
}
MAX_PHRASES_CHARS = 300


def school_comment_style(school):
    """(tone text, length key, guidance text) from the school's exam settings.
    Shared by the report-card comments and the teacher/principal remarks so a
    school's tone/length/guidance choices apply to both."""
    cfg = (getattr(school, 'exam_config', None) or {}) if school is not None else {}
    raw_tone = cfg.get('comment_tone')
    tone = TONES.get(raw_tone) or (raw_tone if isinstance(raw_tone, str) and raw_tone.strip() else TONES['warm'])
    length = cfg.get('comment_length') if cfg.get('comment_length') in LENGTHS else 'standard'
    phrases = (cfg.get('comment_phrases') or '').strip()[:MAX_PHRASES_CHARS]
    return tone, length, phrases


def clean_text(text, low, high):
    """Trim/unquote a model reply; None if it is the wrong length or shouty."""
    if not isinstance(text, str):
        return None
    text = text.strip().strip('"')
    if not (low <= len(text) <= high) or text.count('!') > 1:
        return None
    return text


class _TokenLimiter:
    """Keeps every AI call under the provider's tokens-per-minute cap.

    The free/on-demand Groq tier allows only ~8000 tokens per minute for this
    model, and it counts a request's max_tokens *before* it runs. Without pacing,
    parallel workers trigger 429 errors, burn retries and fall back to template
    text. Each call reserves (prompt + max_tokens), waits if the last 60 seconds
    would exceed the budget, then settles to the real usage."""

    def __init__(self):
        self._lock = threading.Lock()
        self._events = []   # [timestamp, tokens]

    def acquire(self, tokens, limit):
        tokens = min(tokens, limit)
        while True:
            with self._lock:
                now = time.monotonic()
                self._events = [e for e in self._events if now - e[0] < 60]
                if sum(e[1] for e in self._events) + tokens <= limit:
                    event = [now, tokens]
                    self._events.append(event)
                    return event
                wait = 60 - (now - min(e[0] for e in self._events)) if self._events else 1
            time.sleep(min(max(wait, 0.5), 5))

    def settle(self, event, actual):
        with self._lock:
            event[1] = actual


_limiter = _TokenLimiter()


def _retry_after_seconds(error):
    """Seconds the provider says to wait ("try again in 6.58s" / "389ms"), if any."""
    match = re.search(r'try again in ([\d.]+)(ms|s)', str(error))
    if not match:
        return None
    value = float(match.group(1))
    return value / 1000 if match.group(2) == 'ms' else value


def llm_validated(prompt, validate, *, temperature, max_tokens, json_mode=False, attempts=4):
    """One place for the AI call: send the prompt, run the reply through `validate`
    (which returns a truthy result or a falsy value), retry once with a short
    backoff, and return None if nothing valid came back so the caller falls back.
    Safe to call from worker threads (no database access)."""
    if not settings.GROQ_API_KEY:
        return None
    limit = int(getattr(settings, 'GROQ_TPM_LIMIT', 6500) or 6500)
    for attempt in range(attempts):
        event = None
        try:
            from groq import Groq
            # max_retries=0: retries are handled here so they respect the pacing above.
            client = Groq(api_key=settings.GROQ_API_KEY, max_retries=0)
            kwargs = {'response_format': {"type": "json_object"}} if json_mode else {}
            budget = max_tokens
            if 'gpt-oss' in (settings.GROQ_MODEL or ''):
                # Reasoning models spend part of max_tokens on hidden thinking; with a
                # tight budget the reply is cut off mid-JSON and the call fails. Keep
                # the thinking short and leave generous headroom.
                kwargs['reasoning_effort'] = 'low'
                budget = max(max_tokens, 300) + 300
            event = _limiter.acquire(int(len(prompt) / 3.2) + budget, limit)
            response = client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=temperature,
                max_tokens=budget,
                timeout=60,
                **kwargs,
            )
            usage = getattr(response, 'usage', None)
            if usage and getattr(usage, 'total_tokens', None):
                _limiter.settle(event, usage.total_tokens)
            result = validate(response.choices[0].message.content)
            if result:
                return result
            logger.warning("AI reply failed validation (attempt %s)", attempt + 1)
        except Exception as e:
            if event is not None:
                _limiter.settle(event, 0)
            wait = _retry_after_seconds(e)
            logger.warning("Groq call failed (attempt %s): %s", attempt + 1, str(e)[:160])
            time.sleep(min((wait + 0.5) if wait else 1.5 * (attempt + 1), 15))
    return None

STUDENT_PROMPT_TEMPLATE = """You are writing report card comments for one student's exam.

Class: {class_name}
Tone: {tone}
Overall: {overall_pct:.0f}% (grade {overall_grade}){rank_line}
{attendance_line}
{trend_line}
All subject results:
{all_lines}
{strength_line}
Write comments for these subjects: {wanted_list}
{overall_instruction}
Rules:
- Write one comment ({subject_length}) for EACH subject to comment on, using ONLY the facts given here.
- Do not invent behaviour, effort, incidents, skills or activities (for example reading, writing, homework or class participation) or any fact not shown. Do not use the student's name.
- Strong result: acknowledge it and encourage. Average: note what to build on. Weak: be constructive and suggest support.
- Mention attendance only if the attendance line above says to; otherwise do not mention attendance.
- Mention the change from the previous exam only if the trend line above says to; never invent a trend.
- Use age-appropriate, simple language for the class shown. No exclamation marks.
- Do not repeat the marks, scores or percentages in the comments; the report card table already shows them. Comment on what the result means and what to do next.
- Vary the wording between subjects; do not start every comment the same way, and do not reuse the same closing phrase.
- Match the language to the class level shown: for the youngest classes (Playgroup, Nursery, Prep, KG) use warm, simple wording about what the child enjoys or is learning; do not use academic phrasing such as 'mastery' or 'diligent approach'.
{phrases_line}
Reply with ONLY a JSON object of the form {{"overall": "<overall comment or empty string>", "subjects": {{"<subject name>": "<comment>"}}}} using the exact subject names above. If no subjects are listed to comment on, use an empty subjects object."""


class ReportCardCommentGenerator:
    """Generates comments for student marks in an exam."""

    def __init__(self, school):
        self.school = school

    # ── public entry point ────────────────────────────────────────────────

    def generate_for_exam(self, exam_id, only_student_id=None, on_progress=None, should_cancel=None):
        """Generate comments for every complete student in an exam.

        Returns dict: generated, ai_generated, fallback_used, skipped (already had
        a comment), incomplete (students skipped: a subject not entered yet),
        errors, total.
        """
        from .models import Exam, ExamSubject, StudentMark, GradeScale, StudentExamComment

        try:
            exam = Exam.objects.select_related(
                'class_obj', 'term', 'academic_year',
            ).get(id=exam_id, school=self.school)
        except Exam.DoesNotExist:
            return {'generated': 0, 'errors': 0, 'total': 0, 'skipped': 0,
                    'error': 'Exam not found'}

        grade_scales = list(GradeScale.objects.filter(
            school=self.school, is_active=True,
        ).order_by('-min_percentage'))

        exam_subjects = list(ExamSubject.objects.filter(
            exam=exam, is_active=True,
        ).select_related('subject'))

        all_marks = list(StudentMark.objects.filter(
            exam_subject__in=exam_subjects, school=self.school,
        ).select_related('student', 'exam_subject', 'exam_subject__subject'))

        if not any(m.marks_obtained is not None and not m.is_absent for m in all_marks):
            return {'generated': 0, 'errors': 0, 'total': 0, 'skipped': 0,
                    'error': 'No marks entered yet'}

        existing_overall = {
            c.student_id: c for c in StudentExamComment.objects.filter(exam=exam, school=self.school)
        }
        marks_by_student = {}
        for m in all_marks:
            marks_by_student.setdefault(m.student_id, {})[m.exam_subject_id] = m

        # Complete = every active subject has a mark or an absence noted.
        complete, incomplete = {}, 0
        for student_id, by_subject in marks_by_student.items():
            if all(
                es.id in by_subject and (
                    by_subject[es.id].is_absent or by_subject[es.id].marks_obtained is not None
                )
                for es in exam_subjects
            ):
                complete[student_id] = by_subject
            else:
                incomplete += 1

        attendance = self._get_attendance(exam, list(complete.keys()))
        previous = self._get_previous_results(exam, list(complete.keys()))
        ranks = self._compute_ranks(complete, exam_subjects)
        tone, length, phrases = school_comment_style(self.school)

        # Build one job per student that still has un-commented, non-absent marks.
        jobs, skipped, total = [], 0, 0
        for student_id, by_subject in complete.items():
            if only_student_id and student_id != only_student_id:
                continue
            scored = [m for m in by_subject.values()
                      if m.marks_obtained is not None and not m.is_absent]
            total += len(scored)
            todo = [m for m in scored if not m.ai_comment]
            skipped += len(scored) - len(todo)
            need_overall = bool(scored) and student_id not in existing_overall
            if not todo and not need_overall:
                continue
            facts = self._build_facts(
                exam, student_id, scored, todo, grade_scales,
                attendance.get(student_id), ranks.get(student_id), tone,
            )
            facts['trend'] = self._trend(facts['overall_pct'], previous.get(student_id))
            facts['need_overall'] = need_overall
            facts['length'] = length
            facts['phrases'] = phrases
            jobs.append(facts)

        # LLM calls run in worker threads (no DB access there). Each student's result
        # is saved as soon as it arrives, so progress is real and a cancelled or
        # interrupted run keeps everything finished so far (re-running resumes).
        counts = {'generated': 0, 'ai': 0, 'fallback': 0, 'overall': 0, 'overall_ai': 0}
        now = timezone.now()
        model_name = getattr(settings, 'GROQ_MODEL', None)
        cancelled = False
        total_jobs = len(jobs)
        if on_progress:
            on_progress(0, total_jobs)

        def finish_one(index, facts, reply):
            self._save_student(exam, facts, reply, now, model_name, counts)
            if on_progress:
                on_progress(index + 1, total_jobs)

        if jobs and settings.GROQ_API_KEY:
            with ThreadPoolExecutor(max_workers=MAX_PARALLEL_CALLS) as pool:
                futures = {pool.submit(self._llm_comments_for_student, f): f for f in jobs}
                # Handle students in the order they finish, so the progress bar moves
                # as soon as any student is done instead of waiting on the slowest.
                for done_count, future in enumerate(as_completed(futures)):
                    if should_cancel and should_cancel():
                        cancelled = True
                        for pending in futures:
                            pending.cancel()
                        break
                    reply, _used_ai = future.result()
                    finish_one(done_count, futures[future], reply)
        else:
            for index, facts in enumerate(jobs):
                if should_cancel and should_cancel():
                    cancelled = True
                    break
                finish_one(index, facts, {})

        return {
            'generated': counts['generated'],
            'ai_generated': counts['ai'],
            'fallback_used': counts['fallback'],
            'overall_generated': counts['overall'],
            'overall_fallback': counts['overall'] - counts['overall_ai'],
            'skipped': skipped,
            'incomplete': incomplete,
            'errors': 0,
            'total': total,
            'students_done': total_jobs if not cancelled else None,
            'cancelled': cancelled,
        }

    def _save_student(self, exam, facts, reply, now, model_name, counts):
        from .models import StudentExamComment

        comments = reply.get('subjects', {})
        for m in facts['todo_marks']:
            name = m.exam_subject.subject.name
            text = comments.get(name)
            if text:
                counts['ai'] += 1
                source = SOURCE_AI
            else:
                text = self._fallback_comment(facts, m)
                counts['fallback'] += 1
                source = SOURCE_FALLBACK
            m.ai_comment = text
            m.ai_comment_generated_at = now
            m.ai_comment_source = source
            m.ai_model = model_name if source == SOURCE_AI else None
            m.save(update_fields=[
                'ai_comment', 'ai_comment_generated_at', 'ai_comment_source', 'ai_model',
            ])
            counts['generated'] += 1
        if facts['need_overall']:
            overall = reply.get('overall')
            counts['overall'] += 1
            counts['overall_ai'] += 1 if overall else 0
            StudentExamComment.objects.update_or_create(
                exam=exam, student_id=facts['student_id'], school=self.school,
                defaults={
                    'comment': overall or self._fallback_overall(facts),
                    'source': SOURCE_AI if overall else SOURCE_FALLBACK,
                    'ai_model': model_name if overall else None,
                    'generated_at': now,
                },
            )

    # ── facts ─────────────────────────────────────────────────────────────

    def _build_facts(self, exam, student_id, scored, todo, grade_scales,
                     attendance, rank, tone):
        subjects = []
        obtained_sum = possible_sum = 0.0
        for m in scored:
            es = m.exam_subject
            pct = float(m.marks_obtained) / float(es.total_marks) * 100 if es.total_marks else 0
            obtained_sum += float(m.marks_obtained)
            possible_sum += float(es.total_marks)
            subjects.append({
                'name': es.subject.name,
                'obtained': float(m.marks_obtained),
                'total': float(es.total_marks),
                'pct': pct,
                'grade': self._get_grade(pct, grade_scales),
                'passed': m.marks_obtained >= es.passing_marks,
            })
        overall_pct = obtained_sum / possible_sum * 100 if possible_sum else 0
        ranked = sorted(subjects, key=lambda s: s['pct'], reverse=True)
        strongest = [s for s in ranked[:2] if s['pct'] >= 60]
        weakest = [s for s in reversed(ranked[-2:]) if s['pct'] < 60 and s not in strongest]
        return {
            'student_id': student_id,
            'class_name': exam.class_obj.name,
            'tone': tone,
            'subjects': {s['name']: s for s in subjects},
            'todo_marks': todo,
            'overall_pct': overall_pct,
            'overall_grade': self._get_grade(overall_pct, grade_scales),
            'strongest': strongest,
            'weakest': weakest,
            'rank': rank,
            'attendance': attendance,
        }

    def _attendance_note(self, attendance):
        """(prompt_instruction, fallback_sentence). Both empty when there isn't
        enough data to say anything honest."""
        if not attendance:
            return '', ''
        pct, present, counted = attendance['pct'], attendance['present'], attendance['counted']
        if pct < LOW_ATTENDANCE:
            return (
                f'Attendance: present {present} of {counted} school days ({pct:.0f}%). '
                'This is low: mention it once as a factor that may be affecting learning.',
                f'Attendance ({pct:.0f}%, {present} of {counted} days) is low and may be affecting progress.',
            )
        if pct >= HIGH_ATTENDANCE:
            return (
                f'Attendance: present {present} of {counted} school days ({pct:.0f}%). '
                'This is excellent: you may mention it briefly as a positive.',
                f'Excellent attendance ({pct:.0f}%) supports steady learning.',
            )
        return f'Attendance: {pct:.0f}% ({present} of {counted} days). Do not mention attendance.', ''

    def _trend(self, current_pct, prev):
        """Change in overall percentage since the previous exam (None if no
        previous result). Only a change of TREND_MIN_POINTS or more is reported."""
        if not prev:
            return None
        delta = current_pct - prev['pct']
        if abs(delta) < TREND_MIN_POINTS:
            return None
        return {'delta': delta, 'prev_pct': prev['pct'], 'prev_name': prev['name']}

    def _trend_note(self, trend):
        """(prompt_instruction, fallback_sentence); empty when there is no trend."""
        if not trend:
            return 'Trend: no meaningful change from the previous exam. Do not mention a trend.', ''
        delta, prev_pct, name = trend['delta'], trend['prev_pct'], trend['prev_name']
        if delta > 0:
            return (
                f'Trend: overall result improved by {delta:.0f} percentage points since "{name}" '
                f'({prev_pct:.0f}% before). Mention this improvement briefly and encourage it.',
                f'Improved by {delta:.0f} percentage points since the previous exam.',
            )
        return (
            f'Trend: overall result fell by {abs(delta):.0f} percentage points since "{name}" '
            f'({prev_pct:.0f}% before). Mention this gently and constructively, without blame.',
            f'Down {abs(delta):.0f} percentage points from the previous exam, so a little extra focus is advised.',
        )

    # ── LLM ───────────────────────────────────────────────────────────────

    def _llm_comments_for_student(self, facts):
        """Returns ({subject_name: comment}, used_ai). Empty dict => caller falls back.
        Runs in a worker thread: no database access allowed here."""
        wanted = [m.exam_subject.subject.name for m in facts['todo_marks']]
        prompt = self._build_prompt(facts, wanted)
        need_overall = facts['need_overall']
        reply = llm_validated(
            prompt,
            lambda raw: self._parse_and_validate(raw, wanted, need_overall),
            temperature=0.3,
            max_tokens=75 * len(wanted) + (130 if need_overall else 0) + 60,
            json_mode=True,
        )
        return (reply, True) if reply else ({}, False)

    def _build_prompt(self, facts, wanted):
        all_lines = '\n'.join(
            f"- {s['name']}: {s['obtained']:g}/{s['total']:g} ({s['pct']:.0f}%, grade {s['grade']}, "
            f"{'Pass' if s['passed'] else 'Fail'})"
            for s in facts['subjects'].values()
        )
        overall_instruction = (
            f'Also write an "overall" comment ({LENGTHS[facts.get("length", "standard")]["overall"]}) summarising the whole result: '
            'level of achievement, the strongest area, and what to focus on next.'
            if facts['need_overall'] else 'Set "overall" to an empty string.'
        )
        parts = []
        if facts['strongest']:
            parts.append('Strongest: ' + ', '.join(f"{s['name']} ({s['pct']:.0f}%)" for s in facts['strongest']))
        if facts['weakest']:
            parts.append('Needs most support: ' + ', '.join(f"{s['name']} ({s['pct']:.0f}%)" for s in facts['weakest']))
        rank = facts['rank']
        rank_line = f", placed {rank} in the class" if rank and rank <= 3 else ''
        return STUDENT_PROMPT_TEMPLATE.format(
            class_name=facts['class_name'],
            tone=facts['tone'],
            overall_pct=facts['overall_pct'],
            overall_grade=facts['overall_grade'],
            rank_line=rank_line,
            attendance_line=self._attendance_note(facts['attendance'])[0],
            trend_line=self._trend_note(facts.get('trend'))[0],
            all_lines=all_lines,
            subject_length=LENGTHS[facts.get('length', 'standard')]['subject'],
            phrases_line=(
                f"- School guidance (follow it as long as it does not conflict with the rules above): {facts['phrases']}\n"
                if facts.get('phrases') else ''
            ),
            wanted_list=', '.join(wanted) if wanted else '(none)',
            overall_instruction=overall_instruction,
            strength_line=('Context: ' + '; '.join(parts) + '\n') if parts else '',
        )

    def _parse_and_validate(self, raw, wanted, need_overall=False):
        """Strict check: valid JSON, every wanted subject present with a sensible
        string, and an overall comment when one was requested. Returns {} on any
        problem so the caller falls back."""
        try:
            data = json.loads(raw)
            comments = data.get('subjects', {})
        except Exception:
            return {}
        if not isinstance(comments, dict):
            return {}
        cleaned = {}
        for name in wanted:
            text = self._clean_text(comments.get(name), MIN_COMMENT_CHARS, MAX_COMMENT_CHARS)
            if not text:
                return {}
            cleaned[name] = text
        overall = None
        if need_overall:
            overall = self._clean_text(data.get('overall'), 40, 600)
            if not overall:
                return {}
        return {'subjects': cleaned, 'overall': overall}

    @staticmethod
    def _clean_text(text, low, high):
        return clean_text(text, low, high)

    # ── fallback ──────────────────────────────────────────────────────────

    def _fallback_comment(self, facts, mark):
        """Profile-based template: uses this student's own strengths/weaknesses,
        picks between phrasings by a stable hash so a class doesn't read identically."""
        name = mark.exam_subject.subject.name
        s = facts['subjects'][name]
        pct = s['pct']
        digest = zlib.crc32(f"{facts['student_id']}:{name}".encode())
        variant = digest % 5
        closing_variant = (digest // 5) % 3

        # No marks or percentages in these: the table already shows them, and repeating
        # "45 out of 50" in every comment made the whole card read like one sentence.
        if pct >= 90:
            options = [
                f"Shows a very secure understanding of {name}.",
                f"{name} is a real strength; the effort here is clearly paying off.",
                f"Confident, accurate work throughout {name}.",
                f"A pleasure to see such command of {name}.",
                f"Has mastered the key ideas in {name}.",
            ]
            closings = [
                "Keep challenging yourself with harder tasks.",
                "Enrichment activities would suit this level well.",
                "Sharing this approach with classmates would help others too.",
            ]
        elif pct >= 75:
            options = [
                f"Solid understanding of the key ideas in {name}.",
                f"Reliable work in {name}, built on a firm grasp of the basics.",
                f"Confident progress in {name} with a strong foundation in place.",
                f"{name} is going well and shows steady effort.",
                f"Good, consistent work in {name}.",
            ]
            closings = [
                "A little more practice on tricky questions can lift this further.",
                "Reading questions carefully will help secure the last few marks.",
                "Regular short revision will keep this growing.",
            ]
        elif pct >= 60:
            options = [
                f"A fair grasp of the basics in {name}.",
                f"{name} is progressing steadily, with understanding that can still grow.",
                f"Making steady headway in {name}, with room to gain confidence.",
                f"Shows the beginnings of a secure understanding in {name}.",
                f"Satisfactory work in {name} that has clear scope to improve.",
            ]
            closings = [
                "Regular revision at home will help turn this into a stronger result.",
                "Practising a little each day will build confidence.",
                "Going over corrected work would help fix the common slips.",
            ]
        elif s['passed']:
            options = [
                f"{name} needs more attention; the pass mark was reached, but only just.",
                f"{name} would benefit from extra practice.",
                f"The basics in {name} need strengthening.",
                f"A modest result in {name} with clear room to improve.",
                f"{name} is an area to focus on next term.",
            ]
            closings = [
                "Short daily practice on the weaker topics is recommended.",
                "Revisiting the earlier topics together would help.",
                "Extra practice at home will make a real difference.",
            ]
        else:
            options = [
                f"{name} needs significant support, as the pass mark was not reached.",
                f"Extra help is needed in {name} to build the foundations.",
                f"{name} needs focused attention and support.",
                f"The result in {name} is below the pass mark and needs attention.",
                f"Foundations in {name} need rebuilding with patient support.",
            ]
            closings = [
                "Extra guidance or remedial sessions are recommended.",
                "Working through the basics step by step is advised.",
                "Please speak with the teacher about a support plan.",
            ]
        closing = closings[closing_variant]

        sentence = options[variant] if facts.get('length') == 'short' else f"{options[variant]} {closing}"
        strongest = [x['name'] for x in facts['strongest'] if x['name'] != name]
        if pct < 60 and strongest:
            sentence += f" Strengths in {strongest[0]} show what the student can achieve."
        note = self._attendance_note(facts['attendance'])[1]
        if note:
            sentence += f" {note}"
        return sentence

    def _fallback_overall(self, facts):
        """Template overall comment from the student's own profile."""
        pct, grade = facts['overall_pct'], facts['overall_grade']
        if pct >= 90:
            opening = f"An outstanding result overall ({pct:.0f}%, grade {grade})."
        elif pct >= 75:
            opening = f"A good result overall ({pct:.0f}%, grade {grade})."
        elif pct >= 60:
            opening = f"A satisfactory result overall ({pct:.0f}%, grade {grade})."
        elif pct >= 40:
            opening = f"A fair result overall ({pct:.0f}%, grade {grade}) with clear room to improve."
        else:
            opening = f"This result ({pct:.0f}%, grade {grade}) shows the student needs significant support."
        parts = [opening]
        if facts['rank'] and facts['rank'] <= 3:
            parts.append(f"Placed {facts['rank']} in the class.")
        if facts['strongest']:
            parts.append('Strongest in ' + ' and '.join(x['name'] for x in facts['strongest']) + '.')
        if facts['weakest']:
            parts.append('Would benefit from extra practice in ' + ' and '.join(x['name'] for x in facts['weakest']) + '.')
        trend_sentence = self._trend_note(facts.get('trend'))[1]
        if trend_sentence:
            parts.append(trend_sentence)
        note = self._attendance_note(facts['attendance'])[1]
        if note:
            parts.append(note)
        return ' '.join(parts)

    # ── data helpers ──────────────────────────────────────────────────────

    def _compute_ranks(self, complete, exam_subjects):
        """Dense rank by overall percentage across students with complete marks."""
        pcts = {}
        for student_id, by_subject in complete.items():
            got = total = 0.0
            for es in exam_subjects:
                m = by_subject.get(es.id)
                total += float(es.total_marks)
                if m and m.marks_obtained is not None and not m.is_absent:
                    got += float(m.marks_obtained)
            pcts[student_id] = round(got / total * 100, 2) if total else 0
        ranks, rank, prev = {}, 0, None
        for student_id, pct in sorted(pcts.items(), key=lambda kv: -kv[1]):
            if pct != prev:
                rank += 1
                prev = pct
            ranks[student_id] = rank
        return ranks

    def _get_attendance(self, exam, student_ids):
        """Attendance exactly as the report card header states it (same window, off days
        and counting - see term_periods.attendance_summaries). A student whose days are
        not all recorded, or with fewer than MIN_ATTENDANCE_DAYS working days, gets no
        entry, so the comment says nothing rather than quoting a number the card withholds."""
        from .term_periods import attendance_summaries, report_attendance_window
        start, end = report_attendance_window([exam], exam.academic_year)
        summaries = attendance_summaries(self.school.id, student_ids, start, end, exam.class_obj_id)
        return {
            sid: {'pct': s['percentage'], 'present': s['present'], 'counted': s['working_days']}
            for sid, s in summaries.items()
            if s['percentage'] is not None and s['working_days'] >= MIN_ATTENDANCE_DAYS
        }

    def _get_previous_results(self, exam, student_ids):
        """Overall percentage per student in the most recent earlier exam of the
        same class and academic year. {} when there is no earlier exam."""
        from .models import Exam, StudentMark

        if not (exam.start_date and student_ids):
            return {}
        prev_exam = Exam.objects.filter(
            school=self.school, class_obj_id=exam.class_obj_id,
            academic_year_id=exam.academic_year_id, is_active=True,
            start_date__lt=exam.start_date,
        ).order_by('-start_date').first()
        if not prev_exam:
            return {}
        totals = {}
        marks = StudentMark.objects.filter(
            exam_subject__exam=prev_exam, exam_subject__is_active=True,
            school=self.school, student_id__in=student_ids,
            marks_obtained__isnull=False, is_absent=False,
        ).select_related('exam_subject')
        for m in marks:
            t = totals.setdefault(m.student_id, [0.0, 0.0])
            t[0] += float(m.marks_obtained)
            t[1] += float(m.exam_subject.total_marks)
        return {
            sid: {'pct': got / possible * 100, 'name': prev_exam.name}
            for sid, (got, possible) in totals.items() if possible > 0
        }

    def _get_grade(self, percentage, grade_scales):
        for gs in grade_scales:
            if float(gs.min_percentage) <= percentage <= float(gs.max_percentage):
                return gs.grade_label
        return '-'


ASSESSMENT_REMARK_PROMPT_TEMPLATE = """Write a remark for a student's monthly progress assessment.

Ratings given (scale: Needs Improvement, Fair, Good, Very Good, Excellent):
{ratings_lines}

Who is writing: {persona}
Tone: {tone}
Length: {length_rule}

Rules:
- Be professional, encouraging, and constructive
- Do NOT include the student's name in the remark
- Base the remark only on the ratings given above; do not invent specific incidents or facts not implied by them
- Do not use exclamation marks
{avoid_line}{phrases_line}
Remark:"""

# Each role keeps its own voice: sharing the plumbing must not make the two read alike.
REMARK_PERSONAS = {
    'teacher': "a classroom teacher's personal observation, referring to the specific skills or behaviours that stand out",
    'principal': 'a brief, formal evaluative overview for a principal sign-off: more concise and less specific than a teacher note, '
                 'looking at the overall picture rather than listing individual skills',
}
REMARK_LENGTHS = {
    'teacher': {'short': '1-2 sentences', 'standard': '2-3 sentences', 'detailed': '3-4 sentences'},
    'principal': {'short': '1 sentence', 'standard': '1-2 sentences', 'detailed': '2-3 sentences'},
}
RATING_ORDER = ['Needs Improvement', 'Fair', 'Good', 'Very Good', 'Excellent']


def generate_term_assessment_remark(ratings, remark_type='teacher', school=None, other_remark=''):
    """
    Draft a teacher/principal remark from a student's monthly skill/behaviour ratings.

    `ratings` is a dict of {field_label: rating_value} where rating_value is 1-5
    (matching StudentTermAssessment.Rating) or falsy for "not rated" fields, which
    are skipped. `school` supplies the school's tone/length/guidance settings, and
    `other_remark` (the teacher's text, when drafting the principal's) is passed so
    the two remarks don't repeat each other. Returns (remark_text, used_fallback);
    remark_text is None if nothing is rated yet.
    """
    from .models import StudentTermAssessment

    rating_labels = dict(StudentTermAssessment.Rating.choices)
    rated_items = []
    for label, value in (ratings or {}).items():
        if value in (None, ''):
            continue
        try:
            rating_int = int(value)
        except (TypeError, ValueError):
            continue
        if rating_int in rating_labels:
            rated_items.append((label, rating_labels[rating_int]))

    if not rated_items:
        return None, False

    role = remark_type if remark_type in REMARK_PERSONAS else 'teacher'
    tone, length, phrases = school_comment_style(school)

    avoid = (other_remark or '').strip()[:600]
    prompt = ASSESSMENT_REMARK_PROMPT_TEMPLATE.format(
        ratings_lines='\n'.join(f'- {label}: {rating}' for label, rating in rated_items),
        persona=REMARK_PERSONAS[role],
        tone=tone,
        length_rule=REMARK_LENGTHS[role][length],
        avoid_line=(
            f'- The class teacher has already written: "{avoid}". Do NOT repeat its points or wording; add the wider overview instead.\n'
            if avoid and role == 'principal' else ''
        ),
        phrases_line=(
            f"- School guidance (follow it as long as it does not conflict with the rules above): {phrases}\n"
            if phrases else ''
        ),
    )
    remark = llm_validated(
        prompt, lambda raw: clean_text(raw, 25, 500),
        temperature=0.5, max_tokens=200,
    )
    if remark:
        return remark, False
    return _generate_rule_based_remark(rated_items, role, length), True


def _generate_rule_based_remark(rated_items, remark_type='teacher', length='standard'):
    """Fallback without an LLM, worded differently for each role."""
    ranked = sorted(rated_items, key=lambda item: RATING_ORDER.index(item[1]))
    lowest_label, lowest_rating = ranked[0]
    highest_label, highest_rating = ranked[-1]
    low_rank, high_rank = RATING_ORDER.index(lowest_rating), RATING_ORDER.index(highest_rating)
    average = sum(RATING_ORDER.index(r) for _, r in rated_items) / len(rated_items)

    if remark_type == 'principal':
        if average >= 3:
            sentence = "Overall conduct and skills are very good this month, reflecting consistent effort."
        elif average >= 2:
            sentence = "Overall progress is good this month, with steady effort across most areas."
        else:
            sentence = "Overall progress is developing and would benefit from continued support at school and home."
        if length != 'short' and lowest_label != highest_label and low_rank <= 1:
            sentence += f" Continued attention to {lowest_label.lower()} is advised."
        return sentence

    if high_rank >= 3:
        sentence = f"Shows {highest_rating.lower()} progress in {highest_label.lower()}."
    else:
        sentence = f"Rated {highest_rating.lower()} across most areas this month."
    if length != 'short':
        if lowest_label != highest_label and low_rank <= 1:
            sentence += f" {lowest_label} needs continued attention and encouragement."
        else:
            sentence += " Continue encouraging consistent effort across all areas."
    return sentence
