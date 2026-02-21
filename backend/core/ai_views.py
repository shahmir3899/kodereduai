"""
AI-powered views for cross-module insights.
"""

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.utils import timezone

from core.mixins import ensure_tenant_school_id


class AIInsightsView(APIView):
    """
    Returns AI-generated insights across attendance, finance, academics, and HR.
    GET /api/tasks/ai-insights/
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        school_id = request.query_params.get('school_id') or ensure_tenant_school_id(request) or request.user.school_id
        if not school_id:
            return Response({'error': 'school_id is required'}, status=400)

        try:
            from schools.models import School
            school = School.objects.get(id=school_id)
        except Exception:
            return Response({'error': 'School not found'}, status=404)

        from .ai_insights_service import AIInsightsService
        service = AIInsightsService(school)
        insights = service.generate_insights(max_results=10)

        return Response({
            'insights': insights,
            'generated_at': timezone.now().isoformat(),
            'school_name': school.name,
        })
