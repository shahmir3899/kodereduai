"""
/api/hr/teacher-performance/ — the teacher performance report (docs/TEACHER_PERFORMANCE_PLAN.md).

    GET  /                 admin, principal   ranked list for ?start=&end=
    GET  /{staff_id}/      admin, principal   one teacher, with the missed items
    GET  /my/              the teacher        own breakdown, own rank if the school allows it
    GET  /config/          admin, principal
    PUT  /config/          admin, principal
    GET  /explainer/       any staff          info-button content (with own quickest wins for a teacher)
    POST /export/          admin, principal   PDF or Excel of the ranked list ({start, end, format})

A request for one whole past month reads its frozen snapshot when there is one (snapshot: true).
"""

from datetime import date, timedelta

from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.mixins import ensure_tenant_school_id
from core.permissions import HasSchoolAccess, ModuleAccessMixin, get_effective_role
from core.roles import ADMIN_ROLES, STAFF_LEVEL_ROLES
from core.school_time import school_today

from .models import StaffMember, TeacherPerformanceConfig
from .performance.explain import build_explainer
from .performance.scoring import validate_bands, validate_weights
from .performance.service import compute, get_config
from .performance.snapshots import report_for

MAX_RANGE_DAYS = 366


class TeacherPerformanceConfigSerializer(serializers.ModelSerializer):
    attendance_cutoff_time = serializers.TimeField(format='%H:%M')

    class Meta:
        model = TeacherPerformanceConfig
        fields = [
            'weights', 'attendance_cutoff_time', 'marks_deadline_days', 'grading_deadline_days',
            'message_reply_hours', 'homework_per_week', 'papers_per_month', 'content_blocks_per_month',
            'bands', 'show_rank_to_teachers', 'enabled', 'updated_at',
        ]
        read_only_fields = ['updated_at']

    def validate_weights(self, value):
        error = validate_weights(value)
        if error:
            raise serializers.ValidationError(error)
        return {k: float(v) for k, v in value.items()}

    def validate_bands(self, value):
        error = validate_bands(value)
        if error:
            raise serializers.ValidationError(error)
        return value


def _parse_date(raw, name):
    try:
        return date.fromisoformat(raw)
    except (TypeError, ValueError):
        raise ValidationError({name: 'Use YYYY-MM-DD.'})


def _without_missed(result):
    return {
        **result,
        'measures': {k: {f: v for f, v in m.items() if f != 'missed'} for k, m in result['measures'].items()},
    }


class TeacherPerformanceViewSet(ModuleAccessMixin, viewsets.ViewSet):
    required_module = 'hr'
    permission_classes = [IsAuthenticated, HasSchoolAccess]
    lookup_value_regex = r'\d+'

    # ── helpers ──

    def _school_id(self):
        school_id = ensure_tenant_school_id(self.request)
        if not school_id:
            raise ValidationError({'detail': 'No school context found.'})
        return school_id

    def _require(self, roles):
        if get_effective_role(self.request) not in roles:
            raise PermissionDenied('You do not have access to the teacher performance report.')

    def _range(self, school_id):
        """?start=&end=, defaulting to this month so far on the school's calendar."""
        today = school_today(school_id)
        params = self.request.query_params
        start = _parse_date(params['start'], 'start') if params.get('start') else today.replace(day=1)
        end = _parse_date(params['end'], 'end') if params.get('end') else today
        if end < start:
            raise ValidationError({'end': 'The end date is before the start date.'})
        if (end - start).days + 1 > MAX_RANGE_DAYS:
            raise ValidationError({'end': f'Choose at most {MAX_RANGE_DAYS} days.'})
        return start, end

    def _own_staff_id(self, school_id):
        return (
            StaffMember.objects.filter(school_id=school_id, user=self.request.user)
            .values_list('id', flat=True).first()
        )

    # ── endpoints ──

    def list(self, request):
        school_id = self._school_id()
        self._require(ADMIN_ROLES)
        start, end = self._range(school_id)
        report = report_for(school_id, start, end)
        report['teachers'] = [_without_missed(r) for r in report['teachers']]
        return Response(report)

    def retrieve(self, request, pk=None):
        school_id = self._school_id()
        self._require(ADMIN_ROLES)
        start, end = self._range(school_id)
        report = report_for(school_id, start, end, staff_ids=[int(pk)])
        if not report['teachers']:
            return Response(
                {'detail': 'This staff member is not on the teacher performance report.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({**report, 'teacher': report.pop('teachers')[0]})

    @action(detail=False, methods=['get'])
    def my(self, request):
        school_id = self._school_id()
        cfg = get_config(school_id)
        if not cfg.enabled:
            return Response({'enabled': False})
        staff_id = self._own_staff_id(school_id)
        if not staff_id:
            return Response({'detail': 'You are not on the teacher performance report.'}, status=status.HTTP_404_NOT_FOUND)
        start, end = self._range(school_id)
        report = report_for(school_id, start, end, staff_ids=[staff_id], cfg=cfg)
        if not report['teachers']:
            return Response({'detail': 'You are not on the teacher performance report.'}, status=status.HTTP_404_NOT_FOUND)
        mine = report.pop('teachers')[0]
        if not cfg.show_rank_to_teachers:
            mine['rank'] = None
            report['out_of'] = None
        # Teachers see their own figures only; the school's settings beyond the rules are not theirs.
        report.pop('config', None)
        return Response({'enabled': True, **report, 'teacher': mine})

    @action(detail=False, methods=['post'])
    def export(self, request):
        from django.http import HttpResponse
        from schools.models import School

        from .performance.export import TeacherPerformanceReportGenerator

        school_id = self._school_id()
        self._require(ADMIN_ROLES)
        fmt = str(request.data.get('format', 'PDF')).upper()
        if fmt not in ('PDF', 'XLSX'):
            raise ValidationError({'format': 'Use PDF or XLSX.'})
        params = request.data
        start = _parse_date(params.get('start'), 'start') if params.get('start') else None
        end = _parse_date(params.get('end'), 'end') if params.get('end') else None
        if not start or not end:
            start, end = self._range(school_id)
        elif end < start or (end - start).days + 1 > MAX_RANGE_DAYS:
            raise ValidationError({'end': 'Choose an end date on or after the start, at most a year later.'})
        report = report_for(school_id, start, end)
        school = School.objects.get(id=school_id)
        content = TeacherPerformanceReportGenerator(school, {'report': report}).generate(format=fmt)
        ext, mime = (
            ('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            if fmt == 'XLSX' else ('pdf', 'application/pdf')
        )
        response = HttpResponse(content, content_type=mime)
        response['Content-Disposition'] = f'attachment; filename="teacher-performance-{start}-to-{end}.{ext}"'
        return response

    @action(detail=False, methods=['get', 'put'])
    def config(self, request):
        school_id = self._school_id()
        self._require(ADMIN_ROLES)
        cfg = get_config(school_id)
        if request.method == 'GET':
            return Response(TeacherPerformanceConfigSerializer(cfg).data)
        serializer = TeacherPerformanceConfigSerializer(cfg, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def explainer(self, request):
        school_id = self._school_id()
        self._require(ADMIN_ROLES + STAFF_LEVEL_ROLES)
        cfg = get_config(school_id)
        measures = None
        # A teacher's info button also lists their own quickest wins for this month.
        staff_id = self._own_staff_id(school_id)
        if staff_id and request.query_params.get('include_mine', '1') != '0':
            today = school_today(school_id)
            report = compute(school_id, today.replace(day=1), today, staff_ids=[staff_id], cfg=cfg)
            if report['teachers']:
                measures = report['teachers'][0]['measures']
        return Response(build_explainer(cfg, measures))
