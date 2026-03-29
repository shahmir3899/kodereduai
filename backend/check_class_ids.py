#!/usr/bin/env python
"""Check actual class objects."""
import os, sys, django
sys.path.insert(0, '.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from students.models import Class

print("All Class 2, 4, 5 objects:")
for cls in [2, 4, 5]:
    classes = Class.objects.filter(name=f'Class {cls}')
    print(f"\nClass {cls}:")
    for c in classes:
        print(f"  ID {c.id}: {c.name} (section={c.section})")
