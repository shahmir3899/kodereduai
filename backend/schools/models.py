from django.db import models

from core.module_registry import get_default_modules, ALL_MODULE_KEYS


class Organization(models.Model):
    """
    Top-level entity grouping multiple schools/branches.
    E.g. "The Focus Montessori" owns Branch 1 and Branch 2.
    """
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=50, unique=True)
    logo = models.URLField(blank=True, null=True)

    # Module ceiling: which modules are available to all schools in this org
    allowed_modules = models.JSONField(
        default=get_default_modules,
        help_text="Module ceiling for this org. Schools can only enable modules allowed here."
    )

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Organization'
        verbose_name_plural = 'Organizations'

    def __str__(self):
        return self.name

    def get_allowed_module(self, module_name: str) -> bool:
        """Check if a specific module is allowed for this organization."""
        return self.allowed_modules.get(module_name, False)

    def cascade_disabled_modules(self):
        """When org disables a module, auto-disable it on all org's schools."""
        for school in self.schools.all():
            changed = False
            for key in ALL_MODULE_KEYS:
                if not self.allowed_modules.get(key, False) and school.enabled_modules.get(key, False):
                    school.enabled_modules[key] = False
                    changed = True
            if changed:
                school.save(update_fields=['enabled_modules', 'updated_at'])


class UserSchoolMembership(models.Model):
    """
    Many-to-many pivot: a user can belong to multiple schools
    with a per-school role. Replaces the old 1:1 User→School FK.
    """
    class Role(models.TextChoices):
        SCHOOL_ADMIN = 'SCHOOL_ADMIN', 'School Admin'
        PRINCIPAL = 'PRINCIPAL', 'Principal'
        HR_MANAGER = 'HR_MANAGER', 'HR Manager'
        ACCOUNTANT = 'ACCOUNTANT', 'Accountant'
        TEACHER = 'TEACHER', 'Teacher'
        STAFF = 'STAFF', 'Staff'
        PARENT = 'PARENT', 'Parent'
        STUDENT = 'STUDENT', 'Student'

    user = models.ForeignKey(
        'users.User',
        on_delete=models.CASCADE,
        related_name='school_memberships',
    )
    school = models.ForeignKey(
        'School',
        on_delete=models.CASCADE,
        related_name='memberships',
    )
    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.STAFF,
    )
    is_default = models.BooleanField(
        default=False,
        help_text="Which school loads on login",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'school')
        verbose_name = 'User School Membership'
        verbose_name_plural = 'User School Memberships'

    def __str__(self):
        return f"{self.user.username} @ {self.school.name} ({self.get_role_display()})"

    def save(self, *args, **kwargs):
        # Ensure only one default per user
        if self.is_default:
            UserSchoolMembership.objects.filter(
                user=self.user, is_default=True,
            ).exclude(pk=self.pk).update(is_default=False)
        super().save(*args, **kwargs)


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
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='schools',
        help_text="Parent organization (group of branches)",
    )
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
        default=get_default_modules,
        help_text="Per-school module toggles: {'attendance': true, 'finance': true, ...}"
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
        """Check if a specific module is enabled for this school (respects org ceiling)."""
        if not self.enabled_modules.get(module_name, False):
            return False
        # If school belongs to an org, check org ceiling
        if self.organization_id:
            return self.organization.allowed_modules.get(module_name, False)
        return True

    def get_effective_modules(self) -> dict:
        """Return final module state: intersection of org ceiling and school toggles."""
        result = {}
        for key in ALL_MODULE_KEYS:
            school_enabled = self.enabled_modules.get(key, False)
            if self.organization_id:
                org_allowed = self.organization.allowed_modules.get(key, False)
                result[key] = school_enabled and org_allowed
            else:
                result[key] = school_enabled
        return result

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
