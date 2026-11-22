"""
The ten scored measures. Each takes the report Context and returns, for the whole school at once,

    {staff_id: {'due': float, 'done': float, 'on_time': float, 'credit': float, 'missed': [...]}}

`credit` is the partly-weighted done count the score is built from (credit ÷ due). A teacher missing
from the result, or with due == 0, does not have that measure: scoring drops it and rescales.

Rules shared by every measure:
- Only days up to today are due; future days in the range are not counted yet.
- An item whose deadline has not passed and that is not done yet is "not yet due" and left out,
  so a teacher is never marked down for something they still have time to do.
- Done late earns half, except attendance, which follows its own cut-off rule.
- Whole-school grouped queries only: no per-teacher queries and no queryset iterator() (the
  production database sits behind a transaction pooler).
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from functools import cached_property

from django.db.models import Count, F, Min, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce, TruncDate

from .periods import daterange, months_for, weeks_for

LATE_CREDIT = 0.5
MAX_MISSED = 30

DAY_CODES = {'MON': 0, 'TUE': 1, 'WED': 2, 'THU': 3, 'FRI': 4, 'SAT': 5}


@dataclass
class Context:
    school_id: int
    start: date
    end: date
    now: datetime            # aware, in the school's zone
    tz: object
    cfg: object              # hr.TeacherPerformanceConfig
    teachers: dict           # staff_id -> {'user_id', 'name', 'joined'}
    year_ids: list
    calendar: object         # periods.Calendar
    leave: dict = field(default_factory=dict)

    @property
    def today(self):
        return self.now.date()

    @property
    def eff_end(self):
        return min(self.end, self.today)

    @property
    def staff_ids(self):
        return list(self.teachers)

    @cached_property
    def user_to_staff(self):
        return {t['user_id']: sid for sid, t in self.teachers.items() if t['user_id']}

    def local(self, dt):
        return dt.astimezone(self.tz)

    def personal_days(self, staff_id):
        """The teacher's own working days: school staff calendar, after joining, minus approved leave."""
        cache = self.__dict__.setdefault('_personal_days', {})
        if staff_id not in cache:
            if self.eff_end < self.start:
                cache[staff_id] = []
            else:
                joined = self.teachers[staff_id].get('joined')
                leave = self.leave.get(staff_id, set())
                cache[staff_id] = [
                    d for d in self.calendar.staff_working_days(self.start, self.eff_end)
                    if d not in leave and (not joined or d >= joined)
                ]
        return cache[staff_id]

    def day_start(self, d):
        return datetime.combine(d, time.min, tzinfo=self.tz)


def _row():
    return {'due': 0.0, 'done': 0.0, 'on_time': 0.0, 'credit': 0.0, 'missed': []}


def _miss(row, item):
    if len(row['missed']) < MAX_MISSED:
        row['missed'].append(item)


def _year_q(ctx, field_name='academic_year_id'):
    return Q(**{f'{field_name}__in': ctx.year_ids}) | Q(**{f'{field_name.replace("_id", "")}__isnull': True})


# ── 1. Class attendance marked ───────────────────────────────────────────────

def attendance_marking(ctx):
    """Scored by responsibility: the class teacher owns each section's register for every working
    day, whoever pressed the button. Full credit before the cut-off, half later that day, none after."""
    from academic_sessions.models import StudentEnrollment
    from academics.models import ClassTeacherAssignment
    from attendance.models import AttendanceRecord
    from students.models import Student

    out = {}
    if ctx.eff_end < ctx.start:
        return out

    assignments = list(
        ClassTeacherAssignment.objects.filter(
            school_id=ctx.school_id, is_active=True, teacher_id__in=ctx.staff_ids,
        ).filter(_year_q(ctx)).values(
            'teacher_id', 'class_obj_id', 'session_class_id', 'class_obj__name',
            'session_class__display_name', 'session_class__section',
        )
    )
    if not assignments:
        return out

    section_ids = {a['session_class_id'] for a in assignments if a['session_class_id']}
    legacy_class_ids = {a['class_obj_id'] for a in assignments if not a['session_class_id']}

    # A section with nobody enrolled has no register to mark.
    section_size = dict(
        StudentEnrollment.objects.filter(
            school_id=ctx.school_id, session_class_id__in=section_ids, is_active=True,
        ).values('session_class_id').annotate(n=Count('id')).values_list('session_class_id', 'n')
    )
    class_size = dict(
        Student.objects.filter(
            school_id=ctx.school_id, class_obj_id__in=legacy_class_ids, is_active=True,
        ).values('class_obj_id').annotate(n=Count('id')).values_list('class_obj_id', 'n')
    )

    # First save time per (section, date). The section comes from the student's active enrollment.
    first_marked = {}
    records = AttendanceRecord.objects.filter(
        school_id=ctx.school_id, date__range=(ctx.start, ctx.eff_end),
    )
    if section_ids:
        section_of = StudentEnrollment.objects.filter(
            student_id=OuterRef('student_id'), session_class_id__in=section_ids, is_active=True,
        ).values('session_class_id')[:1]
        for row in (
            records.annotate(sc=Subquery(section_of)).filter(sc__isnull=False)
            .values('sc', 'date').annotate(first=Min('created_at')).order_by()
        ):
            first_marked[(('s', row['sc']), row['date'])] = row['first']
    if legacy_class_ids:
        for row in (
            records.filter(student__class_obj_id__in=legacy_class_ids)
            .values('student__class_obj_id', 'date').annotate(first=Min('created_at')).order_by()
        ):
            first_marked[(('c', row['student__class_obj_id']), row['date'])] = row['first']

    cutoff = ctx.cfg.attendance_cutoff_time
    for a in assignments:
        if a['session_class_id']:
            key = ('s', a['session_class_id'])
            if not section_size.get(a['session_class_id']):
                continue
            label = a['session_class__display_name'] + (f" - {a['session_class__section']}" if a['session_class__section'] else '')
        else:
            key = ('c', a['class_obj_id'])
            if not class_size.get(a['class_obj_id']):
                continue
            label = a['class_obj__name']

        staff_id = a['teacher_id']
        row = out.setdefault(staff_id, _row())
        leave = ctx.leave.get(staff_id, set())
        joined = ctx.teachers[staff_id].get('joined')
        for d in ctx.calendar.class_working_days(a['class_obj_id'], ctx.start, ctx.eff_end):
            if d in leave or (joined and d < joined):
                continue
            first = first_marked.get((key, d))
            if first is None and d == ctx.today and ctx.now.time() < cutoff:
                continue  # still time to mark today
            row['due'] += 1
            if first is None:
                _miss(row, {'date': d.isoformat(), 'section': label, 'reason': 'not marked'})
                continue
            local = ctx.local(first)
            row['done'] += 1
            if local.date() < d or (local.date() == d and local.time() < cutoff):
                row['on_time'] += 1
                row['credit'] += 1
            elif local.date() == d:
                row['credit'] += LATE_CREDIT
                _miss(row, {'date': d.isoformat(), 'section': label, 'reason': f'marked late ({local:%H:%M})'})
            else:
                _miss(row, {'date': d.isoformat(), 'section': label, 'reason': f'marked on {local.date().isoformat()}'})
    return out


# ── 2. Lesson plans ──────────────────────────────────────────────────────────

def lesson_plans(ctx):
    """Due: every timetable period on a working day. Done: published plans for that class and
    subject dated that day, at most one per period. On time when created on or before the lesson."""
    from academics.models import TimetableEntry
    from lms.models import LessonPlan

    out = {}
    if ctx.eff_end < ctx.start:
        return out

    entries = list(
        TimetableEntry.objects.filter(
            school_id=ctx.school_id, teacher_id__in=ctx.staff_ids,
            slot__slot_type='PERIOD', slot__is_active=True, subject__isnull=False,
        ).filter(_year_q(ctx)).values(
            'teacher_id', 'class_obj_id', 'subject_id', 'day', 'slot__applicable_days',
            'class_obj__name', 'subject__name',
        )
    )
    if not entries:
        return out

    periods = defaultdict(int)   # (staff, class, subject, date) -> periods that day
    labels = {}
    days_by_class = {}
    for e in entries:
        weekday = DAY_CODES.get(e['day'])
        applicable = e['slot__applicable_days']
        if weekday is None or (applicable and e['day'] not in applicable):
            continue
        class_days = days_by_class.setdefault(
            e['class_obj_id'], ctx.calendar.class_working_days(e['class_obj_id'], ctx.start, ctx.eff_end),
        )
        personal = set(ctx.personal_days(e['teacher_id']))
        for d in class_days:
            if d.weekday() == weekday and d in personal:
                k = (e['teacher_id'], e['class_obj_id'], e['subject_id'], d)
                periods[k] += 1
                labels[k] = f"{e['class_obj__name']} {e['subject__name']}"

    plans = {}
    for row in (
        LessonPlan.objects.filter(
            school_id=ctx.school_id, teacher_id__in=ctx.staff_ids, is_active=True,
            status=LessonPlan.Status.PUBLISHED, lesson_date__range=(ctx.start, ctx.eff_end),
        ).annotate(made=TruncDate('created_at', tzinfo=ctx.tz))
        .values('teacher_id', 'class_obj_id', 'subject_id', 'lesson_date')
        .annotate(n=Count('id'), on_time=Count('id', filter=Q(made__lte=F('lesson_date'))))
        .order_by()
    ):
        plans[(row['teacher_id'], row['class_obj_id'], row['subject_id'], row['lesson_date'])] = row

    for k, n_periods in sorted(periods.items(), key=lambda kv: kv[0][3]):
        row = out.setdefault(k[0], _row())
        row['due'] += n_periods
        p = plans.get(k)
        made = min(p['n'], n_periods) if p else 0
        on_time = min(p['on_time'], made) if p else 0
        row['done'] += made
        row['on_time'] += on_time
        row['credit'] += on_time + LATE_CREDIT * (made - on_time)
        if made < n_periods:
            _miss(row, {'date': k[3].isoformat(), 'lesson': labels[k], 'reason': 'no published plan'})
        elif on_time < made:
            _miss(row, {'date': k[3].isoformat(), 'lesson': labels[k], 'reason': 'plan made after the lesson'})
    return out


# ── 3. Exam marks entered ────────────────────────────────────────────────────

def marks_entry(ctx):
    """Scored by responsibility: the subject teacher (ClassSubject.teacher) of the exam's class and
    section owes a mark or an absent flag for each enrolled student. On time within N days."""
    from academic_sessions.models import StudentEnrollment
    from academics.models import ClassSubject
    from examinations.models import ExamSubject, StudentMark

    out = {}
    if ctx.eff_end < ctx.start:
        return out
    grace = timedelta(days=ctx.cfg.marks_deadline_days)

    exam_subjects = list(
        ExamSubject.objects.filter(
            school_id=ctx.school_id, is_active=True, exam__is_active=True,
        ).annotate(held=Coalesce('exam_date', 'exam__start_date'))
        .filter(held__range=(ctx.start, ctx.eff_end))
        .values(
            'id', 'subject_id', 'held', 'exam__class_obj_id', 'exam__session_class_id',
            'exam__academic_year_id', 'exam__name', 'subject__name',
        )
    )
    if not exam_subjects:
        return out

    class_subjects = defaultdict(list)  # (class, subject) -> rows
    for cs in ClassSubject.objects.filter(
        school_id=ctx.school_id, is_active=True, teacher_id__in=ctx.staff_ids,
        class_obj_id__in={e['exam__class_obj_id'] for e in exam_subjects},
    ).filter(_year_q(ctx)).values(
        'teacher_id', 'class_obj_id', 'session_class_id', 'subject_id', 'academic_year_id',
        'session_class__section',
    ):
        class_subjects[(cs['class_obj_id'], cs['subject_id'])].append(cs)

    # Enrolled students per (year, class, section). Section None = enrolled without a section.
    enrolled = defaultdict(int)
    for row in StudentEnrollment.objects.filter(
        school_id=ctx.school_id, is_active=True,
        academic_year_id__in={e['exam__academic_year_id'] for e in exam_subjects},
        class_obj_id__in={e['exam__class_obj_id'] for e in exam_subjects},
    ).values('academic_year_id', 'class_obj_id', 'session_class_id').annotate(n=Count('id')).order_by():
        enrolled[(row['academic_year_id'], row['class_obj_id'], row['session_class_id'])] += row['n']

    # Entered marks per (exam subject, section, entry date).
    entered = defaultdict(list)
    for row in (
        StudentMark.objects.filter(
            school_id=ctx.school_id, exam_subject_id__in=[e['id'] for e in exam_subjects],
        ).filter(Q(marks_obtained__isnull=False) | Q(is_absent=True))
        .annotate(day=TruncDate('created_at', tzinfo=ctx.tz))
        .values('exam_subject_id', 'enrollment__session_class_id', 'day').annotate(n=Count('id')).order_by()
    ):
        entered[row['exam_subject_id']].append(row)

    for es in exam_subjects:
        year, class_id, exam_section = es['exam__academic_year_id'], es['exam__class_obj_id'], es['exam__session_class_id']
        deadline = es['held'] + grace
        still_open = ctx.today <= deadline
        for cs in class_subjects.get((class_id, es['subject_id']), []):
            if cs['academic_year_id'] not in (None, year):
                continue
            if exam_section and cs['session_class_id'] not in (None, exam_section):
                continue
            # Which students this teacher owes: one section, or the whole class when either the
            # assignment or the exam is class-wide.
            section = exam_section or cs['session_class_id']
            if section:
                due = enrolled.get((year, class_id, section), 0)
                rows = [r for r in entered[es['id']] if r['enrollment__session_class_id'] in (section, None)]
            else:
                due = sum(n for (y, c, _), n in enrolled.items() if y == year and c == class_id)
                rows = entered[es['id']]
            if not due:
                continue
            on_time = sum(r['n'] for r in rows if r['day'] <= deadline)
            done = min(sum(r['n'] for r in rows), due)
            on_time = min(on_time, done)
            if still_open:
                due = done  # what is missing is not late yet
                if not due:
                    continue
            row = out.setdefault(cs['teacher_id'], _row())
            row['due'] += due
            row['done'] += done
            row['on_time'] += on_time
            row['credit'] += on_time + LATE_CREDIT * (done - on_time)
            label = f"{es['exam__name']} – {es['subject__name']}" + (
                f" ({cs['session_class__section']})" if cs['session_class__section'] else ''
            )
            if done < due:
                _miss(row, {'date': es['held'].isoformat(), 'exam': label, 'reason': f'{due - done} marks not entered'})
            elif on_time < done:
                _miss(row, {'date': es['held'].isoformat(), 'exam': label, 'reason': f'{done - on_time} entered after {deadline.isoformat()}'})
    return out


# ── 4. Own attendance ────────────────────────────────────────────────────────

def own_attendance(ctx):
    """Present = 1, late or half day = 0.5, over the teacher's working days less approved leave.
    Left out entirely when the school recorded no staff attendance in the range."""
    from hr.models import StaffAttendance

    out = {}
    if ctx.eff_end < ctx.start:
        return out
    rows = list(
        StaffAttendance.objects.filter(
            school_id=ctx.school_id, date__range=(ctx.start, ctx.eff_end),
        ).values_list('staff_member_id', 'date', 'status')
    )
    if not rows:
        return out
    status_of = {(sid, d): st for sid, d, st in rows}
    value = {'PRESENT': 1.0, 'LATE': 0.5, 'HALF_DAY': 0.5}
    for staff_id in ctx.staff_ids:
        row = out.setdefault(staff_id, _row())
        for d in ctx.personal_days(staff_id):
            st = status_of.get((staff_id, d))
            row['due'] += 1
            credit = value.get(st, 0.0)
            if credit:
                row['done'] += 1
                row['on_time'] += 1 if credit == 1 else 0
                row['credit'] += credit
            if credit < 1:
                _miss(row, {'date': d.isoformat(), 'reason': (st or 'not recorded').lower().replace('_', ' ')})
    return out


# ── 5. Homework and diary ────────────────────────────────────────────────────

def _teaching_load(ctx):
    """{staff_id: {(class_id, subject_id): sections}} from active ClassSubject rows."""
    from academics.models import ClassSubject

    load = defaultdict(lambda: defaultdict(int))
    labels = {}
    for row in ClassSubject.objects.filter(
        school_id=ctx.school_id, is_active=True, teacher_id__in=ctx.staff_ids,
    ).filter(_year_q(ctx)).values(
        'teacher_id', 'class_obj_id', 'subject_id', 'class_obj__name', 'subject__name',
    ).annotate(sections=Count('id')).order_by():
        load[row['teacher_id']][(row['class_obj_id'], row['subject_id'])] += row['sections']
        labels[(row['class_obj_id'], row['subject_id'])] = f"{row['class_obj__name']} {row['subject__name']}"
    return load, labels


def homework(ctx):
    """Target per class-subject-section per week, pro-rated by the teacher's working days.
    Published assignments of any type count, capped at the target of their own class-subject."""
    from lms.models import Assignment

    out = {}
    target_per_week = ctx.cfg.homework_per_week
    if ctx.eff_end < ctx.start or not target_per_week:
        return out
    load, labels = ctx_teaching_load(ctx)
    published = defaultdict(int)
    for row in (
        Assignment.objects.filter(
            school_id=ctx.school_id, teacher_id__in=ctx.staff_ids, is_active=True,
            status__in=[Assignment.Status.PUBLISHED, Assignment.Status.CLOSED],
        ).annotate(made=TruncDate('created_at', tzinfo=ctx.tz))
        .filter(made__range=(ctx.start, ctx.eff_end))
        .values('teacher_id', 'class_obj_id', 'subject_id').annotate(n=Count('id')).order_by()
    ):
        published[(row['teacher_id'], row['class_obj_id'], row['subject_id'])] += row['n']

    for staff_id, pairs in load.items():
        weeks = weeks_for(len(ctx.personal_days(staff_id)))
        if not weeks:
            continue
        row = out.setdefault(staff_id, _row())
        for pair, sections in pairs.items():
            target = sections * target_per_week * weeks
            got = min(published.get((staff_id, *pair), 0), target)
            row['due'] += target
            row['done'] += got
            row['on_time'] += got
            row['credit'] += got
            if got < target:
                _miss(row, {'class_subject': labels[pair], 'reason': f'{got:g} of {target:.1f} posted'})
    return out


def ctx_teaching_load(ctx):
    # Homework and question papers share it; load once per report.
    if '_teaching_load' not in ctx.__dict__:
        ctx.__dict__['_teaching_load'] = _teaching_load(ctx)
    return ctx.__dict__['_teaching_load']


# ── 6. Homework grading ──────────────────────────────────────────────────────

def grading(ctx):
    """Every submission received in the range is due; graded within N days earns full credit."""
    from lms.models import AssignmentSubmission

    out = {}
    if ctx.eff_end < ctx.start:
        return out
    grace = timedelta(days=ctx.cfg.grading_deadline_days)
    submissions = AssignmentSubmission.objects.filter(
        school_id=ctx.school_id, assignment__teacher_id__in=ctx.staff_ids,
        submitted_at__gte=ctx.day_start(ctx.start), submitted_at__lt=ctx.day_start(ctx.eff_end + timedelta(days=1)),
    ).exclude(status=AssignmentSubmission.Status.PENDING)
    graded = Q(graded_at__isnull=False)
    for row in submissions.values('assignment__teacher_id').annotate(
        total=Count('id'),
        graded=Count('id', filter=graded),
        on_time=Count('id', filter=graded & Q(graded_at__lte=F('submitted_at') + grace)),
        not_yet_due=Count('id', filter=Q(graded_at__isnull=True, submitted_at__gt=ctx.now - grace)),
    ).order_by():
        due = row['total'] - row['not_yet_due']
        if due <= 0:
            continue
        out[row['assignment__teacher_id']] = {
            'due': float(due), 'done': float(row['graded']), 'on_time': float(row['on_time']),
            'credit': row['on_time'] + LATE_CREDIT * (row['graded'] - row['on_time']), 'missed': [],
        }
    if out:
        for s in submissions.filter(graded_at__isnull=True, submitted_at__lte=ctx.now - grace).values(
            'assignment__teacher_id', 'assignment__title', 'student__name', 'submitted_at',
        ).order_by('submitted_at')[:MAX_MISSED * 10]:
            row = out.get(s['assignment__teacher_id'])
            if row:
                _miss(row, {
                    'date': ctx.local(s['submitted_at']).date().isoformat(),
                    'assignment': s['assignment__title'], 'student': s['student__name'], 'reason': 'not graded',
                })
    return out


# ── 7. Messages answered ─────────────────────────────────────────────────────

def messages_answered(ctx):
    """Due: each time someone writes to the teacher (starting a thread or continuing it after the
    teacher's last reply) within the range. Done: the teacher replied afterwards; on time within
    N hours. A thread the teacher started and nobody answered owes nothing."""
    from messaging.models import Message, ThreadParticipant
    from parents.models import ParentMessage

    out = {}
    user_ids = list(ctx.user_to_staff)
    if ctx.eff_end < ctx.start or not user_ids:
        return out
    window = timedelta(hours=ctx.cfg.message_reply_hours)
    range_start = ctx.day_start(ctx.start)
    range_end = ctx.day_start(ctx.eff_end + timedelta(days=1))

    # (teacher_user, thread) -> [(time, incoming?)]
    streams = defaultdict(list)
    members = defaultdict(set)
    for thread_id, user_id in ThreadParticipant.objects.filter(
        user_id__in=user_ids, thread__school_id=ctx.school_id,
    ).values_list('thread_id', 'user_id'):
        members[thread_id].add(user_id)
    if members:
        for thread_id, sender_id, at in Message.objects.filter(
            thread_id__in=list(members), created_at__gte=range_start,
        ).values_list('thread_id', 'sender_id', 'created_at').order_by('created_at'):
            for user_id in members[thread_id]:
                streams[(user_id, ('m', thread_id))].append((at, sender_id != user_id))
    for thread_id, sender_id, recipient_id, at in ParentMessage.objects.filter(
        school_id=ctx.school_id, created_at__gte=range_start,
    ).filter(Q(sender_user_id__in=user_ids) | Q(recipient_user_id__in=user_ids)).values_list(
        'thread_id', 'sender_user_id', 'recipient_user_id', 'created_at',
    ).order_by('created_at'):
        if recipient_id in ctx.user_to_staff:
            streams[(recipient_id, ('p', thread_id))].append((at, True))
        if sender_id in ctx.user_to_staff:
            streams[(sender_id, ('p', thread_id))].append((at, False))

    for (user_id, _thread), events in streams.items():
        staff_id = ctx.user_to_staff[user_id]
        events.sort(key=lambda e: e[0])
        waiting_since = None
        for at, incoming in events:
            if incoming:
                if waiting_since is None:
                    waiting_since = at
                continue
            if waiting_since is not None and waiting_since < range_end:
                row = out.setdefault(staff_id, _row())
                row['due'] += 1
                row['done'] += 1
                if at - waiting_since <= window:
                    row['on_time'] += 1
                    row['credit'] += 1
                else:
                    row['credit'] += LATE_CREDIT
                    _miss(row, {'date': ctx.local(waiting_since).date().isoformat(), 'reason': 'replied late'})
            waiting_since = None
        if waiting_since is not None and waiting_since < range_end and ctx.now - waiting_since > window:
            row = out.setdefault(staff_id, _row())
            row['due'] += 1
            _miss(row, {'date': ctx.local(waiting_since).date().isoformat(), 'reason': 'not answered'})
    return out


# ── 8. Question papers ───────────────────────────────────────────────────────

def question_papers(ctx):
    """Target per class-subject per month, pro-rated by working days. READY or PUBLISHED papers the
    teacher generated in the range count, capped at the target."""
    from examinations.models import ExamPaper

    out = {}
    per_month = ctx.cfg.papers_per_month
    if ctx.eff_end < ctx.start or not per_month:
        return out
    load, _ = ctx_teaching_load(ctx)
    made = dict(
        ExamPaper.objects.filter(
            school_id=ctx.school_id, generated_by_id__in=list(ctx.user_to_staff), is_active=True,
            status__in=[ExamPaper.Status.READY, ExamPaper.Status.PUBLISHED],
        ).annotate(made=TruncDate('created_at', tzinfo=ctx.tz))
        .filter(made__range=(ctx.start, ctx.eff_end))
        .values('generated_by_id').annotate(n=Count('id')).values_list('generated_by_id', 'n').order_by()
    )
    for staff_id, pairs in load.items():
        target = len(pairs) * per_month * months_for(len(ctx.personal_days(staff_id)))
        if not target:
            continue
        got = min(made.get(ctx.teachers[staff_id]['user_id'], 0), target)
        out[staff_id] = {'due': target, 'done': got, 'on_time': got, 'credit': got, 'missed': []}
        if got < target:
            _miss(out[staff_id], {'reason': f'{got:g} of {target:.1f} papers'})
    return out


# ── 9. Book content ──────────────────────────────────────────────────────────

def book_content(ctx):
    """Target blocks per month, pro-rated. New blocks the teacher added plus edits they made
    (ContentRevision.changed_by) count, capped at the target."""
    from lms.models import ContentBlock, ContentRevision

    out = {}
    per_month = ctx.cfg.content_blocks_per_month
    if ctx.eff_end < ctx.start or not per_month:
        return out
    user_ids = list(ctx.user_to_staff)
    in_school = (
        Q(chapter__book__school_id=ctx.school_id)
        | Q(topic__chapter__book__school_id=ctx.school_id)
        | Q(subtopic__topic__chapter__book__school_id=ctx.school_id)
    )
    start, end = ctx.day_start(ctx.start), ctx.day_start(ctx.eff_end + timedelta(days=1))
    counts = defaultdict(int)
    for user_id, n in (
        ContentBlock.objects.filter(in_school, created_by_id__in=user_ids, created_at__gte=start, created_at__lt=end)
        .values('created_by_id').annotate(n=Count('id', distinct=True)).values_list('created_by_id', 'n').order_by()
    ):
        counts[user_id] += n
    block_in_school = (
        Q(content_block__chapter__book__school_id=ctx.school_id)
        | Q(content_block__topic__chapter__book__school_id=ctx.school_id)
        | Q(content_block__subtopic__topic__chapter__book__school_id=ctx.school_id)
    )
    for user_id, n in (
        ContentRevision.objects.filter(block_in_school, changed_by_id__in=user_ids, changed_at__gte=start, changed_at__lt=end)
        .values('changed_by_id').annotate(n=Count('id', distinct=True)).values_list('changed_by_id', 'n').order_by()
    ):
        counts[user_id] += n

    for staff_id, t in ctx.teachers.items():
        target = per_month * months_for(len(ctx.personal_days(staff_id)))
        if not target:
            continue
        got = min(counts.get(t['user_id'], 0), target)
        out[staff_id] = {'due': target, 'done': got, 'on_time': got, 'credit': got, 'missed': []}
        if got < target:
            _miss(out[staff_id], {'reason': f'{got:g} of {target:.1f} blocks'})
    return out


# ── 10. Login days ───────────────────────────────────────────────────────────

def login_days(ctx):
    """Working days on which the teacher used the app: an active-day marker (written on sign-in and
    token refresh) or, for days before the marker existed, a sign-in."""
    from core.models import LoginEvent, UserActiveDay

    out = {}
    if ctx.eff_end < ctx.start:
        return out
    user_ids = list(ctx.user_to_staff)
    seen = set(
        UserActiveDay.objects.filter(user_id__in=user_ids, date__range=(ctx.start, ctx.eff_end))
        .values_list('user_id', 'date')
    )
    seen |= set(
        LoginEvent.objects.filter(
            user_id__in=user_ids,
            created_at__gte=ctx.day_start(ctx.start), created_at__lt=ctx.day_start(ctx.eff_end + timedelta(days=1)),
        ).annotate(day=TruncDate('created_at', tzinfo=ctx.tz)).values_list('user_id', 'day').distinct()
    )
    for staff_id, t in ctx.teachers.items():
        days = ctx.personal_days(staff_id)
        if not days or not t['user_id']:
            continue
        row = out.setdefault(staff_id, _row())
        for d in days:
            row['due'] += 1
            if (t['user_id'], d) in seen:
                row['done'] += 1
                row['on_time'] += 1
                row['credit'] += 1
            else:
                _miss(row, {'date': d.isoformat(), 'reason': 'no sign-in'})
    return out


MEASURES = {
    'attendance_marking': attendance_marking,
    'lesson_plans': lesson_plans,
    'marks_entry': marks_entry,
    'own_attendance': own_attendance,
    'homework': homework,
    'grading': grading,
    'messages_answered': messages_answered,
    'question_papers': question_papers,
    'book_content': book_content,
    'login_days': login_days,
}
