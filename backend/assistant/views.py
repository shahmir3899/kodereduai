import json
import logging

from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.http import StreamingHttpResponse
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.negotiation import DefaultContentNegotiation
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.mixins import ensure_tenant_school_id
from core.permissions import HasSchoolAccess, get_effective_role

from . import engine, gaps, insights, memory, orchestrator, prefs, registry, usage, voice
from .guards import GuardRefusal
from .models import AgentConversation, AgentGap, AgentGapGroup, AgentMessage

logger = logging.getLogger(__name__)

MAX_MESSAGE_CHARS = 2000


class MessageSerializer(serializers.ModelSerializer):
    sub_agents = serializers.SerializerMethodField()
    actions = serializers.SerializerMethodField()

    class Meta:
        model = AgentMessage
        fields = ['id', 'role', 'content', 'sub_agents', 'tool_calls', 'actions', 'created_at']

    def get_actions(self, obj):
        # Preview cards that belong to this answer, with their current status.
        return [engine.serialize(a) for a in obj.actions.all()]

    def get_sub_agents(self, obj):
        return [s for s in obj.sub_agent.split(',') if s]


class ConversationSerializer(serializers.ModelSerializer):
    memory = serializers.SerializerMethodField()

    class Meta:
        model = AgentConversation
        fields = ['id', 'title', 'pinned', 'last_active', 'created_at', 'memory']

    def get_memory(self, obj):
        return memory.counter(obj)


class _AssistantView(APIView):
    permission_classes = [IsAuthenticated, HasSchoolAccess]
    # Parents and students use the assistant too; what they may do is decided per tool,
    # not by the school-wide portal block.
    allow_portal_roles = True
    # Capabilities answers "nothing available" instead of 404 so the app can simply hide the orb.
    off_means_404 = True

    def _school_id(self, request):
        return ensure_tenant_school_id(request)

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        school_id = self._school_id(request)
        if self.off_means_404 and school_id and not usage.assistant_enabled(school_id):
            raise Http404()

    def _conversation(self, request, pk):
        school_id = self._school_id(request)
        return get_object_or_404(AgentConversation, pk=pk, school_id=school_id, user=request.user)


class ConversationListView(_AssistantView):
    def get(self, request):
        school_id = self._school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)
        rows = AgentConversation.objects.filter(school_id=school_id, user=request.user)[:100]
        return Response(ConversationSerializer(rows, many=True).data)

    def post(self, request):
        school_id = self._school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)
        conv = AgentConversation.objects.create(
            school_id=school_id, user=request.user, title=str(request.data.get('title', ''))[:200],
        )
        return Response(ConversationSerializer(conv).data, status=201)


class ConversationDetailView(_AssistantView):
    def get(self, request, pk):
        return Response(ConversationSerializer(self._conversation(request, pk)).data)

    def patch(self, request, pk):
        conv = self._conversation(request, pk)
        if 'title' in request.data:
            title = str(request.data['title'] or '').strip()
            if not title:
                return Response({'error': 'The name cannot be empty.'}, status=400)
            if len(title) > 200:
                return Response({'error': 'The name is too long (200 characters at most).'}, status=400)
            conv.title = title
        if 'pinned' in request.data:
            conv.pinned = bool(request.data['pinned'])
        conv.save()
        return Response(ConversationSerializer(conv).data)

    def delete(self, request, pk):
        self._conversation(request, pk).delete()
        return Response(status=204)


class MessageListView(_AssistantView):
    def get(self, request, pk):
        conv = self._conversation(request, pk)
        rows = conv.messages.order_by('created_at', 'id')[:200]
        return Response({
            'messages': MessageSerializer(rows, many=True).data,
            'memory': memory.counter(conv),
        })

    def post(self, request, pk):
        conv = self._conversation(request, pk)
        text = str(request.data.get('message', '')).strip()
        if not text:
            return Response({'error': 'message is required'}, status=400)
        if len(text) > MAX_MESSAGE_CHARS:
            return Response({'error': f'Message too long (max {MAX_MESSAGE_CHARS} characters).'}, status=400)

        ctx = registry.ToolContext(
            user=request.user, school_id=conv.school_id,
            role=get_effective_role(request), conversation=conv,
        )
        try:
            result = orchestrator.run_turn(conv, text, ctx)
        except GuardRefusal as refusal:
            return Response({'error': str(refusal)}, status=400)
        except Exception:
            logger.exception('assistant turn failed')
            return Response({'error': 'The assistant hit an error. Please try again.'}, status=500)

        reply = conv.messages.filter(role=AgentMessage.Role.ASSISTANT).order_by('-created_at', '-id').first()
        return Response({
            'response': result.content,
            'sub_agents': result.sub_agents,
            'tool_calls': result.tool_calls,
            'actions': [engine.serialize(a) for a in reply.actions.all()] if reply else [],
            'message': MessageSerializer(reply).data,
            'memory': memory.counter(conv),
        })


class FeedbackView(_AssistantView):
    """Thumbs up/down on one of Aura's replies (or the reply that owns an approval card)."""

    def post(self, request):
        school_id = self._school_id(request)
        try:
            rating = int(request.data.get('rating'))
            message_id = int(request.data.get('message_id'))
        except (TypeError, ValueError):
            return Response({'error': 'message_id and rating are required'}, status=400)
        if rating not in (1, -1):
            return Response({'error': 'rating must be 1 or -1'}, status=400)
        # Someone else's message looks the same as a missing one.
        message = AgentMessage.objects.filter(
            pk=message_id, role=AgentMessage.Role.ASSISTANT,
            conversation__school_id=school_id, conversation__user=request.user,
        ).select_related('conversation').first()
        if not message:
            return Response({'detail': 'Message not found.'}, status=404)

        ctx = registry.ToolContext(user=request.user, school_id=school_id, role=get_effective_role(request),
                                   conversation=message.conversation)
        kind = AgentGap.Kind.THUMBS_UP if rating == 1 else AgentGap.Kind.THUMBS_DOWN
        # One opinion per person per message: a changed mind replaces the old row.
        AgentGap.objects.filter(school_id=school_id, user=request.user, message_id=message.pk,
                                kind__in=[AgentGap.Kind.THUMBS_UP, AgentGap.Kind.THUMBS_DOWN]).delete()
        row = gaps.record_gap(ctx, kind, message.conversation.messages.filter(
            role=AgentMessage.Role.USER, created_at__lte=message.created_at).order_by('-created_at', '-id')
            .values_list('content', flat=True).first() or '',
            agent=message.sub_agent.split(',')[0] if message.sub_agent else '',
            message_id=message.pk, rating=rating, reason=str(request.data.get('reason', ''))[:300], dedupe=False)
        return Response({'ok': row is not None})


class PreferencesView(_AssistantView):
    """The signed-in user's own saved preferences (backlog item D). Never anyone else's: the row is looked up by request.user."""

    def _ctx(self, request):
        return registry.ToolContext(user=request.user, school_id=self._school_id(request), role=get_effective_role(request))

    def _payload(self, request, ctx):
        accounts = []
        try:
            from .skills.finance_writes import _accounts
            if get_effective_role(request) in ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'ACCOUNTANT'):
                accounts = [{'id': a['id'], 'name': a['name']} for a in _accounts(ctx)]
        except Exception:       # finance off or no permission: the sheet simply hides the account choice
            accounts = []
        return {'preferences': prefs.get(ctx.school_id, request.user.id), 'languages': prefs.LANGUAGES, 'accounts': accounts}

    def get(self, request):
        ctx = self._ctx(request)
        return Response(self._payload(request, ctx))

    def patch(self, request):
        ctx = self._ctx(request)
        changes = {k: v for k, v in (request.data or {}).items() if k in prefs.KEYS}
        if not changes:
            return Response({'error': 'Send language, default_class or default_account_id.'}, status=400)
        try:
            prefs.save(ctx, changes)
        except registry.ProposalError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response(self._payload(request, ctx))


class InsightsView(_AssistantView):
    """What people asked that Aura could not do. School admin / principal: own school. Super admin: all schools."""
    # History stays readable even if a school switches Aura off.
    off_means_404 = False

    def get(self, request):
        super_admin = bool(request.user.is_super_admin)
        role = get_effective_role(request)
        if not super_admin and role not in ('SCHOOL_ADMIN', 'PRINCIPAL'):
            return Response({'detail': 'Only admins can see Aura insights.'}, status=403)
        q = request.query_params
        try:
            days = int(q.get('days', 30))
            school_filter = int(q['school']) if q.get('school') else None
        except ValueError:
            return Response({'error': 'days and school must be numbers'}, status=400)
        return Response(insights.build(
            self._school_id(request), super_admin, days=days, kind=q.get('kind') or None, agent=q.get('agent') or None,
            role=q.get('role') or None, status=q.get('status') or None, school_filter=school_filter))


class InsightsGroupView(_AssistantView):
    """Owner decision on a group: status, note, linked baseline question. Super admin only."""
    off_means_404 = False

    def patch(self, request, pk):
        if not request.user.is_super_admin:
            return Response({'detail': 'Only the super admin can change a group.'}, status=403)
        group = get_object_or_404(AgentGapGroup, pk=pk)
        data = request.data
        if 'status' in data:
            if data['status'] not in AgentGapGroup.Status.values:
                return Response({'error': 'Invalid status.'}, status=400)
            group.status = data['status']
        if 'note' in data:
            group.note = str(data['note'])[:2000]
        if 'baseline_question_id' in data:
            group.baseline_question_id = (str(data['baseline_question_id'])[:60] or None)
        group.save()
        return Response({'id': group.id, 'status': group.status, 'note': group.note,
                         'baseline_question_id': group.baseline_question_id})


class ActionListView(_AssistantView):
    def get(self, request):
        school_id = self._school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)
        return Response([engine.serialize(a) for a in engine.pending_for(request.user, school_id)[:50]])


class ActionDetailView(_AssistantView):
    def get(self, request, pk):
        try:
            return Response(engine.serialize(engine.get_action(pk, request.user, self._school_id(request))))
        except engine.ActionError as exc:
            return Response({'error': exc.message, 'code': exc.code}, status=exc.status)


class _ActionStepView(_AssistantView):
    def _respond(self, request, step):
        try:
            return Response(engine.serialize(step()))
        except engine.ActionError as exc:
            return Response({'error': exc.message, 'code': exc.code, **exc.extra}, status=exc.status)


class ActionApproveView(_ActionStepView):
    def post(self, request, pk):
        school_id = self._school_id(request)
        return self._respond(request, lambda: engine.approve(pk, request.user, school_id))


class ActionRejectView(_ActionStepView):
    def post(self, request, pk):
        school_id = self._school_id(request)
        return self._respond(request, lambda: engine.reject(pk, request.user, school_id))


class ActionEditView(_ActionStepView):
    def post(self, request, pk):
        school_id = self._school_id(request)
        edits = request.data.get('edits', request.data)
        if not isinstance(edits, dict):
            return Response({'error': 'edits must be an object'}, status=400)
        return self._respond(request, lambda: engine.edit(pk, request.user, school_id, edits))


AGENT_LABELS = {
    'finance': 'Finance', 'academics': 'Academics', 'attendance': 'Attendance',
    'communication': 'Parent communication', 'study': 'Study helper', 'exams': 'Exams',
    'operations': 'Operations', 'settings': 'My settings', 'family': 'My children', 'hr': 'HR', 'students': 'Students & admissions',
}
# Starter prompts per sub-agent, in the mix the users actually type (English and Roman Urdu).
SUGGESTIONS = {
    'finance': ['Is mahine ki kitni fee pending hai?', 'Which students have not paid in Class 5?', 'Add an expense of 5000 for electricity'],
    'academics': ['Show the Class 4 timetable', 'How many draft lesson plans do I have this month?',
                  'Plan English chapters 3 and 4 for next month'],
    'attendance': ['Which classes have not marked attendance today?', 'Class 5A ki hazri lagao'],
    'communication': ['Draft a fee reminder for Class 5 parents', 'Ali Raza ki attendance kaisi hai?'],
    'exams': ['How did Class 5 do in the mid term?', 'Class 6 maths ke marks enter karo'],
    'students': ['How many open admission enquiries do we have?', 'Ali Raza ka profile dikhao'],
    'family': ['How is my child doing in attendance?', 'Fees kitni baqi hai?'],
    'operations': ['Which library books are overdue?', 'How many chairs are left in inventory?'],
    'hr': ['Who is on leave today?', 'Sana ki chutti approve kar do', 'Generate payslips for this month'],
    'study': ['Aaj ka kaam kya hai?', 'What were my marks in the last exam?'],
}


def _sse(event):
    return 'data: ' + json.dumps(event, cls=DjangoJSONEncoder) + chr(10) + chr(10)


class CapabilitiesView(_AssistantView):
    """What the assistant can do for THIS user: the orb only appears when the list is not empty."""
    off_means_404 = False

    def get(self, request):
        school_id = self._school_id(request)
        if not school_id or not usage.assistant_enabled(school_id):
            return Response({'agents': [], 'suggestions': []})
        ctx = registry.ToolContext(user=request.user, school_id=school_id, role=get_effective_role(request))
        agents = {}
        for tool in registry.tools_for(ctx):
            if tool.shared:
                continue
            entry = agents.setdefault(tool.sub_agent, {'name': tool.sub_agent, 'label': AGENT_LABELS.get(tool.sub_agent, tool.sub_agent.title()),
                                                       'tools': 0, 'can_write': False})
            entry['tools'] += 1
            entry['can_write'] = entry['can_write'] or tool.kind == 'write'
        # "My settings" exists for every user, so on its own it must not make the orb appear: a school with every module off still has nothing to ask Aura.
        if set(agents) <= {'settings'}:
            return Response({'agents': [], 'suggestions': []})
        ordered = sorted(agents.values(), key=lambda a: a['name'])
        suggestions = [s for a in ordered for s in SUGGESTIONS.get(a['name'], [])[:2]][:8]
        return Response({'agents': ordered, 'suggestions': suggestions, 'memory_limit': memory.WINDOW,
                         'voice': {'enabled': voice.available(), 'max_seconds': voice.MAX_SECONDS}})


class IgnoreAcceptNegotiation(DefaultContentNegotiation):
    """Browsers open an event stream with `Accept: text/event-stream`, which matches none of DRF's JSON/HTML
    renderers, so DRF answered 406 before the view ran. This view returns its own streaming response and only
    renders small JSON errors, so the Accept header must not decide anything: always use the first renderer (JSON).
    Choosing the parser from the request's Content-Type is unchanged."""

    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type


class MessageStreamView(_AssistantView):
    """Same turn as the messages endpoint, but as server-sent events so the screen can show what is happening:
    start, route, step (start/end), card (a change waiting for approval), final (or error)."""
    content_negotiation_class = IgnoreAcceptNegotiation

    def post(self, request, pk):
        conv = self._conversation(request, pk)
        text = str(request.data.get('message', '')).strip()
        if not text:
            return Response({'error': 'message is required'}, status=400)
        if len(text) > MAX_MESSAGE_CHARS:
            return Response({'error': f'Message too long (max {MAX_MESSAGE_CHARS} characters).'}, status=400)

        ctx = registry.ToolContext(user=request.user, school_id=conv.school_id,
                                   role=get_effective_role(request), conversation=conv)
        events = orchestrator.iter_turn(conv, text, ctx)
        try:
            first = next(events)        # runs the guards, so a refusal is a normal 400, not a broken stream
        except GuardRefusal as refusal:
            return Response({'error': str(refusal)}, status=400)

        def stream():
            try:
                yield _sse({**first, 'memory': memory.counter(conv)})
                for event in events:
                    if event['type'] == 'final':
                        reply = conv.messages.filter(role=AgentMessage.Role.ASSISTANT).order_by('-created_at', '-id').first()
                        event = {**event, 'message': MessageSerializer(reply).data, 'memory': memory.counter(conv)}
                    yield _sse(event)
            except Exception:
                logger.exception('assistant stream failed')
                yield _sse({'type': 'error', 'message': 'The assistant hit an error. Please try again.'})
            finally:
                events.close()

        response = StreamingHttpResponse(stream(), content_type='text/event-stream')
        response['Cache-Control'] = 'no-cache'
        response['X-Accel-Buffering'] = 'no'      # keep proxies from holding the stream back
        return response


class _VoiceView(_AssistantView):
    """Voice is for people who can use the assistant at all, so it cannot be used as a free speech API."""

    def _gate(self, request):
        """Return an error Response, or None when voice may be used."""
        if not voice.available():
            return _refuse('Voice is switched off.', 503)
        school_id = self._school_id(request)
        ctx = registry.ToolContext(user=request.user, school_id=school_id, role=get_effective_role(request))
        if not school_id or not registry.tools_for(ctx):
            return _refuse('Voice is not available for your account.', 403, role=ctx.role)
        try:
            voice.count_use(request.user)
        except voice.VoiceLimit:
            return _refuse('Daily voice limit reached. You can still type.', 429, user=request.user.pk)
        return None


def _refuse(reason, status, **facts):
    logger.warning('voice request refused (%s): %s %s', status, reason, ' '.join(f'{k}={v}' for k, v in facts.items()))
    return Response({'error': reason}, status=status)


class TranscribeView(_VoiceView):
    """POST multipart: audio (a recording), optional language ("auto", "ur" or "en") -> {text, language, duration}."""

    def post(self, request):
        audio = request.FILES.get('audio')
        if audio is None:
            return _refuse('audio is required', 400, fields=sorted(request.FILES))
        if audio.size == 0:
            return _refuse('The recording is empty.', 400)
        if audio.size > settings.STT_MAX_BYTES:
            return _refuse('The recording is too long. Keep it under a minute.', 413, bytes=audio.size)
        if voice.normalise_type(audio.content_type) not in voice.EXTENSIONS:
            return _refuse('This audio format is not supported.', 415, content_type=audio.content_type)
        language = str(request.data.get('language', '')).strip().lower()
        if language not in voice.LANGUAGES:
            return _refuse('language must be auto, ur or en', 400, language=language)
        blocked = self._gate(request)
        if blocked:
            return blocked
        try:
            return Response(voice.transcribe(audio.read(), audio.content_type, language,
                                                usage_for=(self._school_id(request), request.user.pk)))
        except voice.VoiceUnavailable as exc:
            return _refuse(str(exc), 503)


class SpokenVersionView(_VoiceView):
    """POST {text} -> {spoken}: a short version of an assistant reply that reads well aloud."""

    def post(self, request):
        text = str(request.data.get('text', '')).strip()
        if not text:
            return Response({'error': 'text is required'}, status=400)
        if len(text) > voice.SPOKEN_INPUT_MAX * 2:
            return Response({'error': 'text is too long'}, status=400)
        blocked = self._gate(request)
        if blocked:
            return blocked
        try:
            return Response({'spoken': voice.spoken_version(text, usage_for=(self._school_id(request), request.user.pk))})
        except voice.VoiceUnavailable as exc:
            return Response({'error': str(exc)}, status=503)

