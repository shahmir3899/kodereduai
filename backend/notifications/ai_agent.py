"""
AI Parent Communication Assistant.
Chat-based AI that helps admins draft parent communications.
Uses tool-calling pattern with multi-round support.
"""

import json
import logging
from datetime import timedelta

from django.conf import settings
from django.db.models import Sum, Count
from django.utils import timezone

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a school communication assistant for {school_name}. You help administrators draft professional parent communications.

You have access to these tools to look up information:

{tools}

When you need information, respond with a JSON tool call:
{{"tool": "tool_name", "params": {{"param1": "value1"}}}}

When you have enough information to respond, provide your answer directly.

Guidelines:
- Be professional, warm, and respectful
- Use simple language (parents may not be English-first)
- Include relevant details (student name, class, dates)
- Keep messages concise (under 200 words for WhatsApp)
- For formal letters, use proper salutation and closing
"""

TOOLS = [
    {
        "name": "get_student_info",
        "description": "Get student details including class, parent contact, attendance rate, fee status",
        "parameters": {"student_id": "int"}
    },
    {
        "name": "get_class_info",
        "description": "Get class details including student count and teacher",
        "parameters": {"class_id": "int"}
    },
    {
        "name": "get_attendance_summary",
        "description": "Get attendance summary for a student or class",
        "parameters": {"student_id": "int (optional)", "class_id": "int (optional)"}
    },
    {
        "name": "get_fee_status",
        "description": "Get fee payment status for a student",
        "parameters": {"student_id": "int"}
    },
    {
        "name": "draft_message",
        "description": "Draft a notification message",
        "parameters": {
            "type": "absence_followup | fee_reminder | meeting_invite | progress_update | circular",
            "recipient": "parent name or 'all parents'",
            "context": "additional details"
        }
    },
    {
        "name": "get_exam_performance",
        "description": "Get student's exam marks, grades, and pass/fail status",
        "parameters": {"student_id": "int"}
    },
    {
        "name": "get_assignment_status",
        "description": "Get student's assignment submissions: pending, submitted, graded with feedback",
        "parameters": {"student_id": "int"}
    },
    {
        "name": "get_detailed_attendance",
        "description": "Get day-by-day attendance for last N days with absence dates",
        "parameters": {"student_id": "int", "days": "int (optional, default 30)"}
    },
    {
        "name": "get_transport_status",
        "description": "Get student's transport route, stop, and recent boarding records",
        "parameters": {"student_id": "int"}
    },
    {
        "name": "get_class_teacher_info",
        "description": "Get subject teachers assigned to a class",
        "parameters": {"class_id": "int"}
    },
    {
        "name": "get_communication_preferences",
        "description": "Get parent's notification channel preferences (opt-in/out)",
        "parameters": {"student_id": "int"}
    },
    {
        "name": "get_leave_requests",
        "description": "Get pending/approved leave requests for a student",
        "parameters": {"student_id": "int"}
    },
    {
        "name": "get_financial_aid_status",
        "description": "Get scholarships and discounts applied to a student",
        "parameters": {"student_id": "int"}
    },
    {
        "name": "get_notification_history",
        "description": "Get past notifications sent for a student",
        "parameters": {"student_id": "int"}
    },
    {
        "name": "get_curriculum_progress",
        "description": "Get recent and upcoming lessons for a class",
        "parameters": {"class_id": "int", "subject_id": "int (optional)"}
    },
]


class ParentCommunicationAgent:
    """
    AI agent for drafting parent communications.

    Usage:
        agent = ParentCommunicationAgent(school_id)
        response = agent.chat("Draft a fee reminder for students in Class 5-A")
    """

    def __init__(self, school_id):
        self.school_id = school_id
        from schools.models import School
        self.school = School.objects.get(id=school_id)

    def _execute_tool(self, tool_name, params):
        """Execute a tool call and return the result."""
        tools = {
            'get_student_info': lambda p: self._get_student_info(p.get('student_id')),
            'get_class_info': lambda p: self._get_class_info(p.get('class_id')),
            'get_attendance_summary': lambda p: self._get_attendance_summary(
                p.get('student_id'), p.get('class_id')
            ),
            'get_fee_status': lambda p: self._get_fee_status(p.get('student_id')),
            'draft_message': lambda p: self._draft_message(p),
            'get_exam_performance': lambda p: self._get_exam_performance(p.get('student_id')),
            'get_assignment_status': lambda p: self._get_assignment_status(p.get('student_id')),
            'get_detailed_attendance': lambda p: self._get_detailed_attendance(
                p.get('student_id'), p.get('days', 30)
            ),
            'get_transport_status': lambda p: self._get_transport_status(p.get('student_id')),
            'get_class_teacher_info': lambda p: self._get_class_teacher_info(p.get('class_id')),
            'get_communication_preferences': lambda p: self._get_communication_preferences(p.get('student_id')),
            'get_leave_requests': lambda p: self._get_leave_requests(p.get('student_id')),
            'get_financial_aid_status': lambda p: self._get_financial_aid_status(p.get('student_id')),
            'get_notification_history': lambda p: self._get_notification_history(p.get('student_id')),
            'get_curriculum_progress': lambda p: self._get_curriculum_progress(
                p.get('class_id'), p.get('subject_id')
            ),
        }
        try:
            handler = tools.get(tool_name)
            if not handler:
                available = ', '.join(tools.keys())
                return f"Unknown tool: {tool_name}. Available tools: {available}"
            return handler(params)
        except Exception as e:
            return f"Error: {str(e)}"

    # ── Original Tools (1-5) ─────────────────────────────────────────────

    def _student(self, student_id):
        """The student, looked up in THIS school only (a student id from the chat is never
        trusted to name another school's record); earlier branches are reached through the
        transfer link, not through the id."""
        from students.models import Student

        return Student.objects.select_related('class_obj', 'school').get(id=student_id, school=self.school)

    def _get_student_info(self, student_id):
        student = self._student(student_id)
        from students import history

        att = history.attendance_totals(student)
        att_total, att_present = att['total_days'], att['present_days']

        from academic_sessions.roster import current_placement, placement_label, placement_roll

        placement = current_placement(student)
        return json.dumps({
            'name': student.name,
            'class': placement_label(placement, student),
            'roll_number': placement_roll(placement, student),
            'parent_name': student.parent_name or student.guardian_name,
            'parent_phone': student.parent_phone or student.guardian_phone,
            'attendance_rate': f"{round(att_present / att_total * 100, 1)}%" if att_total else 'N/A',
            'status': student.status,
        })

    def _get_class_info(self, class_id):
        from students.models import Class

        from academic_sessions.roster import class_student_count

        cls = Class.objects.get(id=class_id, school=self.school)
        student_count = class_student_count(cls)

        return json.dumps({
            'name': cls.name,
            'grade_level': cls.grade_level,
            'section': cls.section,
            'student_count': student_count,
        })

    def _get_attendance_summary(self, student_id=None, class_id=None):
        from attendance.models import AttendanceRecord

        if student_id and not class_id:
            # One student: every branch they have been at, leave counted as present.
            from students import history

            att = history.attendance_totals(self._student(student_id))
            return json.dumps({
                'total_records': att['total_days'],
                'present': att['present_days'] - att['leave'],
                'absent': att['absent'],
                'leave': att['leave'],
                'rate': f"{att['rate']}%" if att['total_days'] else 'N/A',
            })

        filters = {'school': self.school}
        if student_id:
            filters['student_id'] = student_id
        if class_id:
            filters['class_obj_id'] = class_id

        total = AttendanceRecord.objects.filter(**filters).count()
        present = AttendanceRecord.objects.filter(**filters, status='PRESENT').count()
        absent = AttendanceRecord.objects.filter(**filters, status='ABSENT').count()
        leave = AttendanceRecord.objects.filter(**filters, status='LEAVE').count()

        return json.dumps({
            'total_records': total,
            'present': present,
            'absent': absent,
            'leave': leave,
            'rate': f"{round(present / total * 100, 1)}%" if total else 'N/A',
        })

    def _get_fee_status(self, student_id):
        from finance.student_balance import student_fee_summary, student_pending_fees
        from students import timeline

        # The shared calculation (summing every monthly row counts a carried-forward balance
        # again each month), across every branch the student has been at: paid counts at
        # all of them, owed is only this branch's.
        student = self._student(student_id)
        fees = student_fee_summary(student, timeline.student_timeline(student))
        owing = student_pending_fees(student)['items']

        return json.dumps({
            'total_due': str(fees['total_due']),
            'total_paid': str(fees['total_paid']),
            'outstanding': str(fees['pending']),
            'pending_months': len(owing),
        })

    def _draft_message(self, params):
        return json.dumps({
            'note': 'Use the LLM to draft the message based on the collected context',
            'type': params.get('type', 'general'),
            'recipient': params.get('recipient', 'parent'),
        })

    # ── New Tools (6-15) ─────────────────────────────────────────────────

    def _get_exam_performance(self, student_id):
        from students import history

        # Results at every branch the student has been at, newest first.
        marks = history.exam_marks(self._student(student_id))[:20]

        result = []
        for m in marks:
            result.append({
                'exam': m.exam_subject.exam.name,
                'subject': m.exam_subject.subject.name,
                'marks_obtained': float(m.marks_obtained) if m.marks_obtained else 0,
                'total_marks': float(m.exam_subject.total_marks),
                'percentage': float(m.percentage) if m.percentage else 0,
                'is_pass': m.is_pass,
                'is_absent': m.is_absent,
            })
        return json.dumps({'marks': result, 'total': len(result)})

    def _get_assignment_status(self, student_id):
        from students.models import Student
        from lms.models import Assignment, AssignmentSubmission

        from academic_sessions.roster import current_year_q, own_section_q, placement_scope

        student = Student.objects.get(id=student_id, school=self.school)
        # Own section and current year only; the master class alone listed
        # sibling sections' and past years' assignments.
        class_obj_id, year_id = placement_scope(student)
        assignments = Assignment.objects.filter(
            current_year_q(year_id),
            own_section_q(student),
            school=self.school,
            class_obj_id=class_obj_id,
            status='PUBLISHED',
        ).select_related('subject').order_by('due_date')[:20]

        result = []
        for a in assignments:
            sub = AssignmentSubmission.objects.filter(
                assignment=a, student=student,
            ).first()
            result.append({
                'title': a.title,
                'subject': a.subject.name,
                'due_date': str(a.due_date),
                'status': sub.status if sub else 'NOT_SUBMITTED',
                'marks': float(sub.marks_obtained) if sub and sub.marks_obtained else None,
            })
        return json.dumps({'assignments': result, 'total': len(result)})

    def _get_detailed_attendance(self, student_id, days=30):
        from students import history

        cutoff = timezone.now().date() - timedelta(days=int(days))
        records = history.attendance_records(self._student(student_id)).filter(date__gte=cutoff).order_by('-date')

        total = records.count()
        present = records.filter(status='PRESENT').count()
        absent = records.filter(status='ABSENT').count()
        leave = records.filter(status='LEAVE').count()
        absent_dates = list(records.filter(status='ABSENT').values_list('date', flat=True)[:10])

        return json.dumps({
            'days_checked': total,
            'present': present,
            'absent': absent,
            'leave': leave,
            'rate': f"{round(present / total * 100, 1)}%" if total else 'N/A',
            'recent_absences': [str(d) for d in absent_dates],
        })

    def _get_transport_status(self, student_id):
        from transport.models import TransportAssignment, TransportAttendance

        assignment = TransportAssignment.objects.filter(
            student_id=student_id, school=self.school, is_active=True,
        ).select_related('route', 'stop', 'vehicle').first()

        if not assignment:
            return json.dumps({'status': 'No active transport assignment'})

        recent = TransportAttendance.objects.filter(
            student_id=student_id, school=self.school,
        ).order_by('-date')[:5]

        return json.dumps({
            'route': assignment.route.name if assignment.route else '-',
            'stop': assignment.stop.name if assignment.stop else '-',
            'vehicle': assignment.vehicle.registration_number if assignment.vehicle else '-',
            'recent_boarding': [
                {'date': str(r.date), 'status': r.boarding_status}
                for r in recent
            ],
        })

    def _get_class_teacher_info(self, class_id):
        from academics.models import ClassSubject

        assignments = ClassSubject.objects.filter(
            school=self.school, class_obj_id=class_id, is_active=True,
        ).select_related('subject', 'teacher')

        return json.dumps({
            'teachers': [
                {
                    'subject': cs.subject.name,
                    'teacher': cs.teacher.full_name if cs.teacher else '-',
                }
                for cs in assignments
            ],
        })

    def _get_communication_preferences(self, student_id):
        from .models import NotificationPreference

        prefs = NotificationPreference.objects.filter(
            school=self.school, student_id=student_id,
        )

        return json.dumps({
            'preferences': [
                {
                    'channel': p.channel,
                    'event_type': p.event_type,
                    'is_enabled': p.is_enabled,
                }
                for p in prefs
            ],
        })

    def _get_leave_requests(self, student_id):
        from parents.models import ParentLeaveRequest

        requests = ParentLeaveRequest.objects.filter(
            school=self.school, student_id=student_id,
        ).order_by('-created_at')[:10]

        return json.dumps({
            'leave_requests': [
                {
                    'start_date': str(r.start_date),
                    'end_date': str(r.end_date),
                    'reason': r.reason,
                    'status': r.status,
                }
                for r in requests
            ],
        })

    def _get_financial_aid_status(self, student_id):
        from finance.models import StudentDiscount

        discounts = StudentDiscount.objects.filter(
            student_id=student_id, is_active=True,
        ).select_related('discount', 'scholarship')

        result = []
        for sd in discounts:
            if sd.discount:
                result.append({
                    'type': 'Discount',
                    'name': sd.discount.name,
                    'discount_type': sd.discount.discount_type,
                    'value': float(sd.discount.value),
                })
            if sd.scholarship:
                result.append({
                    'type': 'Scholarship',
                    'name': sd.scholarship.name,
                    'coverage': sd.scholarship.coverage,
                })
        return json.dumps({'financial_aid': result})

    def _get_notification_history(self, student_id):
        from .models import NotificationLog

        logs = NotificationLog.objects.filter(
            school=self.school, student_id=student_id,
        ).order_by('-created_at')[:10]

        return json.dumps({
            'notifications': [
                {
                    'channel': n.channel,
                    'event_type': n.event_type,
                    'title': n.title,
                    'status': n.status,
                    'sent_at': str(n.sent_at) if n.sent_at else None,
                }
                for n in logs
            ],
        })

    def _get_curriculum_progress(self, class_id, subject_id=None):
        from lms.models import LessonPlan

        qs = LessonPlan.objects.filter(
            school=self.school, class_obj_id=class_id, status='PUBLISHED',
        ).select_related('subject').order_by('-lesson_date')

        if subject_id:
            qs = qs.filter(subject_id=subject_id)

        lessons = qs[:10]
        return json.dumps({
            'recent_lessons': [
                {
                    'title': lp.title,
                    'subject': lp.subject.name,
                    'date': str(lp.lesson_date),
                    'objectives': lp.objectives or '',
                }
                for lp in lessons
            ],
        })

    # ── Chat ─────────────────────────────────────────────────────────────

    def chat(self, user_message, history=None):
        """
        Process a chat message and return a response.

        Args:
            user_message: The user's message
            history: List of previous messages [{'role': 'user'|'assistant', 'content': str}]

        Returns:
            str: The assistant's response
        """
        try:
            from groq import Groq

            if not settings.GROQ_API_KEY:
                return self._fallback_response(user_message)

            client = Groq(api_key=settings.GROQ_API_KEY)

            tools_desc = json.dumps(TOOLS, indent=2)
            system_msg = SYSTEM_PROMPT.format(
                school_name=self.school.name,
                tools=tools_desc,
            )

            messages = [{"role": "system", "content": system_msg}]
            if history:
                messages.extend(history)
            messages.append({"role": "user", "content": user_message})

            # First LLM call.
            # `.content` can legitimately be None (some Groq models emit only
            # reasoning on a given turn) — always coalesce before `.strip()`,
            # otherwise an AttributeError here gets caught by the outer except
            # and silently degrades every query to the generic fallback text.
            response = client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=messages,
                temperature=0.4,
                max_tokens=1000,
                reasoning_effort='low',
            )

            content = (response.choices[0].message.content or '').strip()

            # Check for tool calls
            max_tool_rounds = 3
            executed_any_tool = False
            for _ in range(max_tool_rounds):
                # Try to parse as JSON tool call
                if '```json' in content:
                    json_str = content.split('```json')[1].split('```')[0]
                elif '```' in content:
                    json_str = content.split('```')[1].split('```')[0]
                elif content.startswith('{'):
                    json_str = content
                else:
                    break  # Not a tool call — final response (may be empty, handled below)

                try:
                    tool_call = json.loads(json_str)
                except json.JSONDecodeError:
                    # Model didn't actually return a clean tool call this round —
                    # treat the prior content as the final answer rather than
                    # silently discarding it.
                    break

                if 'tool' not in tool_call:
                    break

                # Execute tool
                try:
                    tool_result = self._execute_tool(
                        tool_call['tool'],
                        tool_call.get('params', {})
                    )
                except Exception as tool_error:
                    # Don't let a bad tool call fall through to the outer except
                    # (which would leak the raw, unexecuted JSON to the user via
                    # the fallback path) — surface a clear message instead.
                    logger.error(
                        f"Communication agent tool '{tool_call.get('tool')}' failed: {tool_error}",
                        exc_info=True,
                    )
                    return (
                        "I found a matching request but hit an error looking up that "
                        "data. Please try rephrasing your question."
                    )

                # Add to messages and call again
                executed_any_tool = True
                messages.append({"role": "assistant", "content": content})
                messages.append({"role": "user", "content": f"Tool result: {json.dumps(tool_result, default=str)}"})

                response = client.chat.completions.create(
                    model=settings.GROQ_MODEL,
                    messages=messages,
                    temperature=0.4,
                    max_tokens=1000,
                    reasoning_effort='low',
                )
                content = (response.choices[0].message.content or '').strip()

            if not content:
                if executed_any_tool:
                    # We successfully fetched data but the model failed to
                    # summarize it (empty content) — ask once more explicitly
                    # rather than showing a blank chat bubble.
                    messages.append({
                        "role": "user",
                        "content": "Summarize the tool result above in a clear, direct answer.",
                    })
                    response = client.chat.completions.create(
                        model=settings.GROQ_MODEL,
                        messages=messages,
                        temperature=0.4,
                        max_tokens=1000,
                        reasoning_effort='low',
                    )
                    content = (response.choices[0].message.content or '').strip()
                if not content:
                    return (
                        "I looked that up but couldn't put together a clear answer. "
                        "Please try asking again."
                        if executed_any_tool else
                        "I couldn't generate a response to that. Please try rephrasing your question."
                    )

            return content

        except Exception as e:
            logger.error(f"Communication agent error: {e}", exc_info=True)
            return self._fallback_response(user_message)

    def _fallback_response(self, user_message):
        """Fallback when LLM is not available."""
        msg_lower = user_message.lower()

        if 'fee' in msg_lower or 'payment' in msg_lower:
            return (
                f"Dear Parent,\n\n"
                f"This is a reminder from {self.school.name} regarding pending fee payment. "
                f"Please ensure timely payment to avoid any inconvenience.\n\n"
                f"For queries, contact the school office.\n\n"
                f"Regards,\n{self.school.name}"
            )
        elif 'absent' in msg_lower or 'attendance' in msg_lower:
            return (
                f"Dear Parent,\n\n"
                f"We noticed your child's attendance has been irregular. "
                f"Regular attendance is essential for academic progress. "
                f"Please ensure your child attends school regularly.\n\n"
                f"Regards,\n{self.school.name}"
            )
        elif 'meeting' in msg_lower:
            return (
                f"Dear Parent,\n\n"
                f"You are cordially invited to a parent-teacher meeting at {self.school.name}. "
                f"Please confirm your availability.\n\n"
                f"Regards,\n{self.school.name}"
            )
        else:
            return (
                f"Dear Parent,\n\n"
                f"[Your message here]\n\n"
                f"Regards,\n{self.school.name}"
            )
