import io
import logging

from django.http import HttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsSuperAdmin
from .models import BrochureSection
from .serializers import BrochureSectionSerializer
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
