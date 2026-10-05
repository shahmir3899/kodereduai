"""
AI Smart Promotion Advisor Service.

Analyzes student exam performance, attendance, fee status, and trends
to generate promotion recommendations (PROMOTE / NEEDS_REVIEW / RETAIN).
"""

import logging
from collections import defaultdict

from django.db.models import Q, Count, Avg, Sum, F, Case, When, Value, DecimalField

logger = logging.getLogger(__name__)


class PromotionAdvisorService:
    """Generates AI-driven promotion recommendations for students in a class."""

    def __init__(self, school_id: int, academic_year_id: int):
        self.school_id = school_id
        self.academic_year_id = academic_year_id

    def get_recommendations(self, class_id: int, manual_graduates: set = None) -> list:
        """
        Analyze all students enrolled in the given class for the academic year
        and return a list of promotion recommendations.
        """
        from academic_sessions.models import StudentEnrollment
        from attendance.models import AttendanceRecord
        from finance.models import FeePayment
        from examinations.models import StudentMark, ExamSubject, Exam

        # 1. Get all enrolled students for this class and year
        enrollments = StudentEnrollment.objects.filter(
            school_id=self.school_id,
            academic_year_id=self.academic_year_id,
            class_obj_id=class_id,
            is_active=True,
        ).select_related('student', 'student__school', 'class_obj')

        # Get highest grade_level for this school
        from students.models import Class
        from schools.models import School
        highest_grade = Class.get_highest_grade_level(self.school_id)
        manual_graduates = manual_graduates or set()

        if not enrollments.exists():
            return []

        attendance_risk_threshold = School.objects.only('id', 'attendance_config').get(
            id=self.school_id,
        ).get_attendance_risk_threshold()

        student_ids = list(enrollments.values_list('student_id', flat=True))

        # 2. Fetch all exams for this class and academic year
        exams = Exam.objects.filter(
            school_id=self.school_id,
            academic_year_id=self.academic_year_id,
            class_obj_id=class_id,
            is_active=True,
        ).order_by('start_date')

        exam_ids = list(exams.values_list('id', flat=True))

        # 3. Fetch all marks for these students in these exams
        marks_qs = StudentMark.objects.filter(
            school_id=self.school_id,
            student_id__in=student_ids,
            exam_subject__exam_id__in=exam_ids,
        ).select_related('exam_subject', 'exam_subject__exam', 'exam_subject__subject')

        # Build per-student marks data
        student_marks = defaultdict(list)
        for mark in marks_qs:
            student_marks[mark.student_id].append(mark)

        # Build per-student per-exam marks for trend analysis
        student_exam_marks = defaultdict(lambda: defaultdict(list))
        for mark in marks_qs:
            student_exam_marks[mark.student_id][mark.exam_subject.exam_id].append(mark)

        # A student transferred in from another branch is judged on the whole year: the
        # exams, attendance and payments they had at the earlier branch(es), read in place
        # (students.timeline), count as theirs. Everyone else costs nothing extra.
        timelines, earlier_by_old, year_window = self._transferred_in(enrollments)
        if timelines:
            exam_dates = {e.id: e.start_date for e in exams}
            for owner, mark in self._earlier_marks(earlier_by_old, year_window):
                exam = mark.exam_subject.exam
                student_marks[owner].append(mark)
                student_exam_marks[owner][exam.id].append(mark)
                if exam.id not in exam_dates:
                    exam_dates[exam.id] = exam.start_date
                    exam_ids.append(exam.id)
            exam_ids.sort(key=lambda eid: (exam_dates[eid] is None, exam_dates[eid]))

        # 4. Fetch attendance data for these students in the academic year
        attendance_stats = {}
        attendance_qs = AttendanceRecord.objects.filter(
            school_id=self.school_id,
            student_id__in=student_ids,
            academic_year_id=self.academic_year_id,
        ).values('student_id').annotate(
            total_days=Count('id'),
            present_days=Count('id', filter=Q(status='PRESENT')),
        )
        for row in attendance_qs:
            total = row['total_days']
            present = row['present_days']
            attendance_stats[row['student_id']] = {
                'total_days': total,
                'present_days': present,
                'rate': round((present / total) * 100, 1) if total > 0 else 0.0,
            }
        for owner, (total, present) in self._earlier_attendance(earlier_by_old, year_window).items():
            current = attendance_stats.get(owner, {'total_days': 0, 'present_days': 0})
            total, present = total + current['total_days'], present + current['present_days']
            attendance_stats[owner] = {
                'total_days': total, 'present_days': present,
                'rate': round((present / total) * 100, 1) if total > 0 else 0.0,
            }

        # 5. Fetch fee payment data for these students in the academic year
        fee_stats = {}
        fee_qs = FeePayment.objects.filter(
            school_id=self.school_id,
            student_id__in=student_ids,
            academic_year_id=self.academic_year_id,
        ).exclude(
            # The carried row is the same debt as the earlier branch's last row, counted below.
            carried_from_exit__isnull=False, student_id__in=list(timelines),
        ).values('student_id').annotate(
            total_records=Count('id'),
            paid_count=Count('id', filter=Q(status='PAID')),
            partial_count=Count('id', filter=Q(status='PARTIAL')),
            unpaid_count=Count('id', filter=Q(status='UNPAID')),
        )
        for row in fee_qs:
            total = row['total_records']
            paid = row['paid_count']
            partial = row['partial_count']
            fee_stats[row['student_id']] = {
                'total': total,
                'paid': paid,
                'partial': partial,
                'unpaid': row['unpaid_count'],
                'rate': round(((paid + partial * 0.5) / total) * 100, 1) if total > 0 else 0.0,
            }

        for owner, row in self._earlier_fees(earlier_by_old).items():
            current = fee_stats.get(owner, {'total': 0, 'paid': 0, 'partial': 0, 'unpaid': 0})
            total = current['total'] + row['total']
            paid, partial = current['paid'] + row['paid'], current['partial'] + row['partial']
            fee_stats[owner] = {
                'total': total, 'paid': paid, 'partial': partial, 'unpaid': current['unpaid'] + row['unpaid'],
                'rate': round(((paid + partial * 0.5) / total) * 100, 1) if total > 0 else 0.0,
            }

        # 6. Generate recommendations for each student
        recommendations = []
        for enrollment in enrollments:
            student = enrollment.student
            sid = student.id

            # Exam performance
            marks_list = student_marks.get(sid, [])
            exam_data = self._analyze_exam_performance(marks_list)

            # Attendance
            att = attendance_stats.get(sid, {'total_days': 0, 'present_days': 0, 'rate': 0.0})
            attendance_rate = att['rate']

            # Fee status
            fee = fee_stats.get(sid, {'total': 0, 'paid': 0, 'partial': 0, 'unpaid': 0, 'rate': 0.0})
            fee_paid_rate = fee['rate']

            # Trend analysis
            exam_marks_by_exam = student_exam_marks.get(sid, {})
            trend = self._analyze_trend(exam_marks_by_exam, exam_ids)

            # Confidence score
            confidence = self._calculate_confidence(marks_list, att, fee)

            # Risk flags
            risk_flags = self._identify_risk_flags(
                exam_data, attendance_rate, fee_paid_rate, trend, marks_list,
                attendance_risk_threshold,
            )

            # Graduation logic
            is_highest_class = (enrollment.class_obj.grade_level == highest_grade)
            if sid in manual_graduates or is_highest_class:
                recommendation = 'GRADUATE'
                reasoning = 'Graduation: Highest class or manually flagged.'
            else:
                recommendation, reasoning = self._determine_recommendation(
                    exam_data, attendance_rate, fee_paid_rate, trend, risk_flags,
                )

            recommendations.append({
                'student_id': sid,
                'student_name': student.name,
                'roll_number': enrollment.roll_number,
                'class_name': enrollment.class_obj.name,
                'recommendation': recommendation,
                'confidence': confidence,
                'attendance_rate': attendance_rate,
                'average_score': exam_data['average_percentage'],
                'fee_paid_rate': fee_paid_rate,
                'trend': trend,
                'reasoning': reasoning,
                'risk_flags': risk_flags,
                'subject_scores': exam_data['subject_scores'],
                'failed_subjects': exam_data['failed_subjects'],
            })

        # Sort by recommendation priority: REPEAT first, then NEEDS_REVIEW, then PROMOTE, then GRADUATE
        priority = {'REPEAT': 0, 'NEEDS_REVIEW': 1, 'PROMOTE': 2, 'GRADUATE': 3}
        recommendations.sort(key=lambda r: (priority.get(r['recommendation'], 4), r['roll_number']))

        return recommendations

    def _transferred_in(self, enrollments):
        """({student_id: segments}, {earlier record id: current student id}, (year start, year end))
        for the students in ``enrollments`` who were transferred in from another branch."""
        from academic_sessions.models import AcademicYear
        from students.timeline import student_timeline

        timelines = {}
        for enrollment in enrollments:
            student = enrollment.student
            if student.transferred_from_id:
                segments = student_timeline(student)
                if len(segments) > 1:
                    timelines[student.id] = segments
        if not timelines:
            return {}, {}, None
        year = AcademicYear.objects.filter(pk=self.academic_year_id).only('start_date', 'end_date').first()
        earlier_by_old = {
            seg.student_id: (owner, seg)
            for owner, segments in timelines.items() for seg in segments if not seg.is_current
        }
        return timelines, earlier_by_old, (year.start_date, year.end_date) if year else None

    @staticmethod
    def _segment_q(earlier_by_old, year_window, date_field):
        from django.db.models import Q

        query = Q()
        for _old_id, (_owner, seg) in earlier_by_old.items():
            part = Q(student_id=seg.student_id, school_id=seg.school_id, **{f'{date_field}__lt': seg.end})
            if seg.start is not None:
                part &= Q(**{f'{date_field}__gte': seg.start})
            if year_window:
                part &= Q(**{f'{date_field}__gte': year_window[0], f'{date_field}__lte': year_window[1]})
            query |= part
        return query

    def _earlier_marks(self, earlier_by_old, year_window):
        from examinations.models import StudentMark

        marks = StudentMark.objects.filter(
            self._segment_q(earlier_by_old, year_window, 'exam_subject__exam__start_date'),
            exam_subject__is_active=True,
        ).select_related('exam_subject', 'exam_subject__exam', 'exam_subject__subject')
        return [(earlier_by_old[m.student_id][0], m) for m in marks]

    def _earlier_attendance(self, earlier_by_old, year_window):
        from attendance.models import AttendanceRecord

        if not earlier_by_old:
            return {}
        rows = AttendanceRecord.objects.filter(
            self._segment_q(earlier_by_old, year_window, 'date'),
        ).values('student_id').annotate(total=Count('id'), present=Count('id', filter=Q(status='PRESENT')))
        totals = {}
        for row in rows:
            owner = earlier_by_old[row['student_id']][0]
            total, present = totals.get(owner, (0, 0))
            totals[owner] = (total + row['total'], present + row['present'])
        return totals

    def _earlier_fees(self, earlier_by_old):
        from finance.models import FeePayment

        if not earlier_by_old:
            return {}
        from django.db.models import Q as _Q

        query = _Q()
        for _old_id, (_owner, seg) in earlier_by_old.items():
            query |= _Q(student_id=seg.student_id, school_id=seg.school_id)
        rows = FeePayment.objects.filter(query).values('student_id').annotate(
            total=Count('id'), paid=Count('id', filter=Q(status='PAID')),
            partial=Count('id', filter=Q(status='PARTIAL')), unpaid=Count('id', filter=Q(status='UNPAID')),
        )
        totals = {}
        for row in rows:
            owner = earlier_by_old[row['student_id']][0]
            cur = totals.setdefault(owner, {'total': 0, 'paid': 0, 'partial': 0, 'unpaid': 0})
            for key in cur:
                cur[key] += row[key]
        return totals

    def _analyze_exam_performance(self, marks_list: list) -> dict:
        """Analyze exam performance from a list of StudentMark objects."""
        if not marks_list:
            return {
                'average_percentage': 0.0,
                'passing': False,
                'subject_scores': [],
                'failed_subjects': [],
                'total_subjects': 0,
            }

        total_percentage = 0.0
        count = 0
        subject_scores = []
        failed_subjects = []

        for mark in marks_list:
            if mark.is_absent or mark.marks_obtained is None:
                subject_name = mark.exam_subject.subject.name
                failed_subjects.append(subject_name)
                subject_scores.append({
                    'subject': subject_name,
                    'percentage': 0.0,
                    'passed': False,
                    'absent': True,
                })
                total_percentage += 0.0
                count += 1
                continue

            total_marks = float(mark.exam_subject.total_marks)
            obtained = float(mark.marks_obtained)

            pct = (obtained / total_marks * 100) if total_marks > 0 else 0.0
            passed = mark.is_pass
            subject_name = mark.exam_subject.subject.name

            subject_scores.append({
                'subject': subject_name,
                'percentage': round(pct, 1),
                'passed': passed,
                'absent': False,
            })

            if not passed:
                failed_subjects.append(subject_name)

            total_percentage += pct
            count += 1

        average_pct = round(total_percentage / count, 1) if count > 0 else 0.0
        # Consider passing if average >= 40%
        passing = average_pct >= 40.0

        return {
            'average_percentage': average_pct,
            'passing': passing,
            'subject_scores': subject_scores,
            'failed_subjects': list(set(failed_subjects)),
            'total_subjects': count,
        }

    def _analyze_trend(self, exam_marks_by_exam: dict, ordered_exam_ids: list) -> str:
        """
        Analyze performance trend across exams (term-over-term).
        Returns: 'improving', 'stable', 'declining', or 'insufficient_data'
        """
        # Only consider exams that this student has marks for, in chronological order
        exam_averages = []
        for exam_id in ordered_exam_ids:
            marks = exam_marks_by_exam.get(exam_id, [])
            if not marks:
                continue

            total_pct = 0.0
            count = 0
            for mark in marks:
                if mark.is_absent or mark.marks_obtained is None:
                    continue
                total_marks = float(mark.exam_subject.total_marks)
                if total_marks > 0:
                    total_pct += float(mark.marks_obtained) / total_marks * 100
                    count += 1

            if count > 0:
                exam_averages.append(total_pct / count)

        if len(exam_averages) < 2:
            return 'insufficient_data'

        # Compare last exam to first exam
        first_avg = exam_averages[0]
        last_avg = exam_averages[-1]
        diff = last_avg - first_avg

        if diff > 5:
            return 'improving'
        elif diff < -5:
            return 'declining'
        else:
            return 'stable'

    def _calculate_confidence(self, marks_list: list, att: dict, fee: dict) -> int:
        """
        Calculate confidence score (0-100) based on data availability.
        More data = higher confidence.
        """
        confidence = 0

        # Exam data contributes up to 40 points
        if marks_list:
            marks_count = len(marks_list)
            if marks_count >= 10:
                confidence += 40
            elif marks_count >= 5:
                confidence += 30
            elif marks_count >= 1:
                confidence += 20

        # Attendance data contributes up to 35 points
        total_att_days = att.get('total_days', 0)
        if total_att_days >= 100:
            confidence += 35
        elif total_att_days >= 50:
            confidence += 25
        elif total_att_days >= 10:
            confidence += 15
        elif total_att_days >= 1:
            confidence += 5

        # Fee data contributes up to 25 points
        total_fee = fee.get('total', 0)
        if total_fee >= 8:
            confidence += 25
        elif total_fee >= 4:
            confidence += 15
        elif total_fee >= 1:
            confidence += 10

        return min(confidence, 100)

    def _identify_risk_flags(self, exam_data: dict, attendance_rate: float,
                              fee_paid_rate: float, trend: str,
                              marks_list: list, attendance_risk_threshold: float) -> list:
        """Identify risk flags for a student."""
        flags = []

        # Attendance flags -- the 75% tier is this school's own configured
        # policy (School.get_attendance_risk_threshold), same number the
        # attendance risk dashboard and session health stats use.
        if attendance_rate < 60:
            flags.append('Critical: Attendance below 60%')
        elif attendance_rate < attendance_risk_threshold:
            flags.append(f'Attendance below {attendance_risk_threshold:g}%')

        # Exam flags
        if exam_data['average_percentage'] < 35:
            flags.append('Critical: Average score below 35%')
        elif exam_data['average_percentage'] < 40:
            flags.append('Average score below passing (40%)')

        # Failed subjects
        for subj in exam_data['failed_subjects']:
            flags.append(f'Below passing in {subj}')

        # Fee flags
        if fee_paid_rate < 50:
            flags.append('Most fees unpaid')
        elif fee_paid_rate < 75:
            flags.append('Significant fee arrears')

        # Trend flags
        if trend == 'declining':
            flags.append('Declining performance trend')

        # No data flags
        if not marks_list:
            flags.append('No exam data available')

        return flags

    def _determine_recommendation(self, exam_data: dict, attendance_rate: float,
                                   fee_paid_rate: float, trend: str,
                                   risk_flags: list) -> tuple:
        """
        Determine promotion recommendation and reasoning.
        Returns (recommendation, reasoning) tuple.
        """
        avg_score = exam_data['average_percentage']
        reasoning_parts = []

        # RETAIN conditions
        if attendance_rate < 60:
            reasoning_parts.append(f'Very low attendance ({attendance_rate}%)')
        if avg_score < 35 and exam_data['total_subjects'] > 0:
            reasoning_parts.append(f'Below minimum passing threshold ({avg_score}%)')

        if attendance_rate < 60 or (avg_score < 35 and exam_data['total_subjects'] > 0):
            reasoning = 'Retention recommended: ' + ', '.join(reasoning_parts)
            return 'RETAIN', reasoning

        # NEEDS_REVIEW conditions
        needs_review = False
        review_reasons = []

        if 60 <= attendance_rate < 75:
            needs_review = True
            review_reasons.append(f'Borderline attendance ({attendance_rate}%)')
        if 35 <= avg_score < 50 and exam_data['total_subjects'] > 0:
            needs_review = True
            review_reasons.append(f'Borderline academic performance ({avg_score}%)')
        if trend == 'declining':
            needs_review = True
            review_reasons.append('Declining performance trend')
        if len(exam_data['failed_subjects']) >= 3:
            needs_review = True
            review_reasons.append(f'Failed in {len(exam_data["failed_subjects"])} subjects')

        if needs_review:
            reasoning = 'Needs manual review: ' + ', '.join(review_reasons)
            return 'NEEDS_REVIEW', reasoning

        # PROMOTE
        promote_reasons = []
        if exam_data['total_subjects'] > 0:
            promote_reasons.append(f'Good academic performance ({avg_score}%)')
        if attendance_rate >= 75:
            promote_reasons.append(f'Good attendance ({attendance_rate}%)')
        if trend == 'improving':
            promote_reasons.append('Improving trend')
        if fee_paid_rate >= 75:
            promote_reasons.append('Fees mostly paid')

        if not promote_reasons:
            promote_reasons.append('Meets basic promotion criteria')

        reasoning = 'Promotion recommended: ' + ', '.join(promote_reasons)
        return 'PROMOTE', reasoning
