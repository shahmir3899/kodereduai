"""
Data migration: Convert ADMISSION/BOOKS/FINE → ANNUAL + AnnualFeeCategory.

For each school that has records with deprecated fee types:
1. Create corresponding AnnualFeeCategory entries (Admission Fee, Books & Stationery, Fine)
2. Update FeeStructure records: fee_type → ANNUAL, set annual_category FK
3. Update FeePayment records: fee_type → ANNUAL, set annual_category FK
"""
from django.db import migrations


# Mapping: old fee_type → category name
FEE_TYPE_CATEGORY_MAP = {
    'ADMISSION': 'Admission Fee',
    'BOOKS': 'Books & Stationery',
    'FINE': 'Fine',
}


def migrate_deprecated_to_annual(apps, schema_editor):
    FeePayment = apps.get_model('finance', 'FeePayment')
    FeeStructure = apps.get_model('finance', 'FeeStructure')
    AnnualFeeCategory = apps.get_model('finance', 'AnnualFeeCategory')

    for old_type, cat_name in FEE_TYPE_CATEGORY_MAP.items():
        # Find all schools that have records with this deprecated fee type
        fp_school_ids = set(
            FeePayment.objects.filter(fee_type=old_type)
            .values_list('school_id', flat=True).distinct()
        )
        fs_school_ids = set(
            FeeStructure.objects.filter(fee_type=old_type)
            .values_list('school_id', flat=True).distinct()
        )
        all_school_ids = fp_school_ids | fs_school_ids

        for school_id in all_school_ids:
            # Create or get the category for this school
            cat, _ = AnnualFeeCategory.objects.get_or_create(
                school_id=school_id,
                name=cat_name,
                defaults={'description': f'Migrated from {old_type} fee type', 'is_active': True},
            )

            # Update FeeStructure records
            FeeStructure.objects.filter(
                school_id=school_id, fee_type=old_type,
            ).update(fee_type='ANNUAL', annual_category=cat)

            # Update FeePayment records
            FeePayment.objects.filter(
                school_id=school_id, fee_type=old_type,
            ).update(fee_type='ANNUAL', annual_category=cat)


def reverse_migration(apps, schema_editor):
    """Reverse: convert back from ANNUAL + category to the original deprecated types."""
    FeePayment = apps.get_model('finance', 'FeePayment')
    FeeStructure = apps.get_model('finance', 'FeeStructure')
    AnnualFeeCategory = apps.get_model('finance', 'AnnualFeeCategory')

    # Reverse mapping
    CATEGORY_FEE_TYPE_MAP = {v: k for k, v in FEE_TYPE_CATEGORY_MAP.items()}

    for cat_name, old_type in CATEGORY_FEE_TYPE_MAP.items():
        cats = AnnualFeeCategory.objects.filter(name=cat_name)
        for cat in cats:
            FeeStructure.objects.filter(
                annual_category=cat, fee_type='ANNUAL',
            ).update(fee_type=old_type, annual_category=None)

            FeePayment.objects.filter(
                annual_category=cat, fee_type='ANNUAL',
            ).update(fee_type=old_type, annual_category=None)


class Migration(migrations.Migration):

    dependencies = [
        ('finance', '0020_add_annual_category_to_feepayment'),
    ]

    operations = [
        migrations.RunPython(migrate_deprecated_to_annual, reverse_migration),
    ]
