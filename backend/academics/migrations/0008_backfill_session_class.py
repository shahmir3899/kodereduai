# Migration to backfill session_class for existing ClassTeacherAssignments

from django.db import migrations


def backfill_session_class(apps, schema_editor):
    """
    For each ClassTeacherAssignment, find or create matching SessionClass and link it.
    
    Strategy:
    - If a SessionClass exists for the same master class and academic year, use it
    - If multiple SessionClasses exist (different sections), use the first one
    - If no SessionClass exists, create one with no section indicator
    - This maintains the current permission behavior while enabling granular UI control
    """
    ClassTeacherAssignment = apps.get_model('academics', 'ClassTeacherAssignment')
    SessionClass = apps.get_model('academic_sessions', 'SessionClass')
    
    total = ClassTeacherAssignment.objects.count()
    print(f"\n[Backfill] Processing {total} ClassTeacherAssignments...")
    
    processed = 0
    linked = 0
    created = 0
    
    for assignment in ClassTeacherAssignment.objects.all():
        processed += 1
        if processed % 100 == 0:
            print(f"  [{processed}/{total}] processed...")
        
        if assignment.session_class_id:
            # Already has session_class
            linked += 1
            continue
        
        # Find SessionClass for this master class
        session_classes = SessionClass.objects.filter(
            school_id=assignment.school_id,
            class_obj_id=assignment.class_obj_id,
            is_active=True,
        ).order_by('-academic_year_id')  # Prefer current/recent year
        
        if session_classes.exists():
            # Link to existing SessionClass (first available)
            assignment.session_class = session_classes.first()
            assignment.save(update_fields=['session_class'])
            linked += 1
        else:
            # Create a new SessionClass for this master class if needed
            year = assignment.academic_year or SessionClass.objects.filter(
                school_id=assignment.school_id,
                is_active=True,
            ).order_by('-academic_year_id').first()
            
            if year:
                session_class = SessionClass.objects.create(
                    school_id=assignment.school_id,
                    academic_year=year,
                    class_obj_id=assignment.class_obj_id,
                    display_name=assignment.class_obj.name,
                    section='',  # No section = entire class
                    grade_level=assignment.class_obj.grade_level,
                    is_active=True,
                )
                assignment.session_class = session_class
                assignment.save(update_fields=['session_class'])
                created += 1
            else:
                # No academic year at all, skip
                print(f"  [WARN] Assignment #{assignment.id} has no SessionClass and no academic year")
    
    print(f"  [Done] {processed} processed, {linked} linked, {created} created")


def reverse_backfill(apps, schema_editor):
    """Reverse: clear session_class field."""
    ClassTeacherAssignment = apps.get_model('academics', 'ClassTeacherAssignment')
    ClassTeacherAssignment.objects.all().update(session_class=None)
    print("\n[Backfill] Cleared all session_class fields")


class Migration(migrations.Migration):
    dependencies = [
        ('academics', '0007_alter_classteacherassignment_options_and_more'),
        ('academic_sessions', '0012_rename_academic_se_school__f1331a_idx_academic_se_school__3d73df_idx_and_more'),
    ]

    operations = [
        migrations.RunPython(backfill_session_class, reverse_backfill),
    ]
