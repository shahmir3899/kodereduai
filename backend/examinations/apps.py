from django.apps import AppConfig


class ExaminationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'examinations'
    verbose_name = 'Examinations & Results'

    def ready(self):
        import examinations.signals  # noqa: F401
