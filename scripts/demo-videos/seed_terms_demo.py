"""Scratch data for the 'Academic year and terms' guide video (made-up school, no real people).

Run from backend/ against the throwaway SQLite database:
    ENVIRONMENT=local DEMO_PASSWORD=... python ../scripts/demo-videos/seed_terms_demo.py
Leaves a current year (2026-27) with NO terms, so the video can build them from scratch, plus a finished
previous year so the timeline strip has something to compare against. Safe to re-run: it resets itself.
"""
import os
import sys
from datetime import date

import django

sys.path.insert(0, os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
os.environ.pop('DATABASE_URL', None)  # never touch a real database
django.setup()

from academic_sessions.models import AcademicYear, Term  # noqa: E402
from schools.models import Organization, School, UserSchoolMembership  # noqa: E402
from users.models import User  # noqa: E402

password = os.environ.get('DEMO_PASSWORD')
if not password:
    sys.exit('Set DEMO_PASSWORD (any value; it is only used for this scratch database).')

School.objects.filter(name='Greenfield Demo School').delete()
User.objects.filter(username='demo.admin').delete()

org, _ = Organization.objects.get_or_create(name='Greenfield Demo Org', defaults={'slug': 'greenfield-demo-org'})
school = School.objects.create(organization=org, name='Greenfield Demo School', subdomain='greenfield-demo')
admin = User.objects.create_user(
    username='demo.admin', email='demo.admin@example.test', password=password,
    role='SCHOOL_ADMIN', school=school, organization=org, first_name='Amina', last_name='Khan',
)
UserSchoolMembership.objects.create(user=admin, school=school, role='SCHOOL_ADMIN', is_default=True)

previous = AcademicYear.objects.create(
    school=school, name='2025-26', start_date=date(2025, 4, 1), end_date=date(2026, 3, 31), is_current=False,
)
for order, (name, start, end) in enumerate([
    ('Term 1', date(2025, 4, 1), date(2025, 7, 31)),
    ('Term 2', date(2025, 8, 1), date(2025, 11, 30)),
    ('Term 3', date(2025, 12, 1), date(2026, 3, 31)),
], start=1):
    Term.objects.create(school=school, academic_year=previous, name=name, order=order, start_date=start, end_date=end)
AcademicYear.objects.create(
    school=school, name='2026-27', start_date=date(2026, 4, 1), end_date=date(2027, 3, 31), is_current=True,
)
print(f'Seeded {school.name} (id {school.id}); login demo.admin')
