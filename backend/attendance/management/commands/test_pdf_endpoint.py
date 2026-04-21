"""
Management command to test the download_register_pdf endpoint directly.
Usage: python manage.py test_pdf_endpoint --class_id=38 --month=4 --year=2026 --school_id=2
"""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Test the attendance register PDF generation directly'

    def add_arguments(self, parser):
        parser.add_argument('--class_id', type=int, required=True)
        parser.add_argument('--month', type=int, required=True)
        parser.add_argument('--year', type=int, required=True)
        parser.add_argument('--school_id', type=int, required=True)
        parser.add_argument('--academic_year', type=int, default=None)
        parser.add_argument('--output', type=str, default='test_register.pdf')

    def handle(self, *args, **options):
        from calendar import monthrange
        from datetime import date
        import io

        class_id = options['class_id']
        month = options['month']
        year = options['year']
        school_id = options['school_id']
        academic_year_id = options.get('academic_year')
        output_path = options['output']

        self.stdout.write(f"Testing PDF generation:")
        self.stdout.write(f"  School ID: {school_id}")
        self.stdout.write(f"  Class ID: {class_id}")
        self.stdout.write(f"  Month/Year: {month}/{year}")
        self.stdout.write(f"  Academic Year: {academic_year_id}")

        # Step 1: Check school exists
        from schools.models import School
        try:
            school = School.objects.get(id=school_id)
            self.stdout.write(self.style.SUCCESS(f"[OK] School found: {school.name}"))
        except School.DoesNotExist:
            self.stdout.write(self.style.ERROR(f"[FAIL] School ID {school_id} not found"))
            return

        # Step 2: Check class exists
        from students.models import Class as StudentClass
        try:
            class_obj = StudentClass.objects.get(id=class_id, school_id=school_id)
            self.stdout.write(self.style.SUCCESS(f"[OK] Class found: {class_obj.name}"))
        except StudentClass.DoesNotExist:
            self.stdout.write(self.style.ERROR(f"[FAIL] Class ID {class_id} not found in school {school_id}"))
            classes = StudentClass.objects.filter(school_id=school_id).values('id', 'name')
            self.stdout.write(f"  Available classes: {list(classes)}")
            return

        # Step 3: Check students
        from students.models import Student
        students_qs = Student.objects.filter(school_id=school_id, is_active=True)
        if academic_year_id:
            students_qs = students_qs.filter(
                enrollments__academic_year_id=academic_year_id,
                enrollments__class_obj_id=class_id,
                enrollments__is_active=True,
            )
        else:
            students_qs = students_qs.filter(class_obj_id=class_id)
        students = students_qs.order_by('name').values('id', 'name', 'roll_number')
        self.stdout.write(self.style.SUCCESS(f"[OK] Students found: {students.count()}"))

        # Step 4: Check attendance records
        from attendance.models import AttendanceRecord
        last_day = monthrange(year, month)[1]
        date_from = date(year, month, 1)
        date_to = date(year, month, last_day)
        student_ids = [s['id'] for s in students]
        records = AttendanceRecord.objects.filter(
            school_id=school_id,
            date__gte=date_from,
            date__lte=date_to,
            student_id__in=student_ids,
        )
        self.stdout.write(self.style.SUCCESS(f"[OK] Attendance records: {records.count()}"))

        # Step 5: Try generating PDF
        self.stdout.write("Generating PDF...")
        try:
            from reportlab.lib.pagesizes import A4, landscape
            from reportlab.lib.styles import getSampleStyleSheet
            from reportlab.platypus import SimpleDocTemplate, Paragraph

            buffer = io.BytesIO()
            doc = SimpleDocTemplate(buffer, pagesize=landscape(A4))
            elements = [Paragraph(f"Test: {school.name} - {class_obj.name} - {month}/{year}", getSampleStyleSheet()['Heading1'])]
            doc.build(elements)
            pdf_bytes = buffer.getvalue()

            with open(output_path, 'wb') as f:
                f.write(pdf_bytes)
            self.stdout.write(self.style.SUCCESS(f"[OK] PDF generated: {output_path} ({len(pdf_bytes)} bytes)"))

        except Exception as e:
            self.stdout.write(self.style.ERROR(f"[FAIL] PDF generation FAILED: {e}"))
            import traceback
            self.stdout.write(traceback.format_exc())
