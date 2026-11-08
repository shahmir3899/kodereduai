from django.contrib import admin

from .models import AgentAction, AgentAuditLog, AgentConversation, AgentMessage

admin.site.register(AgentConversation)
admin.site.register(AgentMessage)
admin.site.register(AgentAction)
admin.site.register(AgentAuditLog)
