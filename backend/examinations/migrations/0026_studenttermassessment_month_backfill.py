from django.db import migrations, models
import django.core.validators


def backfill_month_and_dedupe(apps, schema_editor):
    StudentTermAssessment = apps.get_model('examinations', 'StudentTermAssessment')
    db_alias = schema_editor.connection.alias

    rating_fields = [
        'listening', 'speaking', 'writing', 'reading',
        'participation', 'confidence', 'social_skills',
        'discipline', 'respect', 'teamwork', 'class_participation', 'responsibility',
    ]
    text_fields = ['teacher_remark', 'principal_remark']

    # 1) Backfill month from updated_at (fallback created_at, then Jan=1 for safety).
    base_qs = StudentTermAssessment.objects.using(db_alias).all().order_by('id')
    for row in base_qs.iterator(chunk_size=1000):
        if row.month is not None:
            continue
        dt = row.updated_at or row.created_at
        row.month = dt.month if dt else 1
        row.save(update_fields=['month'])

    # 2) Deduplicate by (student, academic_year, month), keeping latest updated_at row.
    dedupe_qs = (
        StudentTermAssessment.objects.using(db_alias)
        .all()
        .order_by('student_id', 'academic_year_id', 'month', '-updated_at', '-id')
    )

    current_key = None
    keeper = None

    for row in dedupe_qs.iterator(chunk_size=1000):
        key = (row.student_id, row.academic_year_id, row.month)
        if key != current_key:
            current_key = key
            keeper = row
            continue

        update_fields = []

        for field in rating_fields:
            keeper_val = getattr(keeper, field)
            row_val = getattr(row, field)
            if keeper_val is None and row_val is not None:
                setattr(keeper, field, row_val)
                update_fields.append(field)

        for field in text_fields:
            keeper_val = (getattr(keeper, field) or '').strip()
            row_val = (getattr(row, field) or '').strip()
            if not keeper_val and row_val:
                setattr(keeper, field, row_val)
                update_fields.append(field)

        if keeper.updated_by_id is None and row.updated_by_id is not None:
            keeper.updated_by_id = row.updated_by_id
            update_fields.append('updated_by')

        if keeper.term_id is None and row.term_id is not None:
            keeper.term_id = row.term_id
            update_fields.append('term')

        if update_fields:
            keeper.save(update_fields=sorted(set(update_fields)))

        row.delete()


def noop_reverse(apps, schema_editor):
    # Intentionally no-op: backfill/dedupe is not safely reversible.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('examinations', '0025_studenttermassessment'),
    ]

    operations = [
        migrations.AddField(
            model_name='studenttermassessment',
            name='month',
            field=models.PositiveSmallIntegerField(
                blank=True,
                null=True,
                help_text='Assessment month (1-12). Null temporarily for legacy rows before backfill.',
                validators=[
                    django.core.validators.MinValueValidator(1),
                    django.core.validators.MaxValueValidator(12),
                ],
            ),
        ),
        migrations.RunPython(backfill_month_and_dedupe, noop_reverse),
    ]
