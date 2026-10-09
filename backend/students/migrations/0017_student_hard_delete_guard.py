from django.db import migrations

# Postgres only: SQLite (local dev, tests) has no equivalent and the soft-delete
# model layer is the only guard there.
CREATE = """
CREATE OR REPLACE FUNCTION students_block_hard_delete() RETURNS trigger AS $$
BEGIN
    IF current_setting('app.allow_student_hard_delete', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Deleting students is blocked: soft-delete them (Student.soft_delete) or use core.db_guards.allow_student_hard_delete().'
        USING ERRCODE = '23001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS students_student_block_delete ON students_student;
CREATE TRIGGER students_student_block_delete
    BEFORE DELETE ON students_student
    FOR EACH ROW EXECUTE FUNCTION students_block_hard_delete();
"""

DROP = """
DROP TRIGGER IF EXISTS students_student_block_delete ON students_student;
DROP FUNCTION IF EXISTS students_block_hard_delete();
"""


def create_guard(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute(CREATE)


def drop_guard(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute(DROP)


class Migration(migrations.Migration):

    dependencies = [
        ('students', '0016_student_soft_delete'),
    ]

    operations = [
        migrations.RunPython(create_guard, drop_guard),
    ]
