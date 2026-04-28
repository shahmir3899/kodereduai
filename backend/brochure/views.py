import io
import logging

from django.http import HttpResponse
from django.conf import settings
from django.core.mail import EmailMessage
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny

from core.permissions import IsSuperAdmin
from .models import BrochureSection
from .serializers import BrochureSectionSerializer, CareerApplicationSerializer
from .pdf_utils import render_brochure_html, build_preview_html

logger = logging.getLogger(__name__)


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
        recipient = settings.CAREERS_EMAIL_RECIPIENT
        if not recipient:
            logger.warning('CAREERS_EMAIL_RECIPIENT is not configured. Skipping email delivery.')
            return False

        subject = f"Career Application: {validated.get('role_applied', 'General')}"
        body = "\n".join([
            'New career application received from Education AI landing page.',
            '',
            f"Name: {validated.get('full_name', '-')}",
            f"Email: {validated.get('email', '-')}",
            f"Phone: {validated.get('phone', '-')}",
            f"Role Applied: {validated.get('role_applied', '-')}",
            '',
            'Cover Letter:',
            validated.get('cover_letter', '-') or '-',
        ])

        cv_file = validated.get('cv_file')
        email = EmailMessage(
            subject=subject,
            body=body,
            from_email=settings.CAREERS_EMAIL_SENDER,
            to=[recipient],
            reply_to=[validated.get('email')] if validated.get('email') else None,
        )

        if cv_file:
            email.attach(cv_file.name, cv_file.read(), getattr(cv_file, 'content_type', None))
            cv_file.seek(0)

        try:
            email.send(fail_silently=False)
            return True
        except Exception:
            logger.exception('Failed to send careers application email.')
            return False
