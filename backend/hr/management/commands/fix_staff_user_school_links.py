"""
Make every linked staff user consistent with the staff member's school.

For each StaffMember with a linked user:
  - user has an active membership in the staff's school -> fine
  - user.school is the staff's school but the membership is missing -> create it (--apply)
  - user.school is empty and there is no membership      -> set user.school + create the membership (--apply)
  - user belongs only to another school                   -> reported, never changed (needs a human decision)

Dry run by default: nothing is written without --apply.

    python manage.py fix_staff_user_school_links            # report only
    python manage.py fix_staff_user_school_links --apply
"""
from django.core.management.base import BaseCommand

from hr.models import StaffMember
from schools.models import UserSchoolMembership


class Command(BaseCommand):
    help = 'Report (and with --apply, fix) staff-linked users that lack a membership in the staff member\'s school.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Write the fixes. Without it this only reports.')

    def handle(self, *args, apply=False, **options):
        counts = {'ok': 0, 'add_membership': 0, 'set_school_and_membership': 0, 'other_school': 0, 'super_admin': 0}
        for staff in StaffMember.objects.filter(user__isnull=False).select_related('user'):
            user = staff.user
            label = f'staff {staff.id} ({staff.first_name} {staff.last_name}, school {staff.school_id}) <- user {user.id} {user.username}'
            if user.is_super_admin:
                counts['super_admin'] += 1
                self.stdout.write(f'SUPER ADMIN linked (report only): {label}')
                continue
            if UserSchoolMembership.objects.filter(user=user, school_id=staff.school_id, is_active=True).exists():
                counts['ok'] += 1
                continue
            if user.school_id and user.school_id != staff.school_id:
                counts['other_school'] += 1
                self.stdout.write(f'OTHER SCHOOL (user school {user.school_id}, report only): {label}')
                continue
            key = 'add_membership' if user.school_id else 'set_school_and_membership'
            counts[key] += 1
            self.stdout.write(f'{"FIX" if apply else "WOULD FIX"} {key}: {label}')
            if apply:
                if not user.school_id:
                    user.school_id = staff.school_id
                    user.save(update_fields=['school'])
                UserSchoolMembership.objects.get_or_create(
                    user=user, school_id=staff.school_id,
                    defaults={'role': user.role if user.role in UserSchoolMembership.Role.values else 'STAFF',
                              'is_default': not user.school_memberships.exists(), 'is_active': True},
                )
        self.stdout.write(self.style.SUCCESS(f'{"Applied" if apply else "Dry run"}: {counts}'))
