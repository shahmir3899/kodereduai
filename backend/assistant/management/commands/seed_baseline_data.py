"""Add realistic, time-based data to a TEST school so the Aura baseline has something real to ask about.

    python manage.py seed_baseline_data --school-id 37 --part a      # year, classes, people, attendance, exams, leave
    python manage.py seed_baseline_data --school-id 37 --part b      # fees, discounts, expenses, payslips
    python manage.py seed_baseline_data --school-id 37 --part c      # inventory, library, hostel, transport, enquiries

It ADDS to the school (no new school, nothing existing is changed except that the new academic year becomes the current one). Everything is
generated from a fixed random seed, so a second school gets identical data. Each part detects its own earlier run and does nothing twice.
Accounts it creates have no usable password. Rows are tagged: admission numbers, employee ids and usernames start with BASE-/base_, and
account / vendor / category names carry "BASE". It writes straight to the tables, so no notification or message is triggered.

Refuses to run on a school whose name does not look like a test school unless --force is given.
"""
import random
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

SEED = 2026
YEAR_START, YEAR_END = date(2026, 4, 1), date(2027, 3, 31)
LAST_DAY = date(2026, 11, 7)                       # attendance and fees run up to here
BREAK = (date(2026, 6, 1), date(2026, 8, 9))       # summer vacation
HOLIDAYS = {date(2026, 8, 14), date(2026, 9, 6)}
CLASSES = [('Class 4', 4, 3500), ('Class 5', 5, 4000), ('Class 6', 6, 4500)]
SECTIONS = ['A', 'B']
PER_SECTION = 25
SUBJECTS = ['English', 'Urdu', 'Mathematics', 'Science', 'Islamiyat', 'Social Studies']
MALE = ['Ali', 'Ali', 'Ahmad', 'Ahmad', 'Hamza', 'Usman', 'Bilal', 'Hassan', 'Zain', 'Omar', 'Ibrahim', 'Saad', 'Fahad', 'Danish', 'Hussain', 'Talha', 'Yusuf', 'Rayyan']
FEMALE = ['Sara', 'Sara', 'Fatima', 'Fatima', 'Ayesha', 'Zara', 'Hira', 'Maryam', 'Noor', 'Amna', 'Iqra', 'Laiba', 'Sana', 'Mahnoor', 'Areeba', 'Hania']
LAST = ['Khan', 'Raza', 'Hassan', 'Malik', 'Shah', 'Iqbal', 'Ahmed', 'Farooq', 'Javed', 'Butt', 'Chaudhry', 'Siddiqui', 'Sheikh', 'Qureshi', 'Mirza']
TEACHER_FIRST = ['Hasnat', 'Rabia', 'Imran', 'Nadia', 'Kamran', 'Saima', 'Tariq', 'Uzma', 'Faisal', 'Shazia', 'Adeel', 'Mehwish']


def working_days(start, end):
    d = start
    while d <= end:
        if d.weekday() < 5 and not (BREAK[0] <= d <= BREAK[1]) and d not in HOLIDAYS:
            yield d
        d += timedelta(days=1)


def phone(rng):
    return '03' + ''.join(str(rng.randint(0, 9)) for _ in range(9))


class Command(BaseCommand):
    help = 'Add realistic time-based test data to a test school (see the module docstring).'

    def add_arguments(self, parser):
        parser.add_argument('--school-id', type=int, required=True)
        parser.add_argument('--part', choices=['a', 'b', 'c'], required=True)
        parser.add_argument('--force', action='store_true', help='Allow a school whose name does not look like a test school')
        parser.add_argument('--dry-run', action='store_true', help='Do everything, print the counts, then roll back')

    def handle(self, *args, **opts):
        from schools.models import School

        school = School.objects.filter(pk=opts['school_id']).select_related('organization').first()
        if school is None:
            raise CommandError('school not found')
        if not opts['force'] and not any(t in school.name.upper() for t in ('SEED_TEST', 'PYTEST_', 'TEST')):
            raise CommandError(f'"{school.name}" does not look like a test school; pass --force if you are sure.')
        self.school, self.org = school, school.organization
        self.rng = random.Random(SEED)
        part = {'a': self.part_a, 'b': self.part_b, 'c': self.part_c}[opts['part']]
        with transaction.atomic():
            summary = part()
            if opts['dry_run']:
                transaction.set_rollback(True)
        self.stdout.write(('DRY RUN (rolled back): ' if opts['dry_run'] else '') + str(summary))

    # ── helpers ──────────────────────────────────────────────────────────────

    def _user(self, username, role, first, last):
        from schools.models import UserSchoolMembership
        from users.models import User

        u = User.objects.filter(username=username).first()
        if u is None:
            u = User.objects.create_user(username=username, email=f'{username}@example.test', role=role, school=self.school, organization=self.org,
                                         first_name=first, last_name=last)
            u.set_unusable_password()
            u.save(update_fields=['password'])
        UserSchoolMembership.objects.get_or_create(user=u, school=self.school, defaults={'role': role, 'is_default': True})
        return u

    def _admin_user(self):
        from schools.models import UserSchoolMembership
        m = UserSchoolMembership.objects.filter(school=self.school, role__in=['SCHOOL_ADMIN', 'PRINCIPAL']).select_related('user').first()
        return m.user if m else None

    def _year(self):
        from academic_sessions.models import AcademicYear
        return AcademicYear.objects.get(school=self.school, name='BASE_2026-2027')

    # ── part A: year, classes, staff, students, parents, attendance, exams, leave ──

    def part_a(self):
        from academic_sessions.models import AcademicYear, SessionClass, StudentEnrollment, Term
        from academics.models import ClassSubject, ClassTeacherAssignment, Subject
        from attendance.models import AttendanceRecord
        from examinations.models import Exam, ExamSubject, ExamType, GradeScale, StudentMark
        from hr.models import (LeaveApplication, LeavePolicy, SalaryStructure, StaffAttendance, StaffDepartment, StaffDesignation, StaffMember)
        from parents.models import ParentChild, ParentProfile
        from students.models import Class, Student

        from students.models import Student as _S
        if _S.objects.filter(school=self.school, admission_number__startswith='BASE-').exists():
            return 'part a already done - nothing changed'
        rng, school = self.rng, self.school

        AcademicYear.objects.filter(school=school, is_current=True).update(is_current=False)
        year = AcademicYear.objects.create(school=school, name='BASE_2026-2027', start_date=YEAR_START, end_date=YEAR_END, is_current=True, is_active=True)
        Term.objects.create(school=school, academic_year=year, name='Term 1', term_type='TERM', order=1, start_date=YEAR_START, end_date=date(2026, 9, 30))
        Term.objects.create(school=school, academic_year=year, name='Term 2', term_type='TERM', order=2, start_date=date(2026, 10, 1), end_date=YEAR_END, is_current=True)

        subjects = {}
        for name in SUBJECTS:
            subj = Subject.objects.filter(school=school, name__iexact=name).first()
            subjects[name] = subj or Subject.objects.create(school=school, name=name, code=f'B{name[:3].upper()}')

        dept, _ = StaffDepartment.objects.get_or_create(school=school, name='BASE Teaching')
        desig, _ = StaffDesignation.objects.get_or_create(school=school, name='BASE Teacher', defaults={'department': dept})
        teachers = []
        for i, first in enumerate(TEACHER_FIRST, start=1):
            last = rng.choice(LAST)
            user = self._user(f'base_t{i:02d}', 'TEACHER', first, last)
            teachers.append(StaffMember.objects.create(
                school=school, user=user, first_name=first, last_name=last, email=user.email, phone=phone(rng), employee_id=f'BASE-T{i:02d}',
                department=dept, designation=desig, employment_status='ACTIVE', employment_type='FULL_TIME', date_of_joining=date(2020 + i % 5, 8, 1),
                gender='F' if first in ('Rabia', 'Nadia', 'Saima', 'Uzma', 'Shazia', 'Mehwish') else 'M'))
            SalaryStructure.objects.create(school=school, staff_member=teachers[-1], basic_salary=Decimal(40000 + 4000 * (i % 8)),
                                           allowances={'house_rent': 8000, 'transport': 2500.5}, deductions={'tax': 1500, 'provident_fund': 2000},
                                           effective_from=YEAR_START)

        classes, sections = {}, []
        for cname, grade, _fee in CLASSES:
            klass = Class.objects.filter(school=school, name=cname).first() or Class.objects.create(school=school, name=cname, grade_level=grade)
            classes[cname] = klass
            for letter in SECTIONS:
                sections.append(SessionClass.objects.create(school=school, academic_year=year, class_obj=klass, display_name=cname, section=letter, grade_level=grade))
        n = 0
        for si, sc in enumerate(sections):
            ClassTeacherAssignment.objects.create(school=school, academic_year=year, session_class=sc, class_obj=sc.class_obj, teacher=teachers[si % len(teachers)])
            for ji, sname in enumerate(SUBJECTS):
                ClassSubject.objects.create(school=school, academic_year=year, session_class=sc, class_obj=sc.class_obj, subject=subjects[sname],
                                            teacher=teachers[(si + ji) % len(teachers)], periods_per_week=5)

        students, enrollments, quality = [], [], {}
        for sc in sections:
            for roll in range(1, PER_SECTION + 1):
                n += 1
                female = rng.random() < 0.48
                first = rng.choice(FEMALE if female else MALE)
                last = rng.choice(LAST)
                grade = sc.grade_level or 4
                st = Student(school=school, class_obj=sc.class_obj, roll_number=str(roll), name=f'{first} {last}', admission_number=f'BASE-{n:04d}',
                             admission_date=date(2024, 4, 1), date_of_birth=date(2026 - grade - 5, rng.randint(1, 12), rng.randint(1, 28)),
                             gender='F' if female else 'M', parent_name=f'{rng.choice(MALE)} {last}', parent_phone=phone(rng), is_active=True, status='ACTIVE')
                students.append((st, sc))
        Student.objects.bulk_create([s for s, _ in students], batch_size=200)
        saved = list(Student.objects.filter(school=school, admission_number__startswith='BASE-').order_by('admission_number'))
        by_adm = {s.admission_number: s for s in saved}
        pairs = [(by_adm[s.admission_number], sc) for s, sc in students]
        StudentEnrollment.objects.bulk_create([StudentEnrollment(school=school, student=s, academic_year=year, class_obj=sc.class_obj, session_class=sc,
                                                                 roll_number=s.roll_number, status='ACTIVE', is_active=True) for s, sc in pairs], batch_size=200)
        enr = {e.student_id: e for e in StudentEnrollment.objects.filter(school=school, academic_year=year)}
        for s, _ in pairs:
            r = rng.random()
            quality[s.id] = 'good' if r < 0.70 else 'middle' if r < 0.92 else 'weak'

        # Parents: two thirds of the children, with a few sibling pairs sharing one parent account
        pcount, kids = 0, [s for s, _ in pairs]
        rng.shuffle(kids)
        linked = kids[:int(len(kids) * 2 / 3)]
        i = 0
        while i < len(linked):
            group = [linked[i]]
            if i + 1 < len(linked) and linked[i + 1].name.split()[-1] == group[0].name.split()[-1]:
                group.append(linked[i + 1])
            i += len(group)
            pcount += 1
            last = group[0].name.split()[-1]
            user = self._user(f'base_p{pcount:03d}', 'PARENT', rng.choice(MALE), last)
            prof = ParentProfile.objects.create(user=user, phone=group[0].parent_phone or phone(rng))
            for k in group:
                ParentChild.objects.create(parent=prof, student=k, school=school, relation='FATHER', is_primary=True)

        # Student attendance, April to 7 November
        days = list(working_days(YEAR_START, LAST_DAY))
        rows = []
        for s, sc in pairs:
            p = {'good': 0.96, 'middle': 0.88, 'weak': 0.72}[quality[s.id]]
            for d in days:
                r = rng.random()
                status = 'PRESENT' if r < p else ('LEAVE' if r < p + (1 - p) * 0.3 else 'ABSENT')
                rows.append(AttendanceRecord(school=school, academic_year=year, student=s, date=d, status=status, source='MANUAL'))
        AttendanceRecord.objects.bulk_create(rows, batch_size=1000)

        # Staff attendance and leave
        srows = []
        for t in teachers:
            for d in days:
                r = rng.random()
                srows.append(StaffAttendance(school=school, staff_member=t, date=d, status='PRESENT' if r < 0.93 else 'LATE' if r < 0.96 else 'ABSENT' if r < 0.98 else 'ON_LEAVE'))
        StaffAttendance.objects.bulk_create(srows, batch_size=1000)
        casual, _ = LeavePolicy.objects.get_or_create(school=school, name='BASE Casual Leave', defaults={'leave_type': 'CASUAL', 'days_allowed': 10})
        sick, _ = LeavePolicy.objects.get_or_create(school=school, name='BASE Sick Leave', defaults={'leave_type': 'SICK', 'days_allowed': 8})
        admin = self._admin_user()
        today = timezone.localdate()
        for who, pol, a, b, status, why in [
            (teachers[0], sick, today + timedelta(days=1), today + timedelta(days=2), 'PENDING', 'Fever'),
            (teachers[3], casual, today + timedelta(days=2), today + timedelta(days=2), 'PENDING', 'Family event'),
            (teachers[5], casual, today + timedelta(days=4), today + timedelta(days=6), 'PENDING', 'Wedding'),
            (teachers[1], sick, date(2026, 10, 12), date(2026, 10, 13), 'APPROVED', 'Flu'),
            (teachers[2], casual, date(2026, 9, 21), date(2026, 9, 21), 'APPROVED', 'Personal'),
            (teachers[4], casual, date(2026, 10, 26), date(2026, 10, 27), 'REJECTED', 'Short notice'),
        ]:
            LeaveApplication.objects.create(school=school, staff_member=who, leave_policy=pol, start_date=a, end_date=b, reason=why, status=status,
                                            approved_by=admin if status != 'PENDING' else None)

        # Exams: a published Mid Term with marks for every student, and a scheduled Final Term
        mid, _ = ExamType.objects.get_or_create(school=school, name='Mid Term')
        final, _ = ExamType.objects.get_or_create(school=school, name='Final Term')
        if not GradeScale.objects.filter(school=school).exists():
            for order, (label, lo, hi, gpa) in enumerate([('A+', 90, 100, 4.0), ('A', 80, 89.99, 3.7), ('B', 70, 79.99, 3.0), ('C', 60, 69.99, 2.0), ('D', 40, 59.99, 1.0), ('F', 0, 39.99, 0)]):
                GradeScale.objects.create(school=school, grade_label=label, min_percentage=lo, max_percentage=hi, gpa_points=gpa, order=order)
        marks = []
        for cname, klass in classes.items():
            exam = Exam.objects.create(school=school, academic_year=year, exam_type=mid, class_obj=klass, name=f'Mid Term - {cname}',
                                       start_date=date(2026, 9, 14), end_date=date(2026, 9, 25), status='PUBLISHED')
            fexam = Exam.objects.create(school=school, academic_year=year, exam_type=final, class_obj=klass, name=f'Final Term - {cname}',
                                        start_date=date(2026, 12, 7), end_date=date(2026, 12, 18), status='SCHEDULED')
            roster = [(s, sc) for s, sc in pairs if sc.class_obj_id == klass.id]
            for k, sname in enumerate(SUBJECTS):
                es = ExamSubject.objects.create(school=school, exam=exam, subject=subjects[sname], total_marks=100, passing_marks=40, exam_date=date(2026, 9, 14) + timedelta(days=k * 2))
                ExamSubject.objects.create(school=school, exam=fexam, subject=subjects[sname], total_marks=100, passing_marks=40, exam_date=date(2026, 12, 7) + timedelta(days=k * 2))
                for s, sc in roster:
                    mean = {'good': 74, 'middle': 62, 'weak': 45}[quality[s.id]]
                    if rng.random() < 0.02:
                        marks.append(StudentMark(school=school, exam_subject=es, student=s, enrollment=enr.get(s.id), is_absent=True))
                    else:
                        marks.append(StudentMark(school=school, exam_subject=es, student=s, enrollment=enr.get(s.id),
                                                 marks_obtained=Decimal(max(3, min(100, int(rng.gauss(mean, 14)))))))
        StudentMark.objects.bulk_create(marks, batch_size=1000)
        return {'year': year.name, 'sections': len(sections), 'students': len(pairs), 'parents': pcount, 'teachers': len(teachers),
                'attendance_rows': len(rows), 'staff_attendance_rows': len(srows), 'marks': len(marks)}

    # ── part B: fees, discounts, expenses, income, payslips ──────────────────

    def part_b(self):
        from academic_sessions.models import StudentEnrollment
        from finance.models import (Account, Discount, Expense, ExpenseCategory, FeePayment, FeeStructure, IncomeCategory, MonthlyFeeCategory,
                                    OtherIncome, Scholarship, StudentDiscount)
        from hr.models import Payslip, SalaryStructure, StaffMember

        school, rng = self.school, self.rng
        if Account.objects.filter(school=school, name='BASE Cash Box').exists():
            return 'part b already done - nothing changed'
        year = self._year()
        cash = Account.objects.create(school=school, organization=self.org, name='BASE Cash Box', account_type='CASH', opening_balance=50000, is_active=True)
        bank = Account.objects.create(school=school, organization=self.org, name='BASE Bank Account', account_type='BANK', opening_balance=400000, is_active=True,
                                      bank_name='Test Bank', account_title='BASE School', account_number='0000000001')
        tuition, _ = MonthlyFeeCategory.objects.get_or_create(school=school, name='BASE Tuition')
        fee_of = {}
        for cname, grade, fee in CLASSES:
            from students.models import Class
            klass = Class.objects.get(school=school, name=cname)
            fee_of[klass.id] = Decimal(fee)
            FeeStructure.objects.create(school=school, academic_year=year, class_obj=klass, fee_type='MONTHLY', monthly_category=tuition, monthly_amount=fee, effective_from=YEAR_START)

        enrolls = list(StudentEnrollment.objects.filter(school=school, academic_year=year, student__admission_number__startswith='BASE-').select_related('student'))
        sibling_disc, _ = Discount.objects.get_or_create(school=school, name='BASE Sibling Discount', defaults={'academic_year': year, 'discount_type': 'PERCENTAGE', 'value': 10})
        merit, _ = Scholarship.objects.get_or_create(school=school, name='BASE Merit Scholarship', defaults={
            'academic_year': year, 'scholarship_type': 'PERCENTAGE', 'coverage': 'TUITION', 'value': 50})
        discounted = {}
        by_last = {}
        for e in enrolls:
            by_last.setdefault(e.student.name.split()[-1], []).append(e.student)
        for kids in by_last.values():
            if len(kids) >= 2 and len(discounted) < 12:
                for k in kids[1:2]:
                    discounted[k.id] = sibling_disc
                    StudentDiscount.objects.create(school=school, student=k, discount=sibling_disc, academic_year=year, is_active=True)
        for e in rng.sample(enrolls, 3):
            StudentDiscount.objects.create(school=school, student=e.student, scholarship=merit, academic_year=year, is_active=True)

        rows = []
        for e in enrolls:
            r = rng.random()
            kind = 'good' if r < 0.70 else 'arrears' if r < 0.85 else 'partial'
            stop_after = rng.choice([6, 7, 8]) if kind == 'arrears' else 10
            due = fee_of[e.class_obj_id] * (Decimal('0.9') if e.student_id in discounted else 1)
            for m in range(4, 12):
                paid, status, method, acct, pdate = Decimal(0), 'UNPAID', 'CASH', None, None
                if kind == 'partial' and m == 10:
                    paid, status = (due / 2).quantize(Decimal('1')), 'PARTIAL'
                elif m <= stop_after and not (m == 11 and kind != 'partial' and rng.random() < 0.6):
                    paid, status = due, 'PAID'
                if paid:
                    method = rng.choice(['CASH', 'BANK_TRANSFER'])
                    acct = cash if method == 'CASH' else bank
                    pdate = date(2026, m, rng.randint(3, 12))
                rows.append(FeePayment(school=school, academic_year=year, student=e.student, fee_type='MONTHLY', monthly_category=tuition, month=m, year=2026,
                                       amount_due=due, base_monthly_fee=fee_of[e.class_obj_id], amount_paid=paid, status=status, payment_date=pdate,
                                       payment_method=method, account=acct))
        FeePayment.objects.bulk_create(rows, batch_size=500)

        cats = {}
        for code, name in [('UTILITIES', 'Utilities'), ('SALARIES', 'Salaries'), ('MAINTENANCE', 'Maintenance'), ('STATIONERY', 'Stationery'), ('EVENTS', 'Events')]:
            # The school may already have the category under another code, and (school, name) is unique: match either.
            cats[code] = (ExpenseCategory.objects.filter(school=school, name__iexact=name).first() or ExpenseCategory.objects.filter(school=school, code=code).first()
                          or ExpenseCategory.objects.create(school=school, name=name, code=code))
        exp = []
        for m in range(4, 12):
            for code, lo, hi in [('UTILITIES', 18000, 32000), ('SALARIES', 520000, 560000), ('MAINTENANCE', 5000, 40000), ('STATIONERY', 4000, 15000)]:
                exp.append(Expense(school=school, category=cats[code], amount=Decimal(rng.randint(lo, hi)), date=date(2026, m, rng.randint(1, 27)),
                                   description=f'{cats[code].name} {date(2026, m, 1):%B}', account=bank if code == 'SALARIES' else cash))
        Expense.objects.bulk_create(exp)
        inc = IncomeCategory.objects.filter(school=school, name__iexact='Donation').first() or IncomeCategory.objects.create(school=school, name='Donation')
        OtherIncome.objects.bulk_create([OtherIncome(school=school, category=inc, amount=Decimal(a), date=d, description='Donation', account=bank)
                                         for a, d in [(50000, date(2026, 5, 14)), (25000, date(2026, 8, 20)), (100000, date(2026, 10, 3))]])

        pays = []
        for s in SalaryStructure.objects.filter(school=school, staff_member__employee_id__startswith='BASE-T'):
            for m in range(4, 11):
                paid = m <= 9
                gross, ded = s.gross_salary, s.total_deductions
                pays.append(Payslip(school=school, staff_member=s.staff_member, month=m, year=2026, basic_salary=s.basic_salary,
                                    total_allowances=gross - s.basic_salary, total_deductions=ded, net_salary=gross - ded,
                                    allowances_breakdown=s.allowances, deductions_breakdown=s.deductions, working_days=22, present_days=21,
                                    status='PAID' if paid else 'APPROVED', payment_date=date(2026, m, 28) if paid else None))
        Payslip.objects.bulk_create(pays)
        return {'fee_records': len(rows), 'expenses': len(exp), 'payslips': len(pays), 'discounts': len(discounted) + 3}

    # ── part C: inventory, library, hostel, transport, enquiries ─────────────

    def part_c(self):
        from academic_sessions.models import StudentEnrollment
        from admissions.models import AdmissionEnquiry, AdmissionNote
        from hostel.models import GatePass, Hostel, HostelAllocation, Room
        from inventory.models import InventoryCategory, InventoryItem, StockTransaction, Vendor
        from library.models import Book, BookCategory, BookIssue
        from transport.models import TransportAssignment, TransportRoute, TransportStop, TransportVehicle

        school, rng = self.school, self.rng
        if Vendor.objects.filter(school=school, name='BASE Ahmad Traders').exists():
            return 'part c already done - nothing changed'
        year = self._year()
        admin = self._admin_user()
        enrolls = list(StudentEnrollment.objects.filter(school=school, academic_year=year, student__admission_number__startswith='BASE-').select_related('student'))

        v1 = Vendor.objects.create(school=school, name='BASE Ahmad Traders', phone=phone(rng))
        v2 = Vendor.objects.create(school=school, name='BASE City Stationers', phone=phone(rng))
        cats = {n: InventoryCategory.objects.filter(school=school, name__iexact=n).first() or InventoryCategory.objects.create(school=school, name=n)
                for n in ('Furniture', 'Stationery', 'Lab', 'Sports', 'Cleaning')}
        spec = [('Student Chair', 'Furniture', 150, 20, 500), ('Student Desk', 'Furniture', 90, 15, 1800), ('Chalk Box', 'Stationery', 6, 10, 120),
                ('Duster', 'Stationery', 14, 5, 60), ('Register Book', 'Stationery', 8, 10, 250), ('Printer Ink Cartridge', 'Stationery', 2, 4, 3200),
                ('Lab Beaker Set', 'Lab', 12, 4, 900), ('Test Tube Pack', 'Lab', 25, 8, 350), ('Bunsen Burner', 'Lab', 4, 2, 1500), ('Football', 'Sports', 5, 2, 1800),
                ('Basketball', 'Sports', 3, 2, 2100), ('Cleaning Liquid', 'Cleaning', 9, 5, 450), ('Light Bulb', 'Furniture', 40, 10, 220),
                ('Extension Cord', 'Furniture', 11, 4, 650), ('Notice Board', 'Furniture', 3, 1, 4200)]
        tx = []
        for name, cat, final, minimum, price in spec:
            item = InventoryItem.objects.filter(school=school, name__iexact=name).first() or InventoryItem.objects.create(
                school=school, category=cats[cat], name=name, unit='PCS', current_stock=0, minimum_stock=minimum, unit_price=price, location='Store room')
            issues = [(date(2026, m, rng.randint(2, 25)), rng.randint(1, max(1, final // 6 + 2))) for m in rng.sample(range(5, 11), 3)]
            bought = final + sum(q for _, q in issues)
            tx.append(StockTransaction(school=school, item=item, transaction_type='PURCHASE', quantity=bought, unit_price=price, total_amount=price * bought,
                                       vendor=rng.choice([v1, v2]), date=date(2026, 4, rng.randint(2, 20)), reference_number=f'BASE-INV-{len(tx) + 1:03d}', recorded_by=admin))
            for d, q in issues:
                tx.append(StockTransaction(school=school, item=item, transaction_type='ISSUE', quantity=-q, unit_price=price, total_amount=price * q, date=d, recorded_by=admin,
                                           remarks='Issued to classroom'))
            InventoryItem.objects.filter(pk=item.pk).update(current_stock=final, minimum_stock=minimum, unit_price=price)
        StockTransaction.objects.bulk_create(tx)

        bcats = [BookCategory.objects.filter(school=school, name__iexact=n).first() or BookCategory.objects.create(school=school, name=n) for n in ('Fiction', 'Science', 'Reference')]
        titles = ['Gulistan', 'Bostan', "Alice's Adventures", 'Robinson Crusoe', 'Tom Sawyer Retold', 'The Jungle Book', 'Kalila wa Dimna', 'Tales of Iqbal',
                  'My First Atlas', 'Basic Science 5', 'Human Body Guide', 'Space Explorer', 'Plants and Animals', 'Maths Is Fun', 'Urdu Qaida Adab', 'English Grammar Made Easy',
                  'Islamic Stories', 'Pakistan Studies Reader', 'World Heroes', 'Dictionary English-Urdu', 'Encyclopedia Junior', 'Poems for Children', 'Great Inventors',
                  'The Little Scientist', 'Quaid-e-Azam Biography']
        books = []
        for i, t in enumerate(titles):
            copies = rng.choice([1, 2, 3, 3])
            books.append(Book.objects.create(school=school, title=t, author=rng.choice(['Saadi', 'Iqbal', 'Various', 'M. Khan', 'S. Ahmed']), category=bcats[i % 3],
                                             total_copies=copies, available_copies=copies, shelf_location=f'R{i % 5 + 1}-S{i % 4 + 1}'))
        today = timezone.localdate()
        borrowers = rng.sample(enrolls, 10)
        plan = ['OVERDUE', 'OVERDUE', 'OVERDUE', 'ISSUED', 'ISSUED', 'ISSUED', 'RETURNED', 'RETURNED', 'RETURNED', 'RETURNED']
        for e, status, book in zip(borrowers, plan, rng.sample(books, 10)):
            due = today - timedelta(days=rng.randint(5, 20)) if status == 'OVERDUE' else today + timedelta(days=rng.randint(3, 12)) if status == 'ISSUED' else today - timedelta(days=rng.randint(10, 40))
            bi = BookIssue.objects.create(school=school, book=book, borrower_type='STUDENT', student=e.student, due_date=due, status=status, issued_by=admin,
                                          return_date=due - timedelta(days=1) if status == 'RETURNED' else None)
            if status != 'RETURNED':
                Book.objects.filter(pk=book.pk).update(available_copies=max(0, book.available_copies - 1))

        hostel = Hostel.objects.create(school=school, name='BASE Iqbal Boys Hostel', hostel_type='BOYS', capacity=24)
        rooms = [Room.objects.create(hostel=hostel, room_number=f'10{i}', floor=1, capacity=4) for i in range(1, 7)]
        boys = [e for e in enrolls if e.student.gender == 'M' and e.class_obj.grade_level == 6][:12]
        allocs = [HostelAllocation.objects.create(school=school, student=e.student, room=rooms[i // 4 % 6], academic_year=year) for i, e in enumerate(boys)]
        now = timezone.now()
        passes = [('PENDING', 'Doctor visit'), ('PENDING', 'Family function'), ('PENDING', 'Eid shopping'), ('PENDING', 'Dental check-up'), ('APPROVED', 'Weekend at home'),
                  ('APPROVED', 'Wedding'), ('RETURNED', 'Day trip')]
        for a, (status, why) in zip(allocs, passes):
            GatePass.objects.create(school=school, student=a.student, allocation=a, pass_type='DAY' if status != 'APPROVED' else 'WEEKEND', reason=why, going_to='Home',
                                    departure_date=now + timedelta(hours=rng.randint(2, 40)), expected_return=now + timedelta(hours=rng.randint(44, 80)), status=status,
                                    approved_by=admin if status != 'PENDING' else None)

        routes = []
        for i, (name, a, b) in enumerate([('Route 1 - Model Town', 'Model Town', 'School'), ('Route 2 - Gulberg', 'Gulberg', 'School'), ('Route 3 - Johar Town', 'Johar Town', 'School')], start=1):
            r = TransportRoute.objects.create(school=school, name=name, start_location=a, end_location=b, estimated_duration_minutes=45)
            stops = [TransportStop.objects.create(route=r, name=f'{a} Stop {k}', stop_order=k, pickup_time=time(6, 30 + 5 * k), drop_time=time(14, 10 + 5 * k)) for k in range(1, 5)]
            veh = TransportVehicle.objects.create(school=school, vehicle_number=f'LEB-{1000 + i}', capacity=30, driver_name=f'Driver {i}', driver_phone=phone(rng), assigned_route=r)
            routes.append((r, stops, veh))
        for e in rng.sample(enrolls, 30):
            r, stops, veh = rng.choice(routes)
            TransportAssignment.objects.create(school=school, academic_year=year, student=e.student, route=r, stop=rng.choice(stops), vehicle=veh, transport_type='BOTH')

        statuses = ['NEW'] * 6 + ['CONFIRMED'] * 4 + ['CONVERTED'] * 2 + ['CANCELLED'] * 3
        converts = iter(rng.sample([e.student for e in enrolls], 2))
        for i, status in enumerate(statuses, start=1):
            first = rng.choice(MALE + FEMALE)
            last = rng.choice(LAST)
            enq = AdmissionEnquiry.objects.create(school=school, name=f'{first} {last}', father_name=f'{rng.choice(MALE)} {last}', mobile=phone(rng), applying_for_grade_level=rng.choice([1, 2, 3, 4, 5, 6]),
                                                  source=rng.choice(['WALK_IN', 'PHONE', 'WEBSITE', 'WHATSAPP', 'REFERRAL']), status=status,
                                                  next_followup_date=today + timedelta(days=rng.randint(1, 10)) if status in ('NEW', 'CONFIRMED') else None,
                                                  converted_student=next(converts) if status == 'CONVERTED' else None)
            if admin:
                AdmissionNote.objects.create(enquiry=enq, user=admin, note='Enquiry received', note_type='SYSTEM')
                if status != 'NEW':
                    AdmissionNote.objects.create(enquiry=enq, user=admin, note='Spoke to the father on the phone', note_type='CALL')
        return {'inventory_items': len(spec), 'stock_transactions': len(tx), 'books': len(books), 'book_issues': 10, 'hostel_rooms': 6, 'gate_passes': len(passes),
                'routes': 3, 'transport_riders': 30, 'enquiries': len(statuses)}
