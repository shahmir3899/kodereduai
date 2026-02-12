from django.db import models
from django.contrib.auth.models import AbstractUser, BaseUserManager


class UserManager(BaseUserManager):
    """Custom user manager for the User model."""

    def create_user(self, username, email=None, password=None, **extra_fields):
        if not username:
            raise ValueError('The Username field must be set')
        email = self.normalize_email(email) if email else None
        user = self.model(username=username, email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, username, email=None, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        extra_fields.setdefault('role', 'SUPER_ADMIN')

        if extra_fields.get('is_staff') is not True:
            raise ValueError('Superuser must have is_staff=True.')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Superuser must have is_superuser=True.')

        return self.create_user(username, email, password, **extra_fields)


class User(AbstractUser):
    """
    Custom User model with role-based access control.

    Roles:
    - SUPER_ADMIN: Platform owner, manages all schools
    - SCHOOL_ADMIN: Per-school admin, manages their school's data
    - STAFF: Teachers/staff, can interact via WhatsApp or limited dashboard
    """

    class Role(models.TextChoices):
        SUPER_ADMIN = 'SUPER_ADMIN', 'Super Admin'
        SCHOOL_ADMIN = 'SCHOOL_ADMIN', 'School Admin'
        PRINCIPAL = 'PRINCIPAL', 'Principal'
        STAFF = 'STAFF', 'Staff'

    # Role field
    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.STAFF
    )

    # Organization
    organization = models.ForeignKey(
        'schools.Organization',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='users',
        help_text="Organization this user belongs to",
    )

    # School association — DEPRECATED: kept for backward compat, synced from default membership
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='users',
        help_text="Deprecated: use school_memberships instead",
    )

    # Contact info
    phone = models.CharField(max_length=20, blank=True)

    # Profile
    profile_photo_url = models.URLField(blank=True, null=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()

    class Meta:
        ordering = ['username']
        verbose_name = 'User'
        verbose_name_plural = 'Users'

    def __str__(self):
        return f"{self.username} ({self.get_role_display()})"

    @property
    def is_super_admin(self) -> bool:
        """Check if user is a Super Admin."""
        return self.role == self.Role.SUPER_ADMIN

    @property
    def is_school_admin(self) -> bool:
        """Check if user is a School Admin."""
        return self.role == self.Role.SCHOOL_ADMIN

    @property
    def is_principal(self) -> bool:
        """Check if user is a Principal."""
        return self.role == self.Role.PRINCIPAL

    @property
    def is_staff_member(self) -> bool:
        """Check if user is a Staff member."""
        return self.role == self.Role.STAFF

    def can_access_school(self, school_id: int) -> bool:
        """Check if user can access a specific school's data."""
        if self.is_super_admin:
            return True
        return school_id in self.get_accessible_school_ids()

    def get_default_membership(self):
        """Return the user's default school membership (or first active one)."""
        from schools.models import UserSchoolMembership
        mem = UserSchoolMembership.objects.filter(
            user=self, is_active=True, is_default=True,
        ).select_related('school').first()
        if not mem:
            mem = UserSchoolMembership.objects.filter(
                user=self, is_active=True,
            ).select_related('school').first()
        return mem

    def get_accessible_school_ids(self):
        """Return list of school IDs this user can access."""
        if self.is_super_admin:
            from schools.models import School
            return list(School.objects.values_list('id', flat=True))
        ids = list(
            self.school_memberships.filter(is_active=True)
            .values_list('school_id', flat=True)
        )
        # Legacy fallback: include user.school_id if not already covered by memberships
        if self.school_id and self.school_id not in ids:
            ids.append(self.school_id)
        return ids

    def get_role_for_school(self, school_id):
        """Return the user's role for a specific school, or None."""
        if self.is_super_admin:
            return self.Role.SUPER_ADMIN
        mem = self.school_memberships.filter(
            school_id=school_id, is_active=True,
        ).first()
        return mem.role if mem else None
