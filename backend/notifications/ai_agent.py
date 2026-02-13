"""
AI Parent Communication Assistant.
Chat-based AI that helps admins draft parent communications.
Follows the tool-calling pattern from finance/ai_agent.py.
"""

import json
import logging
from django.conf import settings

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
        try:
            if tool_name == 'get_student_info':
                return self._get_student_info(params.get('student_id'))
            elif tool_name == 'get_class_info':
                return self._get_class_info(params.get('class_id'))
            elif tool_name == 'get_attendance_summary':
                return self._get_attendance_summary(
                    params.get('student_id'), params.get('class_id')
                )
            elif tool_name == 'get_fee_status':
                return self._get_fee_status(params.get('student_id'))
            elif tool_name == 'draft_message':
                return self._draft_message(params)
            else:
                return f"Unknown tool: {tool_name}"
        except Exception as e:
            return f"Error: {str(e)}"

    def _get_student_info(self, student_id):
        from students.models import Student
        from django.db.models import Count, Q

        student = Student.objects.select_related('class_obj').get(
            id=student_id, school=self.school
        )
        from attendance.models import AttendanceRecord
        att_total = AttendanceRecord.objects.filter(student=student).count()
        att_present = AttendanceRecord.objects.filter(student=student, status='PRESENT').count()

        return json.dumps({
            'name': student.name,
            'class': student.class_obj.name,
            'roll_number': student.roll_number,
            'parent_name': student.parent_name or student.guardian_name,
            'parent_phone': student.parent_phone or student.guardian_phone,
            'attendance_rate': f"{round(att_present / att_total * 100, 1)}%" if att_total else 'N/A',
            'status': student.status,
        })

    def _get_class_info(self, class_id):
        from students.models import Class, Student

        cls = Class.objects.get(id=class_id, school=self.school)
        student_count = Student.objects.filter(class_obj=cls, is_active=True).count()

        return json.dumps({
            'name': cls.name,
            'grade_level': cls.grade_level,
            'section': cls.section,
            'student_count': student_count,
        })

    def _get_attendance_summary(self, student_id=None, class_id=None):
        from attendance.models import AttendanceRecord
        from django.db.models import Count, Q

        filters = {'school': self.school}
        if student_id:
            filters['student_id'] = student_id
        if class_id:
            filters['class_obj_id'] = class_id

        total = AttendanceRecord.objects.filter(**filters).count()
        present = AttendanceRecord.objects.filter(**filters, status='PRESENT').count()
        absent = AttendanceRecord.objects.filter(**filters, status='ABSENT').count()

        return json.dumps({
            'total_records': total,
            'present': present,
            'absent': absent,
            'rate': f"{round(present / total * 100, 1)}%" if total else 'N/A',
        })

    def _get_fee_status(self, student_id):
        from finance.models import FeePayment
        from django.db.models import Sum

        payments = FeePayment.objects.filter(
            student_id=student_id, school=self.school
        )
        agg = payments.aggregate(
            total_due=Sum('amount_due'),
            total_paid=Sum('amount_paid'),
        )
        pending = payments.filter(status__in=['PENDING', 'PARTIAL']).count()

        return json.dumps({
            'total_due': str(agg['total_due'] or 0),
            'total_paid': str(agg['total_paid'] or 0),
            'outstanding': str((agg['total_due'] or 0) - (agg['total_paid'] or 0)),
            'pending_months': pending,
        })

    def _draft_message(self, params):
        return json.dumps({
            'note': 'Use the LLM to draft the message based on the collected context',
            'type': params.get('type', 'general'),
            'recipient': params.get('recipient', 'parent'),
        })

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

            # First LLM call
            response = client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=messages,
                temperature=0.4,
                max_tokens=1000,
            )

            content = response.choices[0].message.content.strip()

            # Check for tool calls
            max_tool_rounds = 3
            for _ in range(max_tool_rounds):
                try:
                    # Try to parse as JSON tool call
                    if '```json' in content:
                        json_str = content.split('```json')[1].split('```')[0]
                    elif '```' in content:
                        json_str = content.split('```')[1].split('```')[0]
                    elif content.strip().startswith('{'):
                        json_str = content.strip()
                    else:
                        break  # Not a tool call, it's the final response

                    tool_call = json.loads(json_str)
                    if 'tool' not in tool_call:
                        break

                    # Execute tool
                    tool_result = self._execute_tool(
                        tool_call['tool'],
                        tool_call.get('params', {})
                    )

                    # Add to messages and call again
                    messages.append({"role": "assistant", "content": content})
                    messages.append({"role": "user", "content": f"Tool result: {tool_result}"})

                    response = client.chat.completions.create(
                        model=settings.GROQ_MODEL,
                        messages=messages,
                        temperature=0.4,
                        max_tokens=1000,
                    )
                    content = response.choices[0].message.content.strip()

                except (json.JSONDecodeError, IndexError, KeyError):
                    break  # Not a valid tool call

            return content

        except Exception as e:
            logger.error(f"Communication agent error: {e}")
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
