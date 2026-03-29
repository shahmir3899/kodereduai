#!/usr/bin/env python
"""Check if ClassPromotion mappings and target classes were set up."""
import os
import sys
import django

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from academic_sessions.models import ClassPromotion, StudentEnrollment

print("Checking ClassPromotion mappings...")
print("=" * 80)

promotions = ClassPromotion.objects.all()
print(f"Total ClassPromotion records: {promotions.count()}\n")

for p in promotions:
    target = p.target_class.name if p.target_class else "NOT SET"
    print(f"  {p.source_class.name} → {target}")

print(f"\n\nChecking if any students have target_class_for_promotion set...")
print("=" * 80)

students_with_target = StudentEnrollment.objects.filter(
    status='PROMOTED',
    target_class_for_promotion__isnull=False
).count()
print(f"Students marked PROMOTED with target_class_for_promotion: {students_with_target}")

total_promoted = StudentEnrollment.objects.filter(status='PROMOTED').count()
print(f"Total PROMOTED students: {total_promoted}")
print(f"Missing target class: {total_promoted - students_with_target}")
