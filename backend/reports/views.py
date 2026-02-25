"""
Report generation views.
"""

import json
import logging
import re

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import action
from django.http import HttpResponse
from django.shortcuts import get_object_or_404

from rest_framework import permissions as drf_permissions

from core.permissions import IsSchoolAdmin, HasSchoolAccess, ADMIN_ROLES, get_effective_role
from core.mixins import ensure_tenant_school_id
from .serializers import (
    GenerateReportSerializer, CustomLetterSerializer,
    GenerateLetterPDFSerializer, TemplatePrefillSerializer,
)
from .models import GeneratedReport, CustomLetter

logger = logging.getLogger(__name__)


class IsSchoolAdminOrHR(drf_permissions.BasePermission):
    """Allows ADMIN_ROLES + HR_MANAGER to access letter composer."""
    message = "Only School Admins, Principals, or HR Managers can perform this action."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        role = get_effective_role(request)
        return role in ADMIN_ROLES or role == 'HR_MANAGER'


GENERATOR_MAP = {
    'ATTENDANCE_DAILY': 'reports.generators.attendance.DailyAttendanceReportGenerator',
    'ATTENDANCE_MONTHLY': 'reports.generators.attendance.MonthlyAttendanceReportGenerator',
    'FEE_COLLECTION': 'reports.generators.fee.FeeCollectionReportGenerator',
    'FEE_DEFAULTERS': 'reports.generators.fee.FeeDefaultersReportGenerator',
    'CLASS_RESULT': 'reports.generators.academic.ClassResultReportGenerator',
    'STUDENT_PROGRESS': 'reports.generators.academic.StudentProgressReportGenerator',
    'STUDENT_COMPREHENSIVE': 'reports.generators.student.StudentComprehensiveReportGenerator',
}


def _get_generator_class(report_type):
    path = GENERATOR_MAP.get(report_type)
    if not path:
        return None
    module_path, class_name = path.rsplit('.', 1)
    import importlib
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


class GenerateReportView(APIView):
    """Generate a report as a background task."""
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def post(self, request):
        serializer = GenerateReportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        generator_class = _get_generator_class(data['report_type'])
        if not generator_class:
            return Response({'error': f"Unknown report type: {data['report_type']}"}, status=400)

        from core.models import BackgroundTask
        from .tasks import generate_report_task

        fmt = data.get('format', 'PDF')
        report_label = data['report_type'].replace('_', ' ').title()
        title = f"Generating {report_label} ({fmt})"

        task_kwargs = {
            'school_id': school_id,
            'user_id': request.user.id,
            'report_type': data['report_type'],
            'format': fmt,
            'parameters': data.get('parameters', {}),
        }

        if fmt == 'XLSX':
            # XLSX generation is fast — run synchronously
            from core.task_utils import run_task_sync
            try:
                bg_task = run_task_sync(
                    generate_report_task, BackgroundTask.TaskType.REPORT_GENERATION,
                    title, school_id, request.user,
                    task_kwargs=task_kwargs, progress_total=3,
                )
            except Exception as e:
                return Response({'detail': str(e)}, status=500)
            return Response({
                'task_id': bg_task.celery_task_id,
                'message': bg_task.result_data.get('message', f'{report_label} report generated.') if bg_task.result_data else f'{report_label} report generated.',
                'result': bg_task.result_data,
            })
        else:
            # PDF generation is slow — use async
            from core.task_utils import dispatch_background_task
            bg_task = dispatch_background_task(
                celery_task_func=generate_report_task,
                task_type=BackgroundTask.TaskType.REPORT_GENERATION,
                title=title, school_id=school_id, user=request.user,
                task_kwargs=task_kwargs, progress_total=3,
            )
            return Response({
                'task_id': bg_task.celery_task_id,
                'message': f'{report_label} report generation started.',
            }, status=202)


class ReportDownloadView(APIView):
    """Download a previously generated report by ID."""
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request, report_id):
        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        try:
            report = GeneratedReport.objects.get(id=report_id, school_id=school_id)
        except GeneratedReport.DoesNotExist:
            return Response({'error': 'Report not found'}, status=404)

        if not report.file_content:
            return Response({'error': 'Report content not available'}, status=404)

        content = bytes(report.file_content)

        if report.format == 'XLSX':
            content_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            ext = 'xlsx'
        else:
            content_type = 'application/pdf'
            ext = 'pdf'

        response = HttpResponse(content, content_type=content_type)
        response['Content-Disposition'] = f'attachment; filename="report_{report.id}.{ext}"'
        return response


class ReportListView(APIView):
    """List previously generated reports."""
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request):
        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        from .serializers import GeneratedReportSerializer
        reports = GeneratedReport.objects.filter(
            school_id=school_id
        ).order_by('-created_at')[:50]

        return Response(GeneratedReportSerializer(reports, many=True).data)


# ============================================
# LETTER TEMPLATES
# ============================================

LETTER_TEMPLATES = {
    'experience': {
        'name': 'Experience Certificate',
        'default_subject': 'Experience Certificate - {employee_name}',
        'default_body': (
            'To Whom It May Concern,\n\n'
            'This is to certify that *{employee_name}* has been employed at '
            '{school_name} as *{designation}* in the *{department}* department '
            'from *{date_of_joining}* to present.\n\n'
            'During the tenure, {employee_name} has demonstrated excellent '
            'professional skills and dedication towards assigned responsibilities.\n\n'
            'We wish {employee_name} all the best in future endeavors.'
        ),
    },
    'termination': {
        'name': 'Termination Letter',
        'default_subject': 'Termination of Employment - {employee_name}',
        'default_body': (
            'Dear {employee_name},\n\n'
            'Employee ID: {employee_id}\n'
            'Department: {department}\n'
            'Designation: {designation}\n\n'
            'We regret to inform you that your employment with {school_name} '
            'is being terminated effective from [DATE].\n\n'
            'Please ensure all school property, documents, and access cards '
            'are returned before your last working day.\n\n'
            'Your final settlement including any pending dues will be processed '
            'as per the school policy.'
        ),
    },
    'warning': {
        'name': 'Warning Letter',
        'default_subject': 'Warning Letter - {employee_name}',
        'default_body': (
            'Dear {employee_name},\n\n'
            'Employee ID: {employee_id}\n'
            'Department: {department}\n\n'
            'This letter serves as a formal warning regarding [REASON].\n\n'
            'We expect immediate improvement in your conduct/performance. '
            'Failure to comply may result in further disciplinary action.\n\n'
            'Please acknowledge receipt of this letter by signing below.'
        ),
    },
    'appreciation': {
        'name': 'Appreciation Letter',
        'default_subject': 'Letter of Appreciation - {employee_name}',
        'default_body': (
            'Dear {employee_name},\n\n'
            'We are pleased to recognize your outstanding contribution to '
            '{school_name} as *{designation}* in the *{department}* department.\n\n'
            'Your dedication, professionalism, and commitment to excellence '
            'have been exemplary and have positively impacted our institution.\n\n'
            'We appreciate your hard work and look forward to your continued '
            'success with us.'
        ),
    },
    'leave_approval': {
        'name': 'Leave Approval',
        'default_subject': 'Leave Approval - {employee_name}',
        'default_body': (
            'Dear {employee_name},\n\n'
            'Employee ID: {employee_id}\n'
            'Department: {department}\n\n'
            'Your leave application for the period [START DATE] to [END DATE] '
            'has been approved.\n\n'
            'Please ensure that all pending tasks are delegated to the '
            'appropriate colleagues before your leave commences.\n\n'
            'We look forward to welcoming you back.'
        ),
    },
    'salary_increment': {
        'name': 'Salary Increment',
        'default_subject': 'Salary Increment - {employee_name}',
        'default_body': (
            'Dear {employee_name},\n\n'
            'Employee ID: {employee_id}\n'
            'Department: {department}\n'
            'Designation: {designation}\n\n'
            'We are pleased to inform you that your salary has been revised '
            'effective from [DATE].\n\n'
            'Previous Salary: [AMOUNT]\n'
            'Revised Salary: [AMOUNT]\n\n'
            'This increment is in recognition of your valuable contribution '
            'to {school_name}. We look forward to your continued dedication.'
        ),
    },
    'transfer': {
        'name': 'Transfer Letter',
        'default_subject': 'Transfer Letter - {employee_name}',
        'default_body': (
            'Dear {employee_name},\n\n'
            'Employee ID: {employee_id}\n'
            'Current Department: {department}\n'
            'Current Designation: {designation}\n\n'
            'You are hereby being transferred from *{department}* to '
            '*[NEW DEPARTMENT]* effective from [DATE].\n\n'
            'Your new designation will be *[NEW DESIGNATION]*. Please report '
            'to [NEW SUPERVISOR] on the effective date.\n\n'
            'All other terms and conditions of your employment remain unchanged.'
        ),
    },
}


def _prefill_template_text(text, employee, school):
    """Replace {placeholders} in text with actual employee/school data."""
    replacements = {
        'employee_name': employee.full_name,
        'employee_id': employee.employee_id or '',
        'first_name': employee.first_name,
        'last_name': employee.last_name,
        'email': employee.email or '',
        'phone': employee.phone or '',
        'designation': employee.designation.name if employee.designation else '',
        'department': employee.department.name if employee.department else '',
        'date_of_joining': employee.date_of_joining.strftime('%B %d, %Y') if employee.date_of_joining else '',
        'school_name': school.name,
    }
    result = text
    for key, value in replacements.items():
        result = result.replace('{' + key + '}', str(value))
    return result


# ============================================
# CUSTOM LETTER VIEWS
# ============================================

class CustomLetterListCreateView(APIView):
    """List and create custom letters."""
    permission_classes = [IsAuthenticated, IsSchoolAdminOrHR, HasSchoolAccess]

    def get(self, request):
        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        qs = CustomLetter.objects.filter(school_id=school_id)

        # Optional filters
        template_type = request.query_params.get('template_type')
        if template_type:
            qs = qs.filter(template_type=template_type)

        limit = request.query_params.get('limit')
        if limit:
            try:
                qs = qs[:int(limit)]
            except (ValueError, TypeError):
                pass
        else:
            qs = qs[:50]

        return Response(CustomLetterSerializer(qs, many=True).data)

    def post(self, request):
        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        serializer = CustomLetterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(school_id=school_id, created_by=request.user)
        return Response(serializer.data, status=201)


class CustomLetterDetailView(APIView):
    """Retrieve, update, delete a custom letter."""
    permission_classes = [IsAuthenticated, IsSchoolAdminOrHR, HasSchoolAccess]

    def _get_letter(self, request, pk):
        school_id = ensure_tenant_school_id(request)
        return get_object_or_404(CustomLetter, pk=pk, school_id=school_id)

    def get(self, request, pk):
        letter = self._get_letter(request, pk)
        return Response(CustomLetterSerializer(letter).data)

    def put(self, request, pk):
        letter = self._get_letter(request, pk)
        serializer = CustomLetterSerializer(letter, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, pk):
        letter = self._get_letter(request, pk)
        letter.delete()
        return Response(status=204)


class LetterTemplatesView(APIView):
    """Return available letter templates."""
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request):
        return Response(LETTER_TEMPLATES)


class LetterPrefillView(APIView):
    """Prefill template placeholders with employee data."""
    permission_classes = [IsAuthenticated, IsSchoolAdminOrHR, HasSchoolAccess]

    def post(self, request):
        serializer = TemplatePrefillSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        from hr.models import StaffMember
        from schools.models import School

        try:
            employee = StaffMember.objects.select_related(
                'department', 'designation'
            ).get(id=serializer.validated_data['employee_id'], school_id=school_id)
        except StaffMember.DoesNotExist:
            return Response({'error': 'Employee not found'}, status=404)

        school = School.objects.get(id=school_id)
        template_body = serializer.validated_data['template_body']

        prefilled = _prefill_template_text(template_body, employee, school)

        # Find remaining unfilled placeholders
        remaining = re.findall(r'\{(\w+)\}', prefilled)

        return Response({
            'prefilled_body': prefilled,
            'auto_filled': template_body != prefilled,
            'remaining_placeholders': remaining,
        })


class GenerateLetterPDFView(APIView):
    """Generate a letter PDF synchronously and return as download."""
    permission_classes = [IsAuthenticated, IsSchoolAdminOrHR, HasSchoolAccess]

    def post(self, request):
        serializer = GenerateLetterPDFSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        from schools.models import School
        school = School.objects.get(id=school_id)

        # Resolve letter data — from saved letter or inline
        if data.get('letter_id'):
            try:
                letter = CustomLetter.objects.get(id=data['letter_id'], school_id=school_id)
            except CustomLetter.DoesNotExist:
                return Response({'error': 'Letter not found'}, status=404)
            recipient = letter.recipient
            subject = letter.subject
            body_text = letter.body_text
            line_spacing = letter.line_spacing
        else:
            recipient = data['recipient']
            subject = data['subject']
            body_text = data['body_text']
            line_spacing = data.get('line_spacing', 'single')

        admin_name = request.user.get_full_name() or request.user.username

        from .generators.letter import LetterPDFGenerator
        generator = LetterPDFGenerator(
            school=school,
            recipient=recipient,
            subject=subject,
            body_text=body_text,
            line_spacing=line_spacing,
            admin_name=admin_name,
        )

        try:
            pdf_bytes = generator.generate()
        except Exception as e:
            logger.exception("Letter PDF generation failed: %s", e)
            return Response({'error': f'PDF generation failed: {e}'}, status=500)

        safe_subject = re.sub(r'[^\w\s-]', '', subject).strip().replace(' ', '_')[:50]
        filename = f"Letter_{safe_subject}.pdf"

        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response


# ============================================
# AI LETTER DRAFTING
# ============================================

LETTER_DRAFT_SYSTEM_PROMPT = """You are a professional letter drafting assistant for {school_name}, an educational institution.

Your task is to generate formal, professional letter content based on the user's description.

AVAILABLE LETTER TYPES: experience certificate, termination letter, warning letter, appreciation letter, leave approval, salary increment, transfer letter, or custom/general letters.

{template_context}
{employee_context}

FORMATTING RULES:
- Use *text* for bold emphasis (not ** or HTML tags)
- Use _text_ for italic emphasis
- Use proper paragraphs separated by blank lines
- Address letters formally ("Dear [Name]," or "To Whom It May Concern,")
- End with professional closing
- Use [BRACKETED PLACEHOLDERS] for any information you don't have (e.g., [DATE], [AMOUNT])
- Keep tone professional, respectful, and appropriate for a school/educational institution
- Letters should be concise but complete (typically 150-300 words for the body)

You MUST respond with ONLY a JSON object in this exact format:
{{"subject": "The letter subject line", "body_text": "The full letter body text"}}

Do NOT include any explanation, preamble, or markdown code blocks. Just the raw JSON object."""


class LetterAIDraftView(APIView):
    """AI-powered letter content generation."""
    permission_classes = [IsAuthenticated, IsSchoolAdminOrHR, HasSchoolAccess]

    def post(self, request):
        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        prompt = request.data.get('prompt', '').strip()
        if not prompt:
            return Response({'error': 'prompt is required'}, status=400)
        if len(prompt) > 1000:
            return Response({'error': 'prompt too long (max 1000 characters)'}, status=400)

        template_type = request.data.get('template_type', '')
        employee_context = request.data.get('employee_context', None)

        from schools.models import School
        school = School.objects.get(id=school_id)

        system_prompt = self._build_system_prompt(school.name, template_type, employee_context)

        try:
            result = self._generate_with_llm(system_prompt, prompt)
            return Response(result)
        except Exception as e:
            logger.exception("Letter AI draft failed: %s", e)
            # Fall back to template-based response
            result = self._fallback_response(prompt)
            return Response(result)

    def _build_system_prompt(self, school_name, template_type, employee_context):
        template_ctx = ''
        if template_type:
            template = LETTER_TEMPLATES.get(template_type)
            if template:
                template_ctx = (
                    f"The user wants to create a {template['name']}. "
                    f"Reference structure:\n"
                    f"Subject format: {template['default_subject']}\n"
                    f"Body structure: {template['default_body']}\n"
                    f"Use this as guidance but adapt based on the user's specific request. "
                    f"Replace all {{placeholders}} with appropriate content or [PLACEHOLDER] notation."
                )

        emp_ctx = ''
        if employee_context and isinstance(employee_context, dict):
            parts = []
            if employee_context.get('name'):
                parts.append(f"Name: {employee_context['name']}")
            if employee_context.get('employee_id'):
                parts.append(f"Employee ID: {employee_context['employee_id']}")
            if employee_context.get('department'):
                parts.append(f"Department: {employee_context['department']}")
            if employee_context.get('designation'):
                parts.append(f"Designation: {employee_context['designation']}")
            if employee_context.get('date_of_joining'):
                parts.append(f"Date of Joining: {employee_context['date_of_joining']}")
            if parts:
                emp_ctx = "Employee details to use in the letter:\n" + "\n".join(parts)

        return LETTER_DRAFT_SYSTEM_PROMPT.format(
            school_name=school_name,
            template_context=template_ctx,
            employee_context=emp_ctx,
        )

    def _generate_with_llm(self, system_prompt, user_prompt):
        from django.conf import settings

        if not settings.GROQ_API_KEY:
            raise ValueError("GROQ_API_KEY not configured")

        from groq import Groq
        client = Groq(api_key=settings.GROQ_API_KEY)

        response = client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.4,
            max_tokens=1500,
        )

        content = response.choices[0].message.content.strip()

        # Parse JSON — handle markdown code blocks
        if '```json' in content:
            content = content.split('```json')[1].split('```')[0]
        elif '```' in content:
            content = content.split('```')[1].split('```')[0]

        result = json.loads(content.strip())

        if 'subject' not in result or 'body_text' not in result:
            raise ValueError("LLM response missing required fields")

        return {
            'subject': result['subject'],
            'body_text': result['body_text'],
        }

    def _fallback_response(self, prompt):
        """Template-based fallback when LLM is unavailable."""
        prompt_lower = prompt.lower()

        for key, template in LETTER_TEMPLATES.items():
            if key.replace('_', ' ') in prompt_lower or template['name'].lower() in prompt_lower:
                return {
                    'subject': template['default_subject'],
                    'body_text': template['default_body'],
                    'fallback': True,
                }

        return {
            'subject': 'Official Letter',
            'body_text': (
                'Dear [Recipient],\n\n'
                '[Please write your letter content here based on your requirements.]\n\n'
                'Regards,\n[Your Name]'
            ),
            'fallback': True,
        }
