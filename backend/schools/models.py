from django.db import models


def default_mark_mappings():
    """Default attendance mark mappings."""
    return {
        "PRESENT": ["P", "p", "✓", "✔", "/", "1"],
        "ABSENT": ["A", "a", "✗", "✘", "X", "x", "0", "-"],
        "LATE": ["L", "l"],
        "LEAVE": ["Le", "LE", "le"],
        "default": "ABSENT"  # What to use for blank/unrecognized marks
    }


def default_register_config():
    """Default register format configuration."""
    return {
        "orientation": "rows_are_students",  # or "columns_are_students"
        "date_header_row": 0,  # Which row contains date headers (0-indexed)
        "student_name_col": 0,  # Which column has student names
        "roll_number_col": 1,  # Which column has roll numbers (-1 if none)
        "data_start_row": 1,  # First row of actual attendance data
        "data_start_col": 2,  # First column of attendance marks
    }


class School(models.Model):
    """
    Tenant model - each school is a separate tenant in the platform.
    All data is isolated by school_id.
    """
    name = models.CharField(max_length=200)
    subdomain = models.CharField(
        max_length=50,
        unique=True,
        help_text="Unique subdomain for the school (e.g., 'focus' for focus.kodereduai.pk)"
    )
    logo = models.URLField(blank=True, null=True)
    address = models.TextField(blank=True)
    contact_email = models.EmailField(blank=True)
    contact_phone = models.CharField(max_length=20, blank=True)

    # WhatsApp Integration
    whatsapp_sender_id = models.CharField(
        max_length=100,
        blank=True,
        help_text="WhatsApp Business API sender ID for this school"
    )

    # Register format configuration (school-specific)
    mark_mappings = models.JSONField(
        default=default_mark_mappings,
        help_text='Maps symbols to status: {"PRESENT": ["P", "✓"], "ABSENT": ["A", "✗"], "default": "ABSENT"}'
    )
    register_config = models.JSONField(
        default=default_register_config,
        help_text="Register layout: orientation, header positions, data start positions"
    )

    # Feature flags per school
    enabled_modules = models.JSONField(
        default=dict,
        help_text="Feature flags: {'attendance_ai': true, 'whatsapp': true}"
    )

    # Status
    is_active = models.BooleanField(default=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'School'
        verbose_name_plural = 'Schools'

    def __str__(self):
        return self.name

    def get_enabled_module(self, module_name: str) -> bool:
        """Check if a specific module is enabled for this school."""
        return self.enabled_modules.get(module_name, False)

    def get_status_for_mark(self, mark: str) -> str:
        """
        Convert an attendance mark to a status using school's mappings.

        Args:
            mark: The symbol found in the register (e.g., "P", "✓", "A")

        Returns:
            Status string: "PRESENT", "ABSENT", "LATE", "LEAVE"
        """
        if not mark or not mark.strip():
            return self.mark_mappings.get("default", "ABSENT")

        mark = mark.strip()

        for status, symbols in self.mark_mappings.items():
            if status == "default":
                continue
            if isinstance(symbols, list) and mark in symbols:
                return status

        return self.mark_mappings.get("default", "ABSENT")
