from finance.models import FeeRecord, Class, AcademicYear
from django.db.models import Count

print("=== Academic Year ===")
ay = AcademicYear.objects.get(year=2026)
print(ay)

print("\n=== Class 5 objects ===")
class5 = Class.objects.filter(name__icontains='5')
for c in class5:
    print(f"ID: {c.id}, Name: {c.name}")

print("\n=== Fee Records for Class 5 in 2026 ===")
fee_records = FeeRecord.objects.filter(class_obj__in=class5, academic_year=ay)
print(f"Total Fee Records: {fee_records.count()}")
for fr in fee_records:
    print(f"ID: {fr.id}, FeeType: {fr.fee_type}, Class: {fr.class_obj}, Amount: {fr.amount}, Category: {fr.category}")

print("\n=== Grouped by Fee Type and Class ===")
for row in fee_records.values('fee_type', 'class_obj').annotate(count=Count('id')):
    print(row)