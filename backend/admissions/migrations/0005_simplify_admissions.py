"""
Migration: Simplify admissions module.

- Rename AdmissionEnquiry fields: child_name→name, parent_name→father_name, parent_phone→mobile
- Remove unused fields from AdmissionEnquiry
- Add 'status' field (replaces 'stage')
- Drop unused models: AdmissionSession, AdmissionStageConfig, AdmissionDocument,
  AdmissionFeeRecord, StageChangeLog
- Remove unused note_type choices from AdmissionNote
"""

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('admissions', '0004_stagechangelog'),
    ]

    operations = [
        # ── Step 1: Rename fields (preserves existing data) ──
        migrations.RenameField(
            model_name='admissionenquiry',
            old_name='child_name',
            new_name='name',
        ),
        migrations.RenameField(
            model_name='admissionenquiry',
            old_name='parent_name',
            new_name='father_name',
        ),
        migrations.RenameField(
            model_name='admissionenquiry',
            old_name='parent_phone',
            new_name='mobile',
        ),

        # ── Step 2: Add new 'status' field ──
        migrations.AddField(
            model_name='admissionenquiry',
            name='status',
            field=models.CharField(
                choices=[
                    ('NEW', 'New'),
                    ('CONFIRMED', 'Confirmed'),
                    ('CONVERTED', 'Converted'),
                    ('CANCELLED', 'Cancelled'),
                ],
                default='NEW',
                max_length=20,
            ),
        ),

        # ── Step 3: Migrate stage data to status ──
        migrations.RunSQL(
            sql="""
                UPDATE admissions_admissionenquiry
                SET status = CASE
                    WHEN stage = 'ENROLLED' THEN 'CONVERTED'
                    WHEN stage IN ('REJECTED', 'WITHDRAWN', 'LOST') THEN 'CANCELLED'
                    WHEN stage IN ('ACCEPTED', 'OFFERED', 'FORM_SUBMITTED', 'TEST_DONE') THEN 'CONFIRMED'
                    ELSE 'NEW'
                END;
            """,
            reverse_sql=migrations.RunSQL.noop,
        ),

        # ── Step 4: Remove old fields from AdmissionEnquiry ──
        migrations.RemoveField(model_name='admissionenquiry', name='stage'),
        migrations.RemoveField(model_name='admissionenquiry', name='session'),
        migrations.RemoveField(model_name='admissionenquiry', name='current_stage_config'),
        migrations.RemoveField(model_name='admissionenquiry', name='child_dob'),
        migrations.RemoveField(model_name='admissionenquiry', name='child_gender'),
        migrations.RemoveField(model_name='admissionenquiry', name='previous_school'),
        migrations.RemoveField(model_name='admissionenquiry', name='parent_email'),
        migrations.RemoveField(model_name='admissionenquiry', name='parent_occupation'),
        migrations.RemoveField(model_name='admissionenquiry', name='address'),
        migrations.RemoveField(model_name='admissionenquiry', name='referral_details'),
        migrations.RemoveField(model_name='admissionenquiry', name='assigned_to'),
        migrations.RemoveField(model_name='admissionenquiry', name='priority'),
        migrations.RemoveField(model_name='admissionenquiry', name='metadata'),
        migrations.RemoveField(model_name='admissionenquiry', name='is_fee_paid'),

        # ── Step 5: Update help_text on renamed fields ──
        migrations.AlterField(
            model_name='admissionenquiry',
            name='name',
            field=models.CharField(help_text="Child's name", max_length=100),
        ),
        migrations.AlterField(
            model_name='admissionenquiry',
            name='father_name',
            field=models.CharField(max_length=100),
        ),
        migrations.AlterField(
            model_name='admissionenquiry',
            name='mobile',
            field=models.CharField(max_length=20),
        ),

        # ── Step 6: Update indexes ──
        migrations.RemoveIndex(
            model_name='admissionenquiry',
            name='admissions__school__568020_idx',  # school + stage
        ),
        migrations.RemoveIndex(
            model_name='admissionenquiry',
            name='admissions__parent__c26545_idx',  # parent_phone
        ),
        migrations.AddIndex(
            model_name='admissionenquiry',
            index=models.Index(fields=['school', 'status'], name='admissions__school__status_idx'),
        ),
        migrations.AddIndex(
            model_name='admissionenquiry',
            index=models.Index(fields=['mobile'], name='admissions__mobile__idx'),
        ),

        # ── Step 7: Update AdmissionNote choices ──
        migrations.AlterField(
            model_name='admissionnote',
            name='note_type',
            field=models.CharField(
                choices=[
                    ('NOTE', 'Note'),
                    ('CALL', 'Phone Call'),
                    ('STATUS_CHANGE', 'Status Change'),
                    ('SYSTEM', 'System'),
                ],
                default='NOTE',
                max_length=20,
            ),
        ),

        # ── Step 8: Drop unused models ──
        migrations.DeleteModel(name='StageChangeLog'),
        migrations.DeleteModel(name='AdmissionFeeRecord'),
        migrations.DeleteModel(name='AdmissionDocument'),
        migrations.DeleteModel(name='AdmissionStageConfig'),
        migrations.DeleteModel(name='AdmissionSession'),
    ]
