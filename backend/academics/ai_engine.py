"""
Academics AI Engine.

Pure-logic algorithm classes for timetable generation, conflict resolution,
quality scoring, workload analysis, gap analysis, substitute finding,
and natural language queries. No Django view dependencies.
"""

import json
import logging
import random
import statistics
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Dict, List, Optional, Set, Tuple

from django.conf import settings
from django.db.models import Count, Q, Sum

logger = logging.getLogger(__name__)

DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']


# ── Result Dataclasses ──────────────────────────────────────────────────────

@dataclass
class TimetableGenerationResult:
    grid: Dict[str, list]          # day -> [{slot_id, subject_id, teacher_id, room}]
    score: float = 0.0
    warnings: List[str] = field(default_factory=list)
    success: bool = True
    error: Optional[str] = None


@dataclass
class ConflictResolution:
    alternative_teachers: List[Dict] = field(default_factory=list)
    alternative_slots: List[Dict] = field(default_factory=list)
    swap_suggestions: List[Dict] = field(default_factory=list)


@dataclass
class QualityScoreResult:
    overall_score: float = 0.0
    teacher_idle_gaps: float = 0.0
    subject_distribution: float = 0.0
    break_placement: float = 0.0
    workload_balance: float = 0.0
    constraint_satisfaction: float = 0.0
    details: Dict[str, Any] = field(default_factory=dict)


# ── Timetable Generator ────────────────────────────────────────────────────

class TimetableGenerator:
    """Generates an optimal timetable for a class using greedy CSP + backtracking."""

    def __init__(self, school_id: int, class_id: int):
        self.school_id = school_id
        self.class_id = class_id
        self.slots = []
        self.class_subjects = []
        self.teacher_busy_map: Dict[int, Set[Tuple[str, int]]] = {}

    def _load_data(self):
        from .models import ClassSubject, TimetableEntry, TimetableSlot

        self.slots = list(
            TimetableSlot.objects.filter(
                school_id=self.school_id, slot_type='PERIOD', is_active=True
            ).order_by('order')
        )
        self.class_subjects = list(
            ClassSubject.objects.filter(
                school_id=self.school_id, class_obj_id=self.class_id, is_active=True
            ).select_related('subject', 'teacher')
        )
        # Build teacher busy map from OTHER classes
        other_entries = TimetableEntry.objects.filter(
            school_id=self.school_id
        ).exclude(class_obj_id=self.class_id).values_list('teacher_id', 'day', 'slot_id')

        self.teacher_busy_map = {}
        for teacher_id, day, slot_id in other_entries:
            if teacher_id:
                self.teacher_busy_map.setdefault(teacher_id, set()).add((day, slot_id))

    def _classify_slots_by_time(self) -> Dict[int, str]:
        """Label slots as morning/afternoon based on order position."""
        mid = len(self.slots) // 2
        return {
            slot.id: ('morning' if i < mid else 'afternoon')
            for i, slot in enumerate(self.slots)
        }

    def generate(self) -> TimetableGenerationResult:
        try:
            self._load_data()
        except Exception as e:
            return TimetableGenerationResult(
                grid={}, success=False, error=f'Failed to load data: {e}'
            )

        if not self.slots:
            return TimetableGenerationResult(
                grid={}, success=False,
                error='No time slots defined. Please create time slots first.'
            )
        if not self.class_subjects:
            return TimetableGenerationResult(
                grid={}, success=False,
                error='No subjects assigned to this class. Please assign subjects first.'
            )

        slot_time = self._classify_slots_by_time()
        warnings = []

        # Build demand: each (class_subject, remaining_count)
        demand = []
        total_required = 0
        for cs in self.class_subjects:
            demand.append({
                'cs': cs,
                'subject_id': cs.subject_id,
                'teacher_id': cs.teacher_id,
                'subject_name': cs.subject.name,
                'teacher_name': cs.teacher.full_name if cs.teacher else None,
                'remaining': cs.periods_per_week,
                'total': cs.periods_per_week,
            })
            total_required += cs.periods_per_week

        total_available = len(self.slots) * len(DAYS)
        if total_required > total_available:
            warnings.append(
                f'Required periods ({total_required}) exceed available slots '
                f'({total_available}). Some subjects may not be fully scheduled.'
            )

        # Grid: day -> slot_id -> assignment
        grid: Dict[str, Dict[int, dict]] = {day: {} for day in DAYS}

        # Track what's been assigned per day for distribution checks
        day_subjects: Dict[str, List[int]] = {day: [] for day in DAYS}

        # Sort slots list for iteration
        slot_ids = [s.id for s in self.slots]

        # Create shuffled (day, slot) pairs for balanced distribution
        cells = [(day, slot_id) for day in DAYS for slot_id in slot_ids]
        random.shuffle(cells)

        # Greedy assignment
        for day, slot_id in cells:
            best_item = None
            best_score = -1

            for item in demand:
                if item['remaining'] <= 0:
                    continue

                score = 0.0
                teacher_id = item['teacher_id']
                subject_id = item['subject_id']

                # Check teacher conflict with other classes
                if teacher_id and (day, slot_id) in self.teacher_busy_map.get(teacher_id, set()):
                    continue

                # Check teacher conflict within our own grid
                if teacher_id:
                    for other_slot_id, entry in grid[day].items():
                        if other_slot_id == slot_id:
                            continue
                        if entry.get('teacher_id') == teacher_id and other_slot_id == slot_id:
                            break
                    # Check if teacher already assigned to this slot in our grid
                    teacher_in_slot = False
                    for d in DAYS:
                        existing = grid[d].get(slot_id)
                        if existing and existing.get('teacher_id') == teacher_id and d == day:
                            teacher_in_slot = True
                            break
                    if teacher_in_slot:
                        continue

                # Prefer subjects with more remaining periods
                score += item['remaining'] * 10

                # Avoid same subject on same day
                if subject_id in day_subjects[day]:
                    score -= 50

                # Prefer morning for core subjects (non-elective heuristic)
                time_of_day = slot_time.get(slot_id, 'afternoon')
                cs = item['cs']
                if not cs.subject.is_elective and time_of_day == 'morning':
                    score += 5

                # Prefer even spread across days
                days_with_subject = sum(
                    1 for d in DAYS if item['subject_id'] in day_subjects[d]
                )
                score -= days_with_subject * 8

                if score > best_score:
                    best_score = score
                    best_item = item

            if best_item:
                grid[day][slot_id] = {
                    'slot_id': slot_id,
                    'subject_id': best_item['subject_id'],
                    'teacher_id': best_item['teacher_id'],
                    'subject_name': best_item['subject_name'],
                    'teacher_name': best_item['teacher_name'],
                    'room': '',
                }
                best_item['remaining'] -= 1
                day_subjects[day].append(best_item['subject_id'])

        # Check for unmet demands
        for item in demand:
            if item['remaining'] > 0:
                warnings.append(
                    f'{item["subject_name"]}: scheduled {item["total"] - item["remaining"]}'
                    f'/{item["total"]} periods per week'
                )

        # Convert grid to API format: day -> list of slot assignments
        result_grid = {}
        for day in DAYS:
            entries = []
            for slot in self.slots:
                entry = grid[day].get(slot.id)
                if entry:
                    entries.append(entry)
            result_grid[day] = entries

        # Score the generated timetable
        scorer = TimetableQualityScorer.__new__(TimetableQualityScorer)
        scorer.school_id = self.school_id
        scorer.class_id = self.class_id
        score = scorer._score_generated_grid(grid, self.slots, self.class_subjects, day_subjects)

        return TimetableGenerationResult(
            grid=result_grid,
            score=score,
            warnings=warnings,
            success=True,
        )


# ── Conflict Resolver ───────────────────────────────────────────────────────

class ConflictResolver:
    """Suggests alternatives when a teacher scheduling conflict is detected."""

    def __init__(self, school_id: int):
        self.school_id = school_id

    def suggest_resolution(
        self, teacher_id: int, day: str, slot_id: int,
        class_id: int, subject_id: Optional[int] = None
    ) -> ConflictResolution:
        from hr.models import StaffMember, StaffQualification
        from .models import TimetableEntry, TimetableSlot, Subject

        resolution = ConflictResolution()

        subject = None
        if subject_id:
            try:
                subject = Subject.objects.get(id=subject_id)
            except Subject.DoesNotExist:
                pass

        # ── Alternative teachers ──
        # Find teachers busy at this (day, slot)
        busy_teacher_ids = set(
            TimetableEntry.objects.filter(
                school_id=self.school_id, day=day, slot_id=slot_id
            ).values_list('teacher_id', flat=True)
        )

        available_teachers = StaffMember.objects.filter(
            school_id=self.school_id, is_active=True, employment_status='ACTIVE'
        ).exclude(id__in=busy_teacher_ids)

        for teacher in available_teachers[:10]:
            match_score = 0
            match_reason = 'Available at this time'

            if subject:
                qualifications = StaffQualification.objects.filter(
                    staff_member=teacher
                ).values_list('qualification_name', flat=True)
                for q in qualifications:
                    if subject.name.lower() in q.lower() or q.lower() in subject.name.lower():
                        match_score = 100
                        match_reason = f'Qualified: {q}'
                        break

            resolution.alternative_teachers.append({
                'teacher_id': teacher.id,
                'teacher_name': teacher.full_name,
                'qualification_match': match_score,
                'reason': match_reason,
            })

        resolution.alternative_teachers.sort(
            key=lambda x: x['qualification_match'], reverse=True
        )

        # ── Alternative slots ──
        period_slots = TimetableSlot.objects.filter(
            school_id=self.school_id, slot_type='PERIOD', is_active=True
        )

        teacher_entries = set(
            TimetableEntry.objects.filter(
                school_id=self.school_id, teacher_id=teacher_id
            ).values_list('day', 'slot_id')
        )
        class_entries = set(
            TimetableEntry.objects.filter(
                school_id=self.school_id, class_obj_id=class_id
            ).values_list('day', 'slot_id')
        )

        for slot in period_slots:
            for d in DAYS:
                if (d, slot.id) not in teacher_entries and (d, slot.id) not in class_entries:
                    resolution.alternative_slots.append({
                        'day': d,
                        'slot_id': slot.id,
                        'slot_name': slot.name,
                    })

        resolution.alternative_slots = resolution.alternative_slots[:15]

        # ── Swap suggestions ──
        # Find entries in this class that could be swapped
        class_entries_qs = TimetableEntry.objects.filter(
            school_id=self.school_id, class_obj_id=class_id
        ).select_related('teacher', 'subject', 'slot')

        for entry in class_entries_qs:
            if not entry.teacher_id or entry.teacher_id == teacher_id:
                continue

            # Check: is the conflicting teacher free at this entry's (day, slot)?
            conflicting_teacher_free = not TimetableEntry.objects.filter(
                school_id=self.school_id, teacher_id=teacher_id,
                day=entry.day, slot_id=entry.slot_id
            ).exclude(class_obj_id=class_id).exists()

            # Check: is this entry's teacher free at the conflicting (day, slot)?
            entry_teacher_free = not TimetableEntry.objects.filter(
                school_id=self.school_id, teacher_id=entry.teacher_id,
                day=day, slot_id=slot_id
            ).exclude(class_obj_id=class_id).exists()

            if conflicting_teacher_free and entry_teacher_free:
                resolution.swap_suggestions.append({
                    'entry_id': entry.id,
                    'entry_day': entry.day,
                    'entry_slot_name': entry.slot.name,
                    'entry_subject': entry.subject.name if entry.subject else '',
                    'entry_teacher': entry.teacher.full_name,
                    'reason': (
                        f'Swap with {entry.get_day_display()} {entry.slot.name}: '
                        f'both teachers are free at the other\'s slot'
                    ),
                })

        resolution.swap_suggestions = resolution.swap_suggestions[:5]
        return resolution


# ── Quality Scorer ──────────────────────────────────────────────────────────

class TimetableQualityScorer:
    """Scores a saved timetable on multiple quality metrics."""

    def __init__(self, school_id: int, class_id: int):
        self.school_id = school_id
        self.class_id = class_id

    def score(self) -> QualityScoreResult:
        from .models import ClassSubject, TimetableEntry, TimetableSlot

        entries = list(
            TimetableEntry.objects.filter(
                school_id=self.school_id, class_obj_id=self.class_id
            ).select_related('slot', 'subject', 'teacher')
        )

        if not entries:
            return QualityScoreResult(details={'message': 'No timetable entries found.'})

        slots = list(
            TimetableSlot.objects.filter(
                school_id=self.school_id, is_active=True
            ).order_by('order')
        )
        class_subjects = list(
            ClassSubject.objects.filter(
                school_id=self.school_id, class_obj_id=self.class_id, is_active=True
            )
        )

        result = QualityScoreResult()

        # 1. Teacher idle gaps (20%)
        result.teacher_idle_gaps = self._score_teacher_idle_gaps(entries, slots)

        # 2. Subject distribution (25%)
        result.subject_distribution = self._score_subject_distribution(entries)

        # 3. Break placement (15%)
        result.break_placement = self._score_break_placement(slots)

        # 4. Workload balance (15%)
        result.workload_balance = self._score_workload_balance(entries)

        # 5. Constraint satisfaction (25%)
        result.constraint_satisfaction = self._score_constraint_satisfaction(
            entries, class_subjects
        )

        result.overall_score = round(
            result.teacher_idle_gaps * 0.20
            + result.subject_distribution * 0.25
            + result.break_placement * 0.15
            + result.workload_balance * 0.15
            + result.constraint_satisfaction * 0.25,
            1
        )

        result.details = {
            'total_entries': len(entries),
            'total_class_subjects': len(class_subjects),
            'total_slots': len(slots),
        }

        return result

    def _score_teacher_idle_gaps(self, entries, slots) -> float:
        """Score based on teacher idle gaps between periods in a day."""
        slot_order = {s.id: s.order for s in slots}
        teacher_day_slots: Dict[Tuple[int, str], List[int]] = {}

        for entry in entries:
            if entry.teacher_id:
                key = (entry.teacher_id, entry.day)
                teacher_day_slots.setdefault(key, []).append(
                    slot_order.get(entry.slot_id, 0)
                )

        if not teacher_day_slots:
            return 100.0

        total_gaps = 0
        total_spans = 0
        for orders in teacher_day_slots.values():
            if len(orders) < 2:
                continue
            orders.sort()
            span = orders[-1] - orders[0]
            gaps = span - (len(orders) - 1)
            total_gaps += gaps
            total_spans += 1

        if total_spans == 0:
            return 100.0

        avg_gaps = total_gaps / total_spans
        return max(0, round(100 - avg_gaps * 25, 1))

    def _score_subject_distribution(self, entries) -> float:
        """Penalize subjects appearing multiple times on same day."""
        day_subject_counts: Dict[Tuple[str, int], int] = {}
        for entry in entries:
            if entry.subject_id:
                key = (entry.day, entry.subject_id)
                day_subject_counts[key] = day_subject_counts.get(key, 0) + 1

        if not day_subject_counts:
            return 100.0

        doubles = sum(1 for c in day_subject_counts.values() if c > 1)
        total = len(day_subject_counts)
        return max(0, round(100 - (doubles / max(total, 1)) * 100, 1))

    def _score_break_placement(self, slots) -> float:
        """Score based on max consecutive periods without a break."""
        consecutive = 0
        max_consecutive = 0
        for slot in slots:
            if slot.slot_type == 'PERIOD':
                consecutive += 1
                max_consecutive = max(max_consecutive, consecutive)
            else:
                consecutive = 0

        if max_consecutive <= 3:
            return 100.0
        elif max_consecutive <= 4:
            return 80.0
        elif max_consecutive <= 5:
            return 60.0
        else:
            return max(0, 100 - (max_consecutive - 3) * 15)

    def _score_workload_balance(self, entries) -> float:
        """Score based on std deviation of teacher period counts."""
        teacher_counts: Dict[int, int] = {}
        for entry in entries:
            if entry.teacher_id:
                teacher_counts[entry.teacher_id] = teacher_counts.get(entry.teacher_id, 0) + 1

        if len(teacher_counts) < 2:
            return 100.0

        counts = list(teacher_counts.values())
        std_dev = statistics.stdev(counts)
        mean = statistics.mean(counts)
        cv = std_dev / mean if mean > 0 else 0

        return max(0, round(100 - cv * 100, 1))

    def _score_constraint_satisfaction(self, entries, class_subjects) -> float:
        """Score: how many periods_per_week requirements are met."""
        if not class_subjects:
            return 100.0

        subject_entry_counts: Dict[int, int] = {}
        for entry in entries:
            if entry.subject_id:
                subject_entry_counts[entry.subject_id] = (
                    subject_entry_counts.get(entry.subject_id, 0) + 1
                )

        met = 0
        total = 0
        for cs in class_subjects:
            total += 1
            actual = subject_entry_counts.get(cs.subject_id, 0)
            if actual >= cs.periods_per_week:
                met += 1

        return round(met / max(total, 1) * 100, 1)

    def _score_generated_grid(self, grid, slots, class_subjects, day_subjects) -> float:
        """Score a generated (unsaved) grid. Used internally by TimetableGenerator."""
        # Quick scoring for preview
        subject_counts: Dict[int, int] = {}
        for day, slot_entries in grid.items():
            for slot_id, entry in slot_entries.items():
                sid = entry.get('subject_id')
                if sid:
                    subject_counts[sid] = subject_counts.get(sid, 0) + 1

        # Constraint satisfaction
        met = 0
        total = len(class_subjects)
        for cs in class_subjects:
            if subject_counts.get(cs.subject_id, 0) >= cs.periods_per_week:
                met += 1

        constraint_score = (met / max(total, 1)) * 100

        # Distribution: penalize same subject on same day
        doubles = 0
        total_day_subjects = 0
        for day, subjects in day_subjects.items():
            seen = set()
            for s in subjects:
                total_day_subjects += 1
                if s in seen:
                    doubles += 1
                seen.add(s)

        dist_score = max(0, 100 - (doubles / max(total_day_subjects, 1)) * 200)

        return round(constraint_score * 0.6 + dist_score * 0.4, 1)


# ── Workload Analyzer ───────────────────────────────────────────────────────

class WorkloadAnalyzer:
    """Analyzes teacher workload distribution across the school."""

    def __init__(self, school_id: int):
        self.school_id = school_id

    def analyze(self) -> dict:
        from hr.models import StaffMember
        from .models import ClassSubject, TimetableEntry

        class_subjects = ClassSubject.objects.filter(
            school_id=self.school_id, is_active=True
        ).select_related('teacher', 'class_obj', 'subject')

        entries = TimetableEntry.objects.filter(
            school_id=self.school_id
        ).select_related('teacher', 'slot', 'class_obj', 'subject')

        # Build per-teacher stats
        teacher_stats: Dict[int, dict] = {}

        for cs in class_subjects:
            if not cs.teacher_id:
                continue
            stats = teacher_stats.setdefault(cs.teacher_id, {
                'teacher_id': cs.teacher_id,
                'teacher_name': cs.teacher.full_name,
                'assigned_periods_week': 0,
                'timetabled_periods_week': 0,
                'periods_per_day': {d: 0 for d in DAYS},
                'max_periods_day': 0,
                'classes_taught': set(),
                'subjects_taught': set(),
                'status': 'balanced',
            })
            stats['assigned_periods_week'] += cs.periods_per_week
            stats['classes_taught'].add(cs.class_obj.name)
            stats['subjects_taught'].add(cs.subject.name)

        for entry in entries:
            if not entry.teacher_id:
                continue
            stats = teacher_stats.setdefault(entry.teacher_id, {
                'teacher_id': entry.teacher_id,
                'teacher_name': entry.teacher.full_name if entry.teacher else 'Unknown',
                'assigned_periods_week': 0,
                'timetabled_periods_week': 0,
                'periods_per_day': {d: 0 for d in DAYS},
                'max_periods_day': 0,
                'classes_taught': set(),
                'subjects_taught': set(),
                'status': 'balanced',
            })
            stats['timetabled_periods_week'] += 1
            stats['periods_per_day'][entry.day] = stats['periods_per_day'].get(entry.day, 0) + 1

        # Compute max_periods_day and status flags
        for stats in teacher_stats.values():
            stats['max_periods_day'] = max(stats['periods_per_day'].values()) if stats['periods_per_day'] else 0
            if stats['timetabled_periods_week'] > 30 or stats['max_periods_day'] > 7:
                stats['status'] = 'overloaded'
            elif stats['timetabled_periods_week'] < 10 and stats['assigned_periods_week'] > 0:
                stats['status'] = 'underloaded'

            # Convert sets to lists for JSON
            stats['classes_taught'] = sorted(stats['classes_taught'])
            stats['subjects_taught'] = sorted(stats['subjects_taught'])

        teachers_list = sorted(
            teacher_stats.values(),
            key=lambda x: x['timetabled_periods_week'], reverse=True
        )

        # Redistribution suggestions
        suggestions = []
        overloaded = [t for t in teachers_list if t['status'] == 'overloaded']
        underloaded = [t for t in teachers_list if t['status'] == 'underloaded']

        for ol in overloaded:
            for ul in underloaded:
                common_subjects = set(ol['subjects_taught']) & set(ul['subjects_taught'])
                if common_subjects:
                    suggestions.append({
                        'from_teacher': ol['teacher_name'],
                        'to_teacher': ul['teacher_name'],
                        'subjects': sorted(common_subjects),
                        'reason': (
                            f'{ol["teacher_name"]} has {ol["timetabled_periods_week"]} periods/week '
                            f'while {ul["teacher_name"]} has {ul["timetabled_periods_week"]}. '
                            f'Both teach {", ".join(sorted(common_subjects))}.'
                        ),
                    })

        return {
            'teachers': teachers_list,
            'summary': {
                'total_teachers': len(teachers_list),
                'overloaded': len(overloaded),
                'underloaded': len(underloaded),
                'balanced': len(teachers_list) - len(overloaded) - len(underloaded),
            },
            'redistribution_suggestions': suggestions,
        }


# ── Curriculum Gap Analyzer ─────────────────────────────────────────────────

class CurriculumGapAnalyzer:
    """Identifies curriculum gaps across all classes."""

    def __init__(self, school_id: int):
        self.school_id = school_id

    def analyze(self) -> dict:
        from students.models import Class
        from hr.models import StaffQualification
        from .models import ClassSubject, Subject, TimetableEntry

        classes = Class.objects.filter(school_id=self.school_id, is_active=True)
        subjects = Subject.objects.filter(
            school_id=self.school_id, is_active=True, is_elective=False
        )
        class_subjects = ClassSubject.objects.filter(
            school_id=self.school_id, is_active=True
        ).select_related('class_obj', 'subject', 'teacher')

        entries = TimetableEntry.objects.filter(
            school_id=self.school_id
        ).values('class_obj_id', 'subject_id').annotate(count=Count('id'))

        # Build lookup maps
        cs_map: Dict[Tuple[int, int], Any] = {}
        for cs in class_subjects:
            cs_map[(cs.class_obj_id, cs.subject_id)] = cs

        entry_counts: Dict[Tuple[int, int], int] = {}
        for e in entries:
            entry_counts[(e['class_obj_id'], e['subject_id'])] = e['count']

        # 1. Missing required subjects
        missing_required = []
        for cls in classes:
            missing = []
            for subj in subjects:
                if (cls.id, subj.id) not in cs_map:
                    missing.append({
                        'subject_id': subj.id,
                        'subject_name': subj.name,
                        'subject_code': subj.code,
                    })
            if missing:
                missing_required.append({
                    'class_id': cls.id,
                    'class_name': cls.name,
                    'missing_subjects': missing,
                })

        # 2. Unmet periods
        unmet_periods = []
        for cs in class_subjects:
            actual = entry_counts.get((cs.class_obj_id, cs.subject_id), 0)
            if actual < cs.periods_per_week:
                unmet_periods.append({
                    'class_name': cs.class_obj.name,
                    'subject_name': cs.subject.name,
                    'required': cs.periods_per_week,
                    'actual': actual,
                    'deficit': cs.periods_per_week - actual,
                })

        # 3. Unassigned teachers
        unassigned_teachers = []
        for cs in class_subjects:
            if not cs.teacher_id:
                unassigned_teachers.append({
                    'class_subject_id': cs.id,
                    'class_name': cs.class_obj.name,
                    'subject_name': cs.subject.name,
                })

        # 4. Qualification mismatches
        qualification_mismatches = []
        teacher_ids = set(cs.teacher_id for cs in class_subjects if cs.teacher_id)
        qualifications = StaffQualification.objects.filter(
            staff_member_id__in=teacher_ids
        ).values_list('staff_member_id', 'qualification_name')

        teacher_quals: Dict[int, List[str]] = {}
        for tid, qname in qualifications:
            teacher_quals.setdefault(tid, []).append(qname)

        for cs in class_subjects:
            if not cs.teacher_id:
                continue
            quals = teacher_quals.get(cs.teacher_id, [])
            subject_name_lower = cs.subject.name.lower()
            has_match = any(
                subject_name_lower in q.lower() or q.lower() in subject_name_lower
                for q in quals
            )
            if not has_match and quals:
                qualification_mismatches.append({
                    'teacher_name': cs.teacher.full_name,
                    'subject_name': cs.subject.name,
                    'class_name': cs.class_obj.name,
                    'teacher_qualifications': quals,
                })

        return {
            'missing_required_subjects': missing_required,
            'unmet_periods': unmet_periods,
            'unassigned_teachers': unassigned_teachers,
            'qualification_mismatches': qualification_mismatches,
            'summary': {
                'missing_count': sum(len(m['missing_subjects']) for m in missing_required),
                'unmet_count': len(unmet_periods),
                'unassigned_count': len(unassigned_teachers),
                'mismatch_count': len(qualification_mismatches),
            },
        }


# ── Substitute Teacher Finder ───────────────────────────────────────────────

class SubstituteTeacherFinder:
    """Suggests substitute teachers when a teacher is absent."""

    DAY_MAP = {0: 'MON', 1: 'TUE', 2: 'WED', 3: 'THU', 4: 'FRI', 5: 'SAT'}

    def __init__(self, school_id: int):
        self.school_id = school_id

    def suggest(self, teacher_id: int, date_obj: date) -> dict:
        from hr.models import StaffAttendance, StaffMember, StaffQualification
        from .models import TimetableEntry

        day_code = self.DAY_MAP.get(date_obj.weekday())
        if not day_code:
            return {
                'absent_teacher_name': '',
                'date': date_obj.isoformat(),
                'entries_needing_cover': [],
                'message': 'Selected date is a Sunday. No classes scheduled.',
            }

        try:
            absent_teacher = StaffMember.objects.get(id=teacher_id)
        except StaffMember.DoesNotExist:
            return {'error': 'Teacher not found.'}

        # Get absent teacher's entries for that day
        entries = TimetableEntry.objects.filter(
            school_id=self.school_id, teacher_id=teacher_id, day=day_code
        ).select_related('slot', 'subject', 'class_obj').order_by('slot__order')

        if not entries:
            return {
                'absent_teacher_name': absent_teacher.full_name,
                'date': date_obj.isoformat(),
                'entries_needing_cover': [],
                'message': f'{absent_teacher.full_name} has no classes on {day_code}.',
            }

        # Get teachers who are absent on that date
        absent_on_date = set(
            StaffAttendance.objects.filter(
                school_id=self.school_id,
                date=date_obj,
                status__in=['ABSENT', 'ON_LEAVE'],
            ).values_list('staff_member_id', flat=True)
        )

        # Get all active teachers
        all_teachers = StaffMember.objects.filter(
            school_id=self.school_id, is_active=True, employment_status='ACTIVE'
        ).exclude(id=teacher_id)

        # Get all qualifications
        qualifications = StaffQualification.objects.filter(
            staff_member__in=all_teachers
        ).values_list('staff_member_id', 'qualification_name')
        teacher_quals: Dict[int, List[str]] = {}
        for tid, qname in qualifications:
            teacher_quals.setdefault(tid, []).append(qname)

        # Get all teacher entries for the day (to check availability)
        day_entries = TimetableEntry.objects.filter(
            school_id=self.school_id, day=day_code
        ).values_list('teacher_id', 'slot_id')
        teacher_slot_busy: Dict[int, Set[int]] = {}
        for tid, sid in day_entries:
            if tid:
                teacher_slot_busy.setdefault(tid, set()).add(sid)

        # Build suggestions per entry
        results = []
        for entry in entries:
            substitutes = []
            subject_name = entry.subject.name if entry.subject else ''

            for teacher in all_teachers:
                # Skip absent teachers
                if teacher.id in absent_on_date:
                    continue

                # Skip teachers busy at this slot
                if entry.slot_id in teacher_slot_busy.get(teacher.id, set()):
                    continue

                score = 50  # Base score
                reason = 'Available'

                # Qualification match
                quals = teacher_quals.get(teacher.id, [])
                if subject_name and any(
                    subject_name.lower() in q.lower() or q.lower() in subject_name.lower()
                    for q in quals
                ):
                    score += 30
                    reason = f'Qualified ({subject_name})'

                # Workload: fewer periods today = better
                today_periods = len(teacher_slot_busy.get(teacher.id, set()))
                score -= today_periods * 3

                substitutes.append({
                    'teacher_id': teacher.id,
                    'teacher_name': teacher.full_name,
                    'score': max(0, score),
                    'reason': reason,
                    'today_periods': today_periods,
                })

            substitutes.sort(key=lambda x: x['score'], reverse=True)

            results.append({
                'slot_name': entry.slot.name,
                'slot_start': entry.slot.start_time.strftime('%H:%M') if entry.slot.start_time else '',
                'slot_end': entry.slot.end_time.strftime('%H:%M') if entry.slot.end_time else '',
                'subject_name': subject_name,
                'class_name': entry.class_obj.name,
                'suggested_substitutes': substitutes[:5],
            })

        return {
            'absent_teacher_name': absent_teacher.full_name,
            'date': date_obj.isoformat(),
            'day': day_code,
            'entries_needing_cover': results,
        }


# ── Academics AI Agent ──────────────────────────────────────────────────────

ACADEMICS_SYSTEM_PROMPT = """You are a helpful academic scheduling assistant for a school management platform.
You answer questions about timetables, subjects, teachers, and class schedules.

You have access to these tools. Call exactly ONE tool per question by responding with JSON:

1. get_class_schedule - Get timetable for a class
   Parameters: class_name (required)

2. get_teacher_schedule - Get a teacher's full weekly schedule
   Parameters: teacher_name (required)

3. get_free_teachers - Find teachers free at a specific time
   Parameters: day (required, MON-SAT), period (optional, period number/name)

4. get_subject_schedule - When/where is a subject taught
   Parameters: subject_name (required), class_name (optional)

5. get_workload_summary - Teacher workload overview
   Parameters: teacher_name (optional, omit for all)

6. get_class_info - Get subjects and teachers assigned to a class
   Parameters: class_name (required)

Current date: {current_date}
School: {school_name}

Respond with ONLY a JSON object like:
{{"tool": "get_class_schedule", "params": {{"class_name": "5A"}}}}

If the question is not about academics/scheduling, respond with:
{{"tool": "none", "answer": "Your friendly response here"}}"""

ACADEMICS_FORMAT_PROMPT = """Given this academic/scheduling data from a school, provide a clear, concise answer to the user's question.

User question: {question}
Data: {data}

Respond in a helpful, conversational tone. Format schedules clearly. Keep it brief (2-4 sentences max). Use simple formatting."""


class AcademicsAIAgent:
    """AI agent that answers natural language questions about academics and scheduling."""

    def __init__(self, school_id: int):
        self.school_id = school_id
        self._school = None

    @property
    def school(self):
        if self._school is None:
            from schools.models import School
            self._school = School.objects.get(id=self.school_id)
        return self._school

    def process_query(self, user_message: str) -> str:
        if not settings.GROQ_API_KEY:
            return self._fallback_response(user_message)

        try:
            from groq import Groq
            client = Groq(api_key=settings.GROQ_API_KEY)

            system = ACADEMICS_SYSTEM_PROMPT.format(
                current_date=date.today().isoformat(),
                school_name=self.school.name,
            )

            response = client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_message},
                ],
                temperature=0.1,
                max_tokens=500,
                timeout=15,
            )

            result_text = response.choices[0].message.content.strip()

            # Parse JSON from potential markdown code blocks
            if "```json" in result_text:
                result_text = result_text.split("```json")[1].split("```")[0]
            elif "```" in result_text:
                result_text = result_text.split("```")[1].split("```")[0]

            tool_call = json.loads(result_text.strip())

            if tool_call.get('tool') == 'none':
                return tool_call.get('answer', "I can help with questions about schedules, subjects, and teachers.")

            tool_name = tool_call.get('tool', '')
            params = tool_call.get('params', {})
            data = self._execute_tool(tool_name, params)

            # Format response with LLM
            format_response = client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=[
                    {"role": "user", "content": ACADEMICS_FORMAT_PROMPT.format(
                        question=user_message,
                        data=json.dumps(data, default=str),
                    )},
                ],
                temperature=0.3,
                max_tokens=500,
                timeout=15,
            )

            return format_response.choices[0].message.content.strip()

        except json.JSONDecodeError:
            logger.warning(f"Failed to parse LLM tool call for query: {user_message}")
            return self._fallback_response(user_message)
        except Exception as e:
            logger.error(f"Academics AI agent error: {e}")
            return "I'm sorry, I couldn't process that question right now. Please try rephrasing or try again later."

    def _execute_tool(self, tool_name: str, params: dict) -> dict:
        tools = {
            'get_class_schedule': self._get_class_schedule,
            'get_teacher_schedule': self._get_teacher_schedule,
            'get_free_teachers': self._get_free_teachers,
            'get_subject_schedule': self._get_subject_schedule,
            'get_workload_summary': self._get_workload_summary,
            'get_class_info': self._get_class_info,
        }
        handler = tools.get(tool_name)
        if not handler:
            return {"error": f"Unknown tool: {tool_name}"}
        return handler(**params)

    def _get_class_schedule(self, class_name: str) -> dict:
        from students.models import Class
        from .models import TimetableEntry

        cls = Class.objects.filter(
            school_id=self.school_id, name__icontains=class_name
        ).first()
        if not cls:
            return {"error": f"Class '{class_name}' not found."}

        entries = TimetableEntry.objects.filter(
            school_id=self.school_id, class_obj=cls
        ).select_related('slot', 'subject', 'teacher').order_by('day', 'slot__order')

        schedule = {}
        for entry in entries:
            day = entry.get_day_display()
            schedule.setdefault(day, []).append({
                'period': entry.slot.name,
                'subject': entry.subject.name if entry.subject else entry.slot.get_slot_type_display(),
                'teacher': entry.teacher.full_name if entry.teacher else '-',
                'room': entry.room or '-',
            })

        return {"class": cls.name, "schedule": schedule}

    def _get_teacher_schedule(self, teacher_name: str) -> dict:
        from hr.models import StaffMember
        from .models import TimetableEntry

        teacher = StaffMember.objects.filter(
            school_id=self.school_id,
        ).filter(
            Q(first_name__icontains=teacher_name) | Q(last_name__icontains=teacher_name)
        ).first()
        if not teacher:
            return {"error": f"Teacher '{teacher_name}' not found."}

        entries = TimetableEntry.objects.filter(
            school_id=self.school_id, teacher=teacher
        ).select_related('slot', 'subject', 'class_obj').order_by('day', 'slot__order')

        schedule = {}
        for entry in entries:
            day = entry.get_day_display()
            schedule.setdefault(day, []).append({
                'period': entry.slot.name,
                'class': entry.class_obj.name,
                'subject': entry.subject.name if entry.subject else '-',
                'room': entry.room or '-',
            })

        return {
            "teacher": teacher.full_name,
            "total_periods": entries.count(),
            "schedule": schedule,
        }

    def _get_free_teachers(self, day: str, period: str = None) -> dict:
        from hr.models import StaffMember
        from .models import TimetableEntry, TimetableSlot

        day_upper = day.upper()[:3]

        # Get busy teachers
        entry_qs = TimetableEntry.objects.filter(
            school_id=self.school_id, day=day_upper
        )
        if period:
            slots = TimetableSlot.objects.filter(
                school_id=self.school_id, name__icontains=period
            )
            if slots.exists():
                entry_qs = entry_qs.filter(slot__in=slots)

        busy_ids = set(entry_qs.values_list('teacher_id', flat=True))
        free_teachers = StaffMember.objects.filter(
            school_id=self.school_id, is_active=True, employment_status='ACTIVE'
        ).exclude(id__in=busy_ids)

        return {
            "day": day_upper,
            "period_filter": period,
            "free_teachers": [
                {"name": t.full_name, "department": t.department.name if t.department else '-'}
                for t in free_teachers[:20]
            ],
            "count": free_teachers.count(),
        }

    def _get_subject_schedule(self, subject_name: str, class_name: str = None) -> dict:
        from .models import Subject, TimetableEntry

        subject = Subject.objects.filter(
            school_id=self.school_id, name__icontains=subject_name
        ).first()
        if not subject:
            return {"error": f"Subject '{subject_name}' not found."}

        entry_qs = TimetableEntry.objects.filter(
            school_id=self.school_id, subject=subject
        ).select_related('slot', 'class_obj', 'teacher').order_by('class_obj__name', 'day', 'slot__order')

        if class_name:
            entry_qs = entry_qs.filter(class_obj__name__icontains=class_name)

        schedule = []
        for entry in entry_qs[:30]:
            schedule.append({
                'class': entry.class_obj.name,
                'day': entry.get_day_display(),
                'period': entry.slot.name,
                'teacher': entry.teacher.full_name if entry.teacher else '-',
            })

        return {
            "subject": subject.name,
            "class_filter": class_name,
            "total_periods": len(schedule),
            "schedule": schedule,
        }

    def _get_workload_summary(self, teacher_name: str = None) -> dict:
        analyzer = WorkloadAnalyzer(self.school_id)
        result = analyzer.analyze()

        if teacher_name:
            filtered = [
                t for t in result['teachers']
                if teacher_name.lower() in t['teacher_name'].lower()
            ]
            return {"teachers": filtered, "filter": teacher_name}

        return result

    def _get_class_info(self, class_name: str) -> dict:
        from students.models import Class
        from .models import ClassSubject

        cls = Class.objects.filter(
            school_id=self.school_id, name__icontains=class_name
        ).first()
        if not cls:
            return {"error": f"Class '{class_name}' not found."}

        assignments = ClassSubject.objects.filter(
            school_id=self.school_id, class_obj=cls, is_active=True
        ).select_related('subject', 'teacher')

        return {
            "class": cls.name,
            "subjects": [
                {
                    "subject": a.subject.name,
                    "code": a.subject.code,
                    "teacher": a.teacher.full_name if a.teacher else 'Unassigned',
                    "periods_per_week": a.periods_per_week,
                }
                for a in assignments
            ],
        }

    def _fallback_response(self, user_message: str) -> str:
        """Keyword-based fallback when LLM is not available."""
        msg = user_message.lower()

        if any(w in msg for w in ['schedule', 'timetable', 'when']):
            # Try to find a class name or teacher name
            if 'class' in msg:
                return (
                    "I can look up class schedules. Please navigate to the Timetable page "
                    "and select a class to view its full schedule."
                )
            return (
                "I can help with schedule questions. Please specify a class name "
                "(e.g., 'When does Class 5A have Math?') and I'll look it up."
            )
        elif any(w in msg for w in ['free', 'available', 'substitute']):
            return (
                "To find free teachers, please navigate to the Timetable page and use "
                "the 'Find Substitute' feature, or ask me with a specific day "
                "(e.g., 'Which teachers are free on Tuesday period 3?')."
            )
        elif any(w in msg for w in ['workload', 'load', 'periods']):
            analyzer = WorkloadAnalyzer(self.school_id)
            result = analyzer.analyze()
            summary = result['summary']
            return (
                f"Teacher workload summary: {summary['total_teachers']} teachers, "
                f"{summary['overloaded']} overloaded, {summary['underloaded']} underloaded, "
                f"{summary['balanced']} balanced. Check the AI Insights tab on the Subjects "
                f"page for detailed analysis."
            )
        elif any(w in msg for w in ['subject', 'class info', 'teaches']):
            return (
                "I can look up subject and class information. Try asking something like "
                "'What subjects does Class 3B have?' or 'Show me Mr. Sharma's schedule'."
            )
        else:
            return (
                "I can help with questions about:\n"
                "- Class schedules (e.g., 'Show Class 5A timetable')\n"
                "- Teacher schedules (e.g., 'What's Mr. Sharma's schedule?')\n"
                "- Free teachers (e.g., 'Who is free on Tuesday period 3?')\n"
                "- Subject info (e.g., 'When is Math taught?')\n"
                "- Workload (e.g., 'Show teacher workload summary')\n"
                "Please try asking about one of these topics."
            )
