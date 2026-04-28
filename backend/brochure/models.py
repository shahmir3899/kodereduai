from django.db import models


def career_cv_upload_path(instance, filename):
    return f"careers/cv/{instance.created_at:%Y/%m}/{filename}"


class BrochureSection(models.Model):
    key = models.SlugField(unique=True, max_length=100)  # e.g. "introduction"
    title = models.CharField(max_length=200)
    order = models.IntegerField(default=0)
    content = models.JSONField(default=dict)        # TipTap JSON document
    content_html = models.TextField(blank=True)     # HTML cache rendered from TipTap JSON
    is_visible = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        'users.User',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='brochure_edits',
    )

    class Meta:
        ordering = ['order']

    def __str__(self):
        return self.title


class CareerApplication(models.Model):
    full_name = models.CharField(max_length=120)
    email = models.EmailField()
    phone = models.CharField(max_length=30)
    role_applied = models.CharField(max_length=120)
    cover_letter = models.TextField()
    cv_file = models.FileField(upload_to=career_cv_upload_path)
    source = models.CharField(max_length=50, default='landing-page')
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.full_name} - {self.role_applied}"
