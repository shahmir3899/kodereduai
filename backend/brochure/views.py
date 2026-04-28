import io
import logging

from django.http import HttpResponse
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny

from core.permissions import IsSuperAdmin
from .models import BrochureSection
from .serializers import (
    BrochureSectionSerializer,
    CareerApplicationSerializer,
    DemoRequestSerializer,
    ContactEnquirySerializer,
)
from .pdf_utils import render_brochure_html, build_preview_html

logger = logging.getLogger(__name__)


def send_landing_form_email(*, subject, template_name, context, reply_to=None, attachments=None):
    recipient = settings.LANDING_FORMS_EMAIL_RECIPIENT
    if not recipient:
        logger.warning('LANDING_FORMS_EMAIL_RECIPIENT is not configured. Skipping form email delivery.')
        return False

    html_body = render_to_string(template_name, context)
    text_body = strip_tags(html_body)

    email = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=settings.LANDING_FORMS_EMAIL_SENDER,
        to=[recipient],
        reply_to=reply_to or None,
    )
    email.attach_alternative(html_body, 'text/html')

    for attachment in attachments or []:
        email.attach(*attachment)

    try:
        email.send(fail_silently=False)
        return True
    except Exception:
        logger.exception('Failed to send landing form email for subject %s.', subject)
        return False


class BrochureSectionViewSet(viewsets.ModelViewSet):
    """
    CRUD for brochure sections. Super-admins only.
    Create/destroy are disabled — sections are seeded via migration.
    """
    queryset = BrochureSection.objects.all()
    serializer_class = BrochureSectionSerializer
    permission_classes = [IsAuthenticated, IsSuperAdmin]
    http_method_names = ['get', 'patch', 'post', 'head', 'options']

    def create(self, request, *args, **kwargs):
        return Response(
            {'detail': 'Sections are managed via data migrations.'},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['post'], url_path='reorder')
    def reorder(self, request):
        """Accepts [{id: 1, order: 0}, ...] and updates ordering."""
        items = request.data.get('items', [])
        for item in items:
            BrochureSection.objects.filter(pk=item['id']).update(order=item['order'])
        return Response({'status': 'ok'})


class BrochurePreviewView(APIView):
    """Returns assembled HTML preview of all visible sections."""
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def get(self, request):
        sections = BrochureSection.objects.filter(is_visible=True)
        html = build_preview_html(sections)
        return Response({'html': html})


class BrochureDownloadPdfView(APIView):
    """Streams a PDF generated from the brochure HTML via WeasyPrint."""
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def get(self, request):
        try:
            from weasyprint import HTML, CSS
        except ImportError:
            return Response(
                {'detail': 'WeasyPrint is not installed on this server.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        sections = BrochureSection.objects.filter(is_visible=True)
        full_html = render_brochure_html(sections)

        pdf_bytes = HTML(string=full_html).write_pdf()
        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = 'attachment; filename="KoderEduAI_Brochure.pdf"'
        return response


class PublicCareerApplicationCreateView(APIView):
    """Public endpoint to submit careers applications from the landing site."""
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        serializer = CareerApplicationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        validated = serializer.validated_data
        saved_instance = None

        if settings.CAREERS_SAVE_TO_DB:
            saved_instance = serializer.save(
                ip_address=self._client_ip(request),
                user_agent=request.META.get('HTTP_USER_AGENT', '')[:255],
            )

        email_sent = self._send_application_email(validated)

        if not settings.CAREERS_SAVE_TO_DB and not email_sent:
            return Response(
                {'detail': 'Submission received but no delivery path is configured.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response(
            {
                'message': 'Application submitted successfully.',
                'application_id': saved_instance.id if saved_instance else None,
                'email_sent': email_sent,
            },
            status=status.HTTP_201_CREATED,
        )

    def _client_ip(self, request):
        forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
        if forwarded:
            return forwarded.split(',')[0].strip()
        return request.META.get('REMOTE_ADDR')

    def _send_application_email(self, validated):
        cv_file = validated.get('cv_file')
        attachments = []
        if cv_file:
            attachments.append((cv_file.name, cv_file.read(), getattr(cv_file, 'content_type', None)))
            cv_file.seek(0)

        return send_landing_form_email(
            subject='Education AI - Form Career Application',
            template_name='brochure/emails/career_application.html',
            context={
                'title': 'Education AI - Form Career Application',
                'accent_color': '#7c3aed',
                'accent_soft': '#f3e8ff',
                'name': validated.get('full_name', '-') or '-',
                'email': validated.get('email', '-') or '-',
                'phone': validated.get('phone', '-') or '-',
                'role_applied': validated.get('role_applied', '-') or '-',
                'cover_letter': validated.get('cover_letter', '-') or '-',
                'has_cv': bool(cv_file),
            },
            reply_to=[validated.get('email')] if validated.get('email') else None,
            attachments=attachments,
        )


class PublicDemoRequestCreateView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = DemoRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        validated = serializer.validated_data
        email_sent = send_landing_form_email(
            subject='Education AI - Form Demo Request',
            template_name='brochure/emails/demo_request.html',
            context={
                'title': 'Education AI - Form Demo Request',
                'accent_color': '#2563eb',
                'accent_soft': '#dbeafe',
                'name': validated.get('name', '-') or '-',
                'school': validated.get('school', '-') or '-',
                'email': validated.get('email', '-') or '-',
                'preferred_date': validated.get('preferred_date') or '-',
            },
            reply_to=[validated.get('email')] if validated.get('email') else None,
        )

        if not email_sent:
            return Response(
                {'detail': 'Submission received but email delivery is not configured.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response(
            {'message': 'Demo request submitted successfully.', 'email_sent': True},
            status=status.HTTP_201_CREATED,
        )


class PublicContactEnquiryCreateView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ContactEnquirySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        validated = serializer.validated_data
        email_sent = send_landing_form_email(
            subject='Education AI - Form Contact Enquiry',
            template_name='brochure/emails/contact_enquiry.html',
            context={
                'title': 'Education AI - Form Contact Enquiry',
                'accent_color': '#0f766e',
                'accent_soft': '#ccfbf1',
                'name': validated.get('name', '-') or '-',
                'school': validated.get('school', '-') or '-',
                'email': validated.get('email', '-') or '-',
                'phone': validated.get('phone', '-') or '-',
                'message': validated.get('message', '-') or '-',
            },
            reply_to=[validated.get('email')] if validated.get('email') else None,
        )

        if not email_sent:
            return Response(
                {'detail': 'Submission received but email delivery is not configured.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response(
            {'message': 'Contact enquiry submitted successfully.', 'email_sent': True},
            status=status.HTTP_201_CREATED,
        )
