"""
Data migration: populate existing schools and organizations with proper module keys.

Existing schools may have enabled_modules = {} or old-format like
{ "attendance_ai": true, "whatsapp": false }. This migration sets them
to the canonical module format with all modules enabled by default.

Existing organizations that already got the default via AddField should be fine,
but we double-check and fill any missing keys.
"""

from django.db import migrations

# Hardcoded here so the migration is self-contained
# (never import live application code in migrations)
ALL_MODULE_KEYS = [
    'attendance', 'finance', 'hr', 'academics',
    'examinations', 'students', 'notifications',
]


def populate_module_defaults(apps, schema_editor):
    School = apps.get_model('schools', 'School')
    Organization = apps.get_model('schools', 'Organization')

    default_modules = {key: True for key in ALL_MODULE_KEYS}

    # Fix schools: if enabled_modules is missing any of the canonical keys,
    # set all canonical keys to True (preserving backward compat)
    for school in School.objects.all():
        modules = school.enabled_modules or {}
        has_new_keys = any(key in modules for key in ALL_MODULE_KEYS)
        if not has_new_keys:
            # Old format or empty — set all modules enabled
            school.enabled_modules = {**default_modules}
            school.save(update_fields=['enabled_modules'])
        else:
            # Has some new keys but might be missing others — fill gaps
            changed = False
            for key in ALL_MODULE_KEYS:
                if key not in modules:
                    modules[key] = True
                    changed = True
            if changed:
                school.enabled_modules = modules
                school.save(update_fields=['enabled_modules'])

    # Fix organizations: fill any missing keys
    for org in Organization.objects.all():
        modules = org.allowed_modules or {}
        changed = False
        for key in ALL_MODULE_KEYS:
            if key not in modules:
                modules[key] = True
                changed = True
        if changed:
            org.allowed_modules = modules
            org.save(update_fields=['allowed_modules'])


class Migration(migrations.Migration):

    dependencies = [
        ('schools', '0008_add_organization_allowed_modules'),
    ]

    operations = [
        migrations.RunPython(
            populate_module_defaults,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
