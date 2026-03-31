"""
Data migration: Clean up duplicate annual fee categories for School 1.

Before this migration (School 1 categories):
  ID=1 "Admissions"       → 0 payments, 1 structure (Playgroup@8100) — duplicate of "Admission Fee"
  ID=2 "Annual"           → 0 payments, 7 structures (@4600/class)  — unique charge, renamed to "School Fee"
  ID=3 "Books"            → 0 payments, 7 structures               — duplicate of "Books & Stationery"
  ID=4 "Admission Fee"    → 32 payments, 9 structures              — KEEP (migrated data)
  ID=6 "Books & Stationery" → 0 payments, 9 structures             — KEEP (migrated data)

After:
  ID=2 "School Fee"       → 7 structures (renamed from "Annual")
  ID=4 "Admission Fee"    → 32 payments, 9 structures
  ID=6 "Books & Stationery" → 9 structures
  IDs 1,3 deleted (orphan structures removed first)
"""
from django.db import migrations


def cleanup_duplicate_categories(apps, schema_editor):
    AnnualFeeCategory = apps.get_model('finance', 'AnnualFeeCategory')
    FeeStructure = apps.get_model('finance', 'FeeStructure')
    FeePayment = apps.get_model('finance', 'FeePayment')

    # --- School 1 cleanup ---
    school_id = 1

    # 1) "Admissions" (ID=1): duplicate of "Admission Fee" (ID=4)
    #    Delete its 1 structure (exact duplicate exists under ID=4), then delete category
    try:
        admissions_cat = AnnualFeeCategory.objects.get(id=1, school_id=school_id, name='Admissions')
        payments_count = FeePayment.objects.filter(annual_category=admissions_cat).count()
        if payments_count == 0:
            deleted_structs = FeeStructure.objects.filter(annual_category=admissions_cat).delete()[0]
            admissions_cat.delete()
            print(f'  Deleted "Admissions" (ID=1): {deleted_structs} structures removed')
        else:
            print(f'  SKIPPED "Admissions" (ID=1): has {payments_count} payments — not safe')
    except AnnualFeeCategory.DoesNotExist:
        print('  "Admissions" (ID=1) not found — already cleaned or different data')

    # 2) "Annual" (ID=2): unique charge @4600/class — rename to "School Fee"
    try:
        annual_cat = AnnualFeeCategory.objects.get(id=2, school_id=school_id, name='Annual')
        annual_cat.name = 'School Fee'
        annual_cat.description = 'Renamed from "Annual" during category cleanup'
        annual_cat.save()
        struct_count = FeeStructure.objects.filter(annual_category=annual_cat).count()
        print(f'  Renamed "Annual" (ID=2) → "School Fee": {struct_count} structures preserved')
    except AnnualFeeCategory.DoesNotExist:
        print('  "Annual" (ID=2) not found — already cleaned or different data')

    # 3) "Books" (ID=3): duplicate of "Books & Stationery" (ID=6)
    #    Delete its 7 structures (all overlap), then delete category
    try:
        books_cat = AnnualFeeCategory.objects.get(id=3, school_id=school_id, name='Books')
        payments_count = FeePayment.objects.filter(annual_category=books_cat).count()
        if payments_count == 0:
            deleted_structs = FeeStructure.objects.filter(annual_category=books_cat).delete()[0]
            books_cat.delete()
            print(f'  Deleted "Books" (ID=3): {deleted_structs} structures removed')
        else:
            print(f'  SKIPPED "Books" (ID=3): has {payments_count} payments — not safe')
    except AnnualFeeCategory.DoesNotExist:
        print('  "Books" (ID=3) not found — already cleaned or different data')


def reverse_cleanup(apps, schema_editor):
    """
    Cannot fully reverse (deleted structures are gone), but recreate the categories
    so the migration can be unapplied without error.
    """
    AnnualFeeCategory = apps.get_model('finance', 'AnnualFeeCategory')

    # Recreate deleted categories (without structures — those are lost)
    AnnualFeeCategory.objects.get_or_create(
        id=1, defaults={'school_id': 1, 'name': 'Admissions', 'description': ''}
    )
    AnnualFeeCategory.objects.get_or_create(
        id=3, defaults={'school_id': 1, 'name': 'Books', 'description': ''}
    )

    # Rename "School Fee" back to "Annual"
    try:
        cat = AnnualFeeCategory.objects.get(id=2, school_id=1)
        cat.name = 'Annual'
        cat.description = ''
        cat.save()
    except AnnualFeeCategory.DoesNotExist:
        pass


class Migration(migrations.Migration):

    dependencies = [
        ('finance', '0021_migrate_deprecated_fee_types_to_annual'),
    ]

    operations = [
        migrations.RunPython(cleanup_duplicate_categories, reverse_cleanup),
    ]
