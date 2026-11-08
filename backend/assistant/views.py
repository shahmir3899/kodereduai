import json
import logging

from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.mixins import ensure_tenant_school_id
from core.permissions import HasSchoolAccess, get_effective_role

from . import engine, memory, orchestrator, registry, voice
from .guards import GuardRefusal
from .models import AgentConversation, AgentMessage

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

    def _school_id(self, request):
        return ensure_tenant_school_id(request)

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
            conv.title = str(request.data['title'])[:200]
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
    'communication': 'Parent communication', 'study': 'Study helper',
}
# Starter prompts per sub-agent, in the mix the users actually type (English and Roman Urdu).
SUGGESTIONS = {
    'finance': ['Is mahine ki kitni fee pending hai?', 'Which students have not paid in Class 5?', 'Add an expense of 5000 for electricity'],
    'academics': ['Show the Class 4 timetable', 'How many draft lesson plans do I have this month?',
                  'Plan English chapters 3 and 4 for next month'],
    'attendance': ['Which classes have not marked attendance today?', 'Class 5A ki hazri lagao'],
    'communication': ['Draft a fee reminder for Class 5 parents', 'Ali Raza ki attendance kaisi hai?'],
    'study': ['Aaj ka kaam kya hai?', 'What were my marks in the last exam?'],
}


def _sse(event):
    return 'data: ' + json.dumps(event, cls=DjangoJSONEncoder) + chr(10) + chr(10)


class CapabilitiesView(_AssistantView):
    """What the assistant can do for THIS user: the orb only appears when the list is not empty."""

    def get(self, request):
        school_id = self._school_id(request)
        if not school_id:
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
        ordered = sorted(agents.values(), key=lambda a: a['name'])
        suggestions = [s for a in ordered for s in SUGGESTIONS.get(a['name'], [])[:2]][:8]
        return Response({'agents': ordered, 'suggestions': suggestions, 'memory_limit': memory.WINDOW,
                         'voice': {'enabled': voice.available(), 'max_seconds': voice.MAX_SECONDS}})


class MessageStreamView(_AssistantView):
    """Same turn as the messages endpoint, but as server-sent events so the screen can show what is happening:
    start, route, step (start/end), card (a change waiting for approval), final (or error)."""

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
            return Response({'error': 'Voice is switched off.'}, status=503)
        school_id = self._school_id(request)
        ctx = registry.ToolContext(user=request.user, school_id=school_id, role=get_effective_role(request))
        if not school_id or not registry.tools_for(ctx):
            return Response({'error': 'Voice is not available for your account.'}, status=403)
        try:
            voice.count_use(request.user)
        except voice.VoiceLimit:
            return Response({'error': 'Daily voice limit reached. You can still type.'}, status=429)
        return None


class TranscribeView(_VoiceView):
    """POST multipart: audio (a recording), optional language ("auto", "ur" or "en") -> {text, language, duration}."""

    def post(self, request):
        audio = request.FILES.get('audio')
        if audio is None:
            return Response({'error': 'audio is required'}, status=400)
        if audio.size == 0:
            return Response({'error': 'The recording is empty.'}, status=400)
        if audio.size > settings.STT_MAX_BYTES:
            return Response({'error': 'The recording is too long. Keep it under a minute.'}, status=413)
        if voice.normalise_type(audio.content_type) not in voice.EXTENSIONS:
            return Response({'error': 'This audio format is not supported.'}, status=415)
        language = str(request.data.get('language', '')).strip().lower()
        if language not in voice.LANGUAGES:
            return Response({'error': 'language must be auto, ur or en'}, status=400)
        blocked = self._gate(request)
        if blocked:
            return blocked
        try:
            return Response(voice.transcribe(audio.read(), audio.content_type, language))
        except voice.VoiceUnavailable as exc:
            return Response({'error': str(exc)}, status=503)


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
            return Response({'spoken': voice.spoken_version(text)})
        except voice.VoiceUnavailable as exc:
            return Response({'error': str(exc)}, status=503)

