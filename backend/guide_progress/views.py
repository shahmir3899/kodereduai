import csv
from datetime import timedelta

from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status as http
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.mixins import ensure_tenant_school_id
from core.permissions import HasSchoolAccess, IsSchoolAdmin, get_effective_role
from schools.models import School, UserSchoolMembership

from . import catalog, rules
from .models import GuideProgress

INACTIVE_AFTER = timedelta(days=7)
MAX_SYNC_ITEMS = 300
SELF_ACTIONS = {'video', 'step', 'mine', 'sync'}


def _school_id(request):
    sid = ensure_tenant_school_id(request)
    if not sid:
        raise ValidationError({'detail': 'X-School-ID header is required.'})
    return sid


def _num(value, default=0.0, high=None):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if number != number or number < 0:
        return default
    return min(number, high) if high is not None else number


def _apply_video(row, ranges, duration, position, language, now):
    """Union new ranges into the stored ones. Progress only ever moves forward."""
    duration = max(_num(duration, high=rules.MAX_DURATION), row.duration or 0)
    merged = rules.merge_ranges((row.ranges or []) + rules.clean_ranges(ranges, duration))
    row.ranges = merged
    row.duration = duration
    row.seconds_played = rules.ranges_total(merged)
    row.last_position = _num(position, row.last_position, high=duration or None)
    if language in ('en', 'ur'):
        row.language = language
    row.last_activity = now
    # Completion is recomputed here, never taken from the client, and is never undone.
    if row.completed_at is None and rules.is_complete(merged, duration):
        row.completed_at = now
    return row


def _video_row(user, school_id, video_id, now):
    row, _ = GuideProgress.objects.get_or_create(
        school_id=school_id, user=user, kind=GuideProgress.Kind.VIDEO, key=video_id,
        defaults={'last_activity': now},
    )
    return row


def _serialize_mine(rows):
    videos, steps = {}, {}
    for r in rows:
        if r.kind == GuideProgress.Kind.VIDEO:
            videos[r.key] = {
                'ranges': r.ranges, 'duration': r.duration, 'position': r.last_position,
                'language': r.language, 'completedAt': r.completed_at,
            }
        else:
            steps[r.key] = r.completed_at
    return {'videos': videos, 'steps': steps}


class GuideProgressViewSet(viewsets.GenericViewSet):
    """Per-user guide progress. The user always comes from the token, never the payload."""

    permission_classes = [IsAuthenticated, HasSchoolAccess]
    allow_portal_roles = SELF_ACTIONS  # parents and students watch the guide too; the admin views stay closed to them
    pagination_class = None
    queryset = GuideProgress.objects.none()

    def get_permissions(self):
        if self.action in SELF_ACTIONS:
            return super().get_permissions()
        return [IsAuthenticated(), HasSchoolAccess(), IsSchoolAdmin()]

    # ----- own progress -------------------------------------------------

    @action(detail=False, methods=['get'])
    def mine(self, request):
        rows = GuideProgress.objects.filter(school_id=_school_id(request), user=request.user)
        return Response(_serialize_mine(rows))

    @action(detail=False, methods=['post'])
    def video(self, request):
        school_id = _school_id(request)
        video_id = request.data.get('id')
        if video_id not in catalog.video_ids():
            raise ValidationError({'id': 'Unknown video.'})
        now = timezone.now()
        row = _apply_video(
            _video_row(request.user, school_id, video_id, now),
            request.data.get('ranges'), request.data.get('duration'),
            request.data.get('position'), request.data.get('language'), now,
        )
        row.save()
        return Response(_serialize_mine([row])['videos'][video_id])

    @action(detail=False, methods=['post'])
    def step(self, request):
        school_id = _school_id(request)
        step_id = request.data.get('id')
        if step_id not in catalog.step_ids():
            raise ValidationError({'id': 'Unknown step.'})
        if catalog.video_for_section(step_id):
            raise ValidationError({'id': 'This step is completed by watching its video.'})
        lookup = dict(school_id=school_id, user=request.user, kind=GuideProgress.Kind.STEP, key=step_id)
        if request.data.get('done') is False:
            GuideProgress.objects.filter(**lookup).delete()
            return Response({'id': step_id, 'done': False})
        now = timezone.now()
        row, _ = GuideProgress.objects.get_or_create(**lookup, defaults={'last_activity': now, 'completed_at': now})
        return Response({'id': step_id, 'done': True})

    @action(detail=False, methods=['post'])
    def sync(self, request):
        """One-time upload of what this browser stored before progress lived on the server."""
        school_id = _school_id(request)
        videos = request.data.get('videos') or {}
        steps = request.data.get('steps') or {}
        if not isinstance(videos, dict) or not isinstance(steps, dict):
            raise ValidationError({'detail': 'videos and steps must be objects.'})
        if len(videos) + len(steps) > MAX_SYNC_ITEMS:
            raise ValidationError({'detail': 'Too many items.'})

        now = timezone.now()
        known_videos, known_steps = catalog.video_ids(), catalog.step_ids()
        for video_id, state in videos.items():
            if video_id not in known_videos or not isinstance(state, dict):
                continue
            row = _apply_video(
                _video_row(request.user, school_id, video_id, now),
                state.get('ranges'), state.get('duration'), state.get('position'), state.get('language'), now,
            )
            row.save()
        for step_id in steps:
            if step_id in known_steps and not catalog.video_for_section(step_id):
                GuideProgress.objects.get_or_create(
                    school_id=school_id, user=request.user, kind=GuideProgress.Kind.STEP, key=step_id,
                    defaults={'last_activity': now, 'completed_at': now},
                )
        rows = GuideProgress.objects.filter(school_id=school_id, user=request.user)
        return Response(_serialize_mine(rows), status=http.HTTP_200_OK)

    # ----- admin overview -----------------------------------------------

    @action(detail=False, methods=['get'])
    def overview(self, request):
        school_id = _school_id(request)
        people = self._people(request, school_id)
        page = self._paginate(request, people['rows'])
        return Response({
            'summary': people['summary'],
            'no_account': people['no_account'],
            'filters': people['filters'],
            **page,
        })

    @action(detail=False, methods=['get'], url_path='overview/export')
    def export(self, request):
        school_id = _school_id(request)
        rows = self._people(request, school_id)['rows']
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="guide-progress.csv"'
        writer = csv.writer(response)
        writer.writerow(['Name', 'Username', 'Role', 'Class / department', 'Steps done', 'Steps total',
                         'Videos watched', 'Percent', 'Status', 'Last activity'])
        for r in rows:
            writer.writerow([_safe_cell(r['name']), _safe_cell(r['username']), r['role'], _safe_cell(r['group']),
                             r['steps_done'], r['steps_total'], r['videos_watched'], r['percent'],
                             r['status'], r['last_activity'] or ''])
        return response

    @action(detail=False, methods=['get'], url_path=r'user/(?P<user_id>\d+)')
    def user_detail(self, request, user_id=None):
        school_id = _school_id(request)
        member = UserSchoolMembership.objects.filter(
            school_id=school_id, user_id=user_id, is_active=True,
        ).select_related('user').first()
        if not member:
            return Response({'detail': 'Not found.'}, status=http.HTTP_404_NOT_FOUND)
        rows = {(r.kind, r.key): r for r in GuideProgress.objects.filter(school_id=school_id, user_id=user_id)}
        school = School.objects.get(pk=school_id)
        steps = []
        for section_id, video_id in catalog.step_requirements(member.role, school.enabled_modules or {}):
            row = rows.get(('video', video_id)) if video_id else rows.get(('step', section_id))
            steps.append({
                'section': section_id, 'video': video_id, 'done': bool(row and row.completed_at),
                'percent': rules.percent_played(row.ranges, row.duration) if row and video_id else None,
                'last_activity': row.last_activity if row else None,
            })
        return Response({'user_id': int(user_id), 'name': _display_name(member.user), 'role': member.role, 'steps': steps})

    # ----- helpers ------------------------------------------------------

    def _paginate(self, request, rows):
        size = int(_num(request.query_params.get('page_size'), 20, high=200)) or 20
        page = max(1, int(_num(request.query_params.get('page'), 1)))
        start = (page - 1) * size
        return {
            'count': len(rows),
            'page': page,
            'page_size': size,
            'results': rows[start:start + size],
        }

    def _people(self, request, school_id):
        from hr.models import StaffMember
        from students.models import Student, StudentProfile

        params = request.query_params
        school = School.objects.get(pk=school_id)
        enabled = school.enabled_modules or {}
        members = list(
            UserSchoolMembership.objects.filter(school_id=school_id, is_active=True, user__is_active=True)
            .select_related('user')
        )
        user_ids = [m.user_id for m in members]

        progress = {}
        for uid, kind, key, completed_at, last_activity in GuideProgress.objects.filter(
            school_id=school_id, user_id__in=user_ids,
        ).values_list('user_id', 'kind', 'key', 'completed_at', 'last_activity'):
            progress.setdefault(uid, {})[(kind, key)] = (completed_at, last_activity)

        classes = {
            p.user_id: str(p.student.class_obj)
            for p in StudentProfile.objects.filter(school_id=school_id, user_id__in=user_ids)
            .select_related('student__class_obj')
        }
        departments = {
            s.user_id: (s.department.name if s.department_id else '')
            for s in StaffMember.objects.filter(school_id=school_id, user_id__in=user_ids)
            .select_related('department')
        }

        now = timezone.now()
        rows = []
        for m in members:
            if m.user.is_super_admin:
                continue
            reqs = catalog.step_requirements(m.role, enabled)
            mine = progress.get(m.user_id, {})
            done = 0
            for section_id, video_id in reqs:
                key = ('video', video_id) if video_id else ('step', section_id)
                if mine.get(key, (None, None))[0]:
                    done += 1
            watched = sum(1 for (kind, _), (completed, _) in mine.items() if kind == 'video' and completed)
            last = max((v[1] for v in mine.values()), default=None)
            total = len(reqs)
            if not mine:
                state = 'not_started'
            elif total and done >= total:
                state = 'completed'
            elif last and now - last > INACTIVE_AFTER:
                state = 'inactive'
            else:
                state = 'in_progress'
            rows.append({
                'user_id': m.user_id,
                'name': _display_name(m.user),
                'username': m.user.username,
                'role': m.role,
                'group': classes.get(m.user_id) or departments.get(m.user_id) or '',
                'steps_done': done, 'steps_total': total, 'videos_watched': watched,
                'percent': round(done / total * 100) if total else 0,
                'status': state,
                'last_activity': last,
            })

        summary = {
            'tracked': len(rows),
            'completed': sum(r['status'] == 'completed' for r in rows),
            'in_progress': sum(r['status'] == 'in_progress' for r in rows),
            'not_started': sum(r['status'] == 'not_started' for r in rows),
            'inactive': sum(r['status'] == 'inactive' for r in rows),
        }

        groups = sorted({r['group'] for r in rows if r['group']})
        rows = self._filter(rows, params)
        return {
            'rows': rows,
            'summary': summary,
            'filters': {'groups': groups, 'roles': sorted({r['role'] for r in rows} | {m.role for m in members if not m.user.is_super_admin})},
            'no_account': {
                'students': Student.objects.filter(school_id=school_id, status='ACTIVE', is_active=True, user_profile__isnull=True).count(),
                'staff': StaffMember.objects.filter(school_id=school_id, is_active=True, user__isnull=True).count(),
            },
        }

    @staticmethod
    def _filter(rows, params):
        search = (params.get('search') or '').strip().lower()
        if search:
            rows = [r for r in rows if search in r['name'].lower() or search in r['username'].lower()]
        if params.get('role'):
            rows = [r for r in rows if r['role'] == params['role']]
        if params.get('group'):
            rows = [r for r in rows if r['group'] == params['group']]
        if params.get('status'):
            rows = [r for r in rows if r['status'] == params['status']]

        sort = params.get('sort') or 'name'
        reverse = sort.startswith('-')
        field = sort.lstrip('-')
        if field not in ('name', 'role', 'group', 'percent', 'videos_watched', 'last_activity', 'status'):
            field, reverse = 'name', False
        # people who never opened the guide sort as the oldest activity
        epoch = timezone.make_aware(timezone.datetime(1970, 1, 1))
        key = (lambda r: r['last_activity'] or epoch) if field == 'last_activity' else (lambda r: str(r[field]).lower() if isinstance(r[field], str) else r[field])
        return sorted(rows, key=key, reverse=reverse)


def _display_name(user):
    return (user.get_full_name() or '').strip() or user.username


def _safe_cell(value):
    """Stop spreadsheet apps running a name like =HYPERLINK(...) as a formula."""
    text = str(value or '')
    return "'" + text if text[:1] in ('=', '+', '-', '@') else text
