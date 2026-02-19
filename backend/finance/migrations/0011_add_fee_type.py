"""
Add fee_type field to FeeStructure and FeePayment models.

Supports five fee types: MONTHLY (default), ANNUAL, ADMISSION, BOOKS, FINE.
All existing rows default to MONTHLY for backward compatibility.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('finance', '0010_replace_target_grade_with_grade_level'),
    ]

    operations = [
        # 1. Add fee_type to FeeStructure
        migrations.AddField(
            model_name='feestructure',
            name='fee_type',
            field=models.CharField(
                choices=[
                    ('MONTHLY', 'Monthly'),
                    ('ANNUAL', 'Annual'),
                    ('ADMISSION', 'Admission'),
                    ('BOOKS', 'Books'),
                    ('FINE', 'Fine'),
                ],
                default='MONTHLY',
                help_text='Type of fee: monthly recurring, annual, one-time admission, books, or fine',
                max_length=20,
            ),
        ),
        # 2. Add fee_type to FeePayment
        migrations.AddField(
            model_name='feepayment',
            name='fee_type',
            field=models.CharField(
                choices=[
                    ('MONTHLY', 'Monthly'),
                    ('ANNUAL', 'Annual'),
                    ('ADMISSION', 'Admission'),
                    ('BOOKS', 'Books'),
                    ('FINE', 'Fine'),
                ],
                default='MONTHLY',
                help_text='Type of fee this payment record belongs to',
                max_length=20,
            ),
        ),
        # 3. Update unique_together on FeePayment to include fee_type
        migrations.AlterUniqueTogether(
            name='feepayment',
            unique_together={('school', 'student', 'month', 'year', 'fee_type')},
        ),
        # 4. Add index on (school, fee_type) for FeePayment
        migrations.AddIndex(
            model_name='feepayment',
            index=models.Index(fields=['school', 'fee_type'], name='finance_fee_school_feetype_idx'),
        ),
    ]
