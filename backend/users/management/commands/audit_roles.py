"""Read-only report of role drift: places where User.role and the school membership disagree.

Run before and after applying the 2026-11 role migrations. It never writes.
"""
from django.core.management.base import BaseCommand

from core.roles import MEMBERSHIP_ROLES
from schools.models import UserSchoolMembership
from users.models import User


class Command(BaseCommand):
    help = 'Report users whose base role and school membership role disagree (read-only).'

    def handle(self, *args, **options):
        legacy = User.objects.filter(role='ACCOUNTANT').count()
        legacy_mem = UserSchoolMembership.objects.filter(role='ACCOUNTANT').count()
        self.stdout.write(f'Still ACCOUNTANT: users={legacy}, memberships={legacy_mem} (should be 0 after migrating)')

        no_membership = User.objects.filter(is_active=True, school_memberships__isnull=True).exclude(role='SUPER_ADMIN')
        self.stdout.write(f'Active non-superadmin users with no membership: {no_membership.count()}')
        for u in no_membership[:20]:
            self.stdout.write(f'  - {u.username} (User.role={u.role})')

        mismatches = []
        for mem in UserSchoolMembership.objects.filter(is_active=True).select_related('user', 'school'):
            if mem.role in ('PARENT', 'STUDENT'):
                continue  # portal accounts keep a placeholder base role on purpose
            if mem.user.role != mem.role:
                mismatches.append(mem)
        self.stdout.write(f'Membership role != User.role (staff roles only): {len(mismatches)}')
        for mem in mismatches[:40]:
            self.stdout.write(f'  - {mem.user.username} @ {mem.school.name}: user={mem.user.role} membership={mem.role}')

        flagged_wrong = UserSchoolMembership.objects.filter(can_manage_finance=True).exclude(role='MANAGER').count()
        self.stdout.write(f'can_manage_finance on a non-MANAGER membership: {flagged_wrong}')

        bad = UserSchoolMembership.objects.exclude(role__in=MEMBERSHIP_ROLES).count()
        self.stdout.write(f'Memberships with an unknown role value: {bad}')
