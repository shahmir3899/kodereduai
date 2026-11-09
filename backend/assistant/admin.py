from django.contrib import admin

from .models import AgentAction, AgentAuditLog, AgentConversation, AgentGap, AgentGapGroup, AgentMessage

admin.site.register(AgentConversation)
admin.site.register(AgentMessage)
admin.site.register(AgentAction)
admin.site.register(AgentAuditLog)
admin.site.register(AgentGapGroup)


@admin.register(AgentGap)
class AgentGapAdmin(admin.ModelAdmin):
    # Read-only: rows are written by the assistant only.
    list_display = ('kind', 'school', 'role', 'agent', 'summary', 'rating', 'created_at')
    list_filter = ('kind', 'role')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
