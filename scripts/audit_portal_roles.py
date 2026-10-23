"""READ-ONLY audit before migration users 0009 (portal base roles).

Counts student/parent accounts by their current base role and lists the ones the
conservative backfill will NOT convert, so a person can decide about them first.
It only runs SELECTs: nothing is written. Prints ids and counts, never passwords or tokens.

Run from backend/ against the database you want to check:

    python manage.py shell -c "exec(open('../scripts/audit_portal_roles.py', encoding='utf-8').read())"

Against Supabase this reads real data: run it yourself, or approve it first.
"""
from django.db.models import Q

from schools.models import UserSchoolMembership
from users.models import User

PORTAL_MEMBERSHIP = {'STUDENT', 'PARENT'}

with_student = User.objects.filter(student_profile__isnull=False)
with_parent = User.objects.filter(parent_profile__isnull=False)
profile_users = User.objects.filter(Q(student_profile__isnull=False) | Q(parent_profile__isnull=False)).distinct()

print('== accounts with a student profile, by base role ==')
for role in sorted(set(with_student.values_list('role', flat=True))):
    print(f'  {role}: {with_student.filter(role=role).count()}')
print('== accounts with a parent profile, by base role ==')
for role in sorted(set(with_parent.values_list('role', flat=True))):
    print(f'  {role}: {with_parent.filter(role=role).count()}')

both = [u.pk for u in profile_users if hasattr(u, 'student_profile') and hasattr(u, 'parent_profile')]
print(f'== accounts with BOTH profiles (left for review): {len(both)} {both}')

to_convert, review = 0, []
for user in profile_users.filter(role='STAFF'):
    if user.pk in both:
        continue
    roles = set(UserSchoolMembership.objects.filter(user=user, is_active=True).values_list('role', flat=True))
    if roles <= PORTAL_MEMBERSHIP:
        to_convert += 1
    else:
        review.append((user.pk, sorted(roles)))

print(f'== role STAFF with a profile that the backfill WILL convert: {to_convert}')
print(f'== role STAFF with a profile and a non-portal active membership (left for review): {len(review)}')
for pk, roles in review:
    print(f'  user {pk}: active memberships {roles}')

print('== profile accounts with NO active membership at all:',
      sum(1 for u in profile_users if not UserSchoolMembership.objects.filter(user=u, is_active=True).exists()))
print('Nothing was changed.')
