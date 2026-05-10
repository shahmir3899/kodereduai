#!/usr/bin/env python
"""
Test script to verify the apply_toc fix works correctly.
This simulates what the frontend does when clicking "Apply to Book".
"""
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from lms.models import Book, Chapter
from lms.toc_parser import apply_toc_structure

# Test data
book = Book.objects.get(id=44)
print(f"\n📚 Testing book: {book.title} (ID: {book.id})")
print(f"📊 Current chapters: {book.chapters.count()}")

existing_chapters = list(book.chapters.all().values_list('chapter_number', 'title'))
print(f"   Chapter numbers: {[ch[0] for ch in existing_chapters]}")
print(f"   Max chapter_number: {max([ch[0] for ch in existing_chapters]) if existing_chapters else 'N/A'}")

# New chapters to add (same as what user tried)
new_chapters = [
    {"title": "Culture", "topics": []},
    {"title": "Our Heroes", "topics": []},
    {"title": "Physical Features of Pakistan", "topics": []},
    {"title": "Population", "topics": []},
    {"title": "Land and People", "topics": []},
    {"title": "Weather and Climate", "topics": []},
]

print(f"\n✅ Attempting to add {len(new_chapters)} new chapters...")
print("-" * 60)

result = apply_toc_structure(book, new_chapters)

print("-" * 60)
print(f"\n📈 Result:")
print(f"   Chapters created: {result['chapters_created']}")
print(f"   Topics created: {result['topics_created']}")
print(f"   Errors: {len(result['errors'])}")
if result['errors']:
    print(f"   Error details:")
    for error in result['errors']:
        print(f"     - {error}")

# Verify
book.refresh_from_db()
new_chapters_list = list(book.chapters.all().values_list('chapter_number', 'title').order_by('chapter_number'))
print(f"\n📚 Book now has {book.chapters.count()} chapters total:")
for ch_num, ch_title in new_chapters_list:
    print(f"   Ch {ch_num}: {ch_title}")

if result['chapters_created'] == len(new_chapters):
    print(f"\n✅ SUCCESS! All {len(new_chapters)} chapters created without errors!")
else:
    print(f"\n❌ FAILED! Only {result['chapters_created']}/{len(new_chapters)} chapters created.")
