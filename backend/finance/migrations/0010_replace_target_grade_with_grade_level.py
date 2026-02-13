"""
Replace Discount.target_grade FK with target_grade_level IntegerField.
Also update applies_to choice from 'GRADE' to 'GRADE_LEVEL'.
"""

from django.db import migrations, models


def copy_target_grade_to_level(apps, schema_editor):
    """Copy target_grade.numeric_level → target_grade_level for existing discounts."""
    Discount = apps.get_model('finance', 'Discount')
    for discount in Discount.objects.select_related('target_grade').filter(
        target_grade__isnull=False
    ):
        discount.target_grade_level = discount.target_grade.numeric_level
        # Also update applies_to from GRADE to GRADE_LEVEL
        if discount.applies_to == 'GRADE':
            discount.applies_to = 'GRADE_LEVEL'
        discount.save(update_fields=['target_grade_level', 'applies_to'])

    # Update any remaining GRADE → GRADE_LEVEL
    Discount.objects.filter(applies_to='GRADE').update(applies_to='GRADE_LEVEL')


class Migration(migrations.Migration):

    dependencies = [
        ('finance', '0009_discount_onlinepayment_paymentgatewayconfig_and_more'),
        ('students', '0005_studentinvite_studentprofile'),
    ]

    operations = [
        # 1. Add new field alongside old FK
        migrations.AddField(
            model_name='discount',
            name='target_grade_level',
            field=models.IntegerField(
                null=True,
                blank=True,
                help_text='Grade level to apply discount to (when applies_to=GRADE_LEVEL)',
            ),
        ),

        # 2. Copy data
        migrations.RunPython(
            copy_target_grade_to_level,
            reverse_code=migrations.RunPython.noop,
        ),

        # 3. Remove old FK
        migrations.RemoveField(
            model_name='discount',
            name='target_grade',
        ),

        # 4. Update applies_to choices
        migrations.AlterField(
            model_name='discount',
            name='applies_to',
            field=models.CharField(
                choices=[
                    ('ALL', 'All Students'),
                    ('GRADE_LEVEL', 'All classes at a grade level'),
                    ('CLASS', 'Specific Class'),
                    ('STUDENT', 'Individual Student'),
                    ('SIBLING', 'Siblings (auto-detect)'),
                ],
                default='ALL',
                max_length=20,
            ),
        ),
    ]
