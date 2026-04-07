from django.db import models


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
