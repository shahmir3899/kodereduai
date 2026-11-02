"""Create (or top up) one SEED_TEST driver in the seed school, for checking the driver app.

    python manage.py seed_test_driver                # school 37 (SEED_TEST_School_Alpha)
    python manage.py seed_test_driver --remove       # delete everything this command made

Idempotent: running it twice changes nothing. It makes one DRIVER user (dev password, same as the
other SEED_TEST accounts), a staff record for the self-service screens, three days of attendance this
month, one route with three stops, and one vehicle linked to the driver and the route. Every row is
named SEED_TEST_ so it is easy to find and remove. The dev database is real Supabase: this writes to it,
so it only touches the seed school and refuses any other.
"""
from datetime import date, time, timedelta

from django.core.management.base import BaseCommand, CommandError

SEED_PREFIX = 'SEED_TEST_'
USERNAME = f'{SEED_PREFIX}driver_app'
EMPLOYEE_ID = f'{SEED_PREFIX}D001'
ROUTE_NAME = f'{SEED_PREFIX}Route_Driver'
VEHICLE_NUMBER = 'SEED-DRV-01'
PASSWORD = 'Abcd1234'  # the dev password listed in the project CLAUDE.md for test accounts


class Command(BaseCommand):
    help = 'Create or remove one SEED_TEST driver (user, staff record, route, vehicle) in the seed school.'

    def add_arguments(self, parser):
        parser.add_argument('--school-id', type=int, default=37)
        parser.add_argument('--remove', action='store_true')

    def handle(self, *args, **options):
        from hr.models import StaffAttendance, StaffDepartment, StaffDesignation, StaffMember
        from schools.models import School, UserSchoolMembership
        from transport.models import TransportRoute, TransportStop, TransportVehicle
        from users.models import User

        school = School.objects.filter(id=options['school_id']).first()
        if not school:
            raise CommandError(f"School {options['school_id']} not found.")
        if 'SEED_TEST' not in school.name.upper():
            raise CommandError(f'Refusing: "{school.name}" is not a SEED_TEST school.')

        if options['remove']:
            TransportVehicle.objects.filter(school=school, vehicle_number=VEHICLE_NUMBER).delete()
            TransportRoute.objects.filter(school=school, name=ROUTE_NAME).delete()
            StaffAttendance.objects.filter(staff_member__employee_id=EMPLOYEE_ID, school=school).delete()
            StaffMember.objects.filter(school=school, employee_id=EMPLOYEE_ID).delete()
            UserSchoolMembership.objects.filter(user__username=USERNAME).delete()
            User.objects.filter(username=USERNAME).delete()
            self.stdout.write('Removed the seed driver and its route, vehicle and attendance.')
            return

        user = User.objects.filter(username=USERNAME).first()
        if not user:
            user = User.objects.create_user(
                username=USERNAME, email=f'{USERNAME}@test.com', password=PASSWORD, role='DRIVER',
                school=school, organization=school.organization,
            )
        UserSchoolMembership.objects.get_or_create(
            user=user, school=school, defaults={'role': 'DRIVER', 'is_default': True},
        )

        dept, _ = StaffDepartment.objects.get_or_create(school=school, name=f'{SEED_PREFIX}Transport')
        desig, _ = StaffDesignation.objects.get_or_create(
            school=school, name=f'{SEED_PREFIX}Driver', defaults={'department': dept},
        )
        staff, _ = StaffMember.objects.get_or_create(
            school=school, employee_id=EMPLOYEE_ID,
            defaults=dict(
                user=user, first_name=f'{SEED_PREFIX}Driver', last_name='App', department=dept, designation=desig,
                employment_status='ACTIVE', employment_type='FULL_TIME', date_of_joining=date(2024, 1, 1),
            ),
        )
        if staff.user_id != user.id:
            staff.user = user
            staff.save(update_fields=['user'])

        today = date.today()
        made = 0
        for back in range(1, 8):
            day = today - timedelta(days=back)
            if day.month != today.month or day.weekday() == 6:
                continue
            _, created = StaffAttendance.objects.get_or_create(
                staff_member=staff, date=day, defaults=dict(school=school, status='PRESENT', check_in=time(7, 30), check_out=time(15, 0)),
            )
            made += int(created)
            if made >= 3:
                break

        route, _ = TransportRoute.objects.get_or_create(
            school=school, name=ROUTE_NAME,
            defaults=dict(start_location='SEED_TEST Depot', end_location='SEED_TEST School', distance_km=9, estimated_duration_minutes=35),
        )
        for order, (name, pickup) in enumerate([('Green Park', time(7, 0)), ('Main Market', time(7, 15)), ('City Mall', time(7, 30))], start=1):
            TransportStop.objects.get_or_create(
                route=route, stop_order=order, defaults=dict(name=f'{SEED_PREFIX}{name}', pickup_time=pickup, drop_time=time(14 + order // 2, 30 * (order % 2))),
            )
        vehicle, _ = TransportVehicle.objects.get_or_create(
            school=school, vehicle_number=VEHICLE_NUMBER,
            defaults=dict(vehicle_type='BUS', capacity=30, make_model='SEED_TEST Bus', driver_name=f'{SEED_PREFIX}Driver App'),
        )
        vehicle.driver_user, vehicle.assigned_route, vehicle.is_active = user, route, True
        vehicle.save()

        self.stdout.write(f'Seed driver ready in {school.name}: user {USERNAME}, vehicle {VEHICLE_NUMBER}, route {ROUTE_NAME}.')
