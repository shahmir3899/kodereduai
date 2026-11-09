from django.apps import AppConfig


class AssistantConfig(AppConfig):
    name = 'assistant'
    default_auto_field = 'django.db.models.BigAutoField'

    def ready(self):
        # Tool packs register themselves on import.
        from .skills import load_all
        load_all()
        from .usage import patch_groq_sdk
        patch_groq_sdk()
