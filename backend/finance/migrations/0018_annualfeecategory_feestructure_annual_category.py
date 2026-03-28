"""
Add AnnualFeeCategory model and annual_category FK to FeeStructure.

Each school can define its own annual charge categories (School Fee, Sports, Lab Fee, etc.).
"""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('finance', '0017_add_account_owner_field'),
        ('schools', '0014_school_exam_config'),
    ]

    operations = [
        # 1. Create AnnualFeeCategory model
        migrations.CreateModel(
            name='AnnualFeeCategory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(help_text='Display name for this annual charge (e.g. School Fee)', max_length=100)),
                ('description', models.CharField(blank=True, help_text='Optional description', max_length=255)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('school', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='annual_fee_categories',
                    to='schools.school',
                )),
            ],
            options={
                'verbose_name': 'Annual Fee Category',
                'verbose_name_plural': 'Annual Fee Categories',
                'ordering': ['name'],
                'unique_together': {('school', 'name')},
            },
        ),
        # 2. Add annual_category FK to FeeStructure
        migrations.AddField(
            model_name='feestructure',
            name='annual_category',
            field=models.ForeignKey(
                blank=True,
                help_text='Annual charge category (only used when fee_type=ANNUAL)',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='fee_structures',
                to='finance.annualfeecategory',
            ),
        ),
    ]
