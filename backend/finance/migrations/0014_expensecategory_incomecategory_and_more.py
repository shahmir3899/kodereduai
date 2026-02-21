# Custom migration: add dynamic category models and convert existing data.

import django.db.models.deletion
from django.db import migrations, models


DEFAULT_EXPENSE_CATEGORIES = [
    ('SALARY', 'Salary'),
    ('RENT', 'Rent'),
    ('UTILITIES', 'Utilities'),
    ('SUPPLIES', 'Supplies'),
    ('MAINTENANCE', 'Maintenance'),
    ('MISC', 'Miscellaneous'),
]

DEFAULT_INCOME_CATEGORIES = [
    ('SALE', 'Sale (Books/Copies/Uniform)'),
    ('DONATION', 'Donation'),
    ('EVENT', 'Event Income'),
    ('MISC', 'Miscellaneous'),
]


def convert_expense_categories(apps, schema_editor):
    """Create ExpenseCategory objects from old string values and link expenses."""
    ExpenseCategory = apps.get_model('finance', 'ExpenseCategory')
    Expense = apps.get_model('finance', 'Expense')

    name_map = dict(DEFAULT_EXPENSE_CATEGORIES)

    # For each school that has expenses, create categories from old strings
    school_ids = list(
        Expense.objects.values_list('school_id', flat=True).distinct()
    )
    for school_id in school_ids:
        cat_codes = list(
            Expense.objects.filter(school_id=school_id)
            .exclude(category_legacy__isnull=True)
            .exclude(category_legacy='')
            .values_list('category_legacy', flat=True)
            .distinct()
        )
        for code in cat_codes:
            name = name_map.get(code, code)
            cat, _ = ExpenseCategory.objects.get_or_create(
                school_id=school_id, name=name,
                defaults={'code': code},
            )
            Expense.objects.filter(
                school_id=school_id, category_legacy=code,
            ).update(category=cat.id)


def convert_income_categories(apps, schema_editor):
    """Create IncomeCategory objects from old string values and link incomes."""
    IncomeCategory = apps.get_model('finance', 'IncomeCategory')
    OtherIncome = apps.get_model('finance', 'OtherIncome')

    name_map = dict(DEFAULT_INCOME_CATEGORIES)

    school_ids = list(
        OtherIncome.objects.values_list('school_id', flat=True).distinct()
    )
    for school_id in school_ids:
        cat_codes = list(
            OtherIncome.objects.filter(school_id=school_id)
            .exclude(category_legacy__isnull=True)
            .exclude(category_legacy='')
            .values_list('category_legacy', flat=True)
            .distinct()
        )
        for code in cat_codes:
            name = name_map.get(code, code)
            cat, _ = IncomeCategory.objects.get_or_create(
                school_id=school_id, name=name,
                defaults={'code': code},
            )
            OtherIncome.objects.filter(
                school_id=school_id, category_legacy=code,
            ).update(category=cat.id)


class Migration(migrations.Migration):

    dependencies = [
        ('finance', '0013_siblinggroup_siblinggroupmember_siblingsuggestion_and_more'),
        ('schools', '0012_school_ai_config'),
    ]

    operations = [
        # 1. Create new models
        migrations.CreateModel(
            name='ExpenseCategory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100)),
                ('code', models.CharField(blank=True, help_text='Short code (e.g. SALARY)', max_length=30)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('school', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='expense_categories', to='schools.school')),
            ],
            options={
                'verbose_name': 'Expense Category',
                'verbose_name_plural': 'Expense Categories',
                'ordering': ['name'],
                'unique_together': {('school', 'name')},
            },
        ),
        migrations.CreateModel(
            name='IncomeCategory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100)),
                ('code', models.CharField(blank=True, help_text='Short code (e.g. SALE)', max_length=30)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('school', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='income_categories', to='schools.school')),
            ],
            options={
                'verbose_name': 'Income Category',
                'verbose_name_plural': 'Income Categories',
                'ordering': ['name'],
                'unique_together': {('school', 'name')},
            },
        ),

        # 2. Remove old indexes that reference the CharField category
        migrations.RemoveIndex(
            model_name='expense',
            name='finance_exp_school__308237_idx',
        ),
        migrations.RemoveIndex(
            model_name='otherincome',
            name='finance_oth_school__a9e303_idx',
        ),

        # 3. Rename old CharField → category_legacy
        migrations.RenameField(
            model_name='expense',
            old_name='category',
            new_name='category_legacy',
        ),
        migrations.RenameField(
            model_name='otherincome',
            old_name='category',
            new_name='category_legacy',
        ),

        # 4. Add new FK field named 'category' (nullable for now)
        migrations.AddField(
            model_name='expense',
            name='category',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='expenses',
                to='finance.expensecategory',
            ),
        ),
        migrations.AddField(
            model_name='otherincome',
            name='category',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='incomes',
                to='finance.incomecategory',
            ),
        ),

        # 5. Data migration: convert old string values to FK references
        migrations.RunPython(
            convert_expense_categories,
            migrations.RunPython.noop,
        ),
        migrations.RunPython(
            convert_income_categories,
            migrations.RunPython.noop,
        ),

        # 6. Remove the legacy CharField columns
        migrations.RemoveField(
            model_name='expense',
            name='category_legacy',
        ),
        migrations.RemoveField(
            model_name='otherincome',
            name='category_legacy',
        ),
    ]
