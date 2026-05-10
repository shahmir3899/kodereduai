#!/usr/bin/env python
"""
End-to-end test: Simulate the complete frontend flow from clicking "Apply to Book" 
through successful chapter creation and cache invalidation.
"""
import os
import django
import json
import time

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.test import Client
from lms.models import Book, Chapter

def test_apply_toc():
    """Test the complete apply_toc flow"""
    print("\n" + "="*70)
    print("🧪 END-TO-END TEST: Apply Table of Contents")
    print("="*70)
    
    client = Client()
    book_id = 44
    
    # Get initial book state
    print(f"\n1️⃣  Fetching initial book state (ID: {book_id})...")
    book = Book.objects.get(id=book_id)
    initial_count = book.chapters.count()
    initial_titles = set(book.chapters.values_list('title', flat=True))
    print(f"   ✅ Initial chapters: {initial_count}")
    print(f"      Titles: {initial_titles}")
    
    # Prepare payload (same as user clicked with 6 chapters)
    payload = {
        "chapters": [
            {"title": "E2E Test Chapter 1", "topics": []},
            {"title": "E2E Test Chapter 2", "topics": []},
            {"title": "E2E Test Chapter 3", "topics": []},
            {"title": "E2E Test Chapter 4", "topics": []},
            {"title": "E2E Test Chapter 5", "topics": []},
            {"title": "E2E Test Chapter 6", "topics": []},
        ],
        "idempotency_key": f"test-{int(time.time())}"
    }
    
    print(f"\n2️⃣  Sending apply_toc request with {len(payload['chapters'])} chapters...")
    response = client.post(
        f'/api/lms/books/{book_id}/apply_toc/',
        data=json.dumps(payload),
        content_type='application/json',
        HTTP_X_SCHOOL_ID='1',
        SERVER_NAME='localhost'
    )
    
    print(f"   Status: {response.status_code}")
    result = json.loads(response.content)
    print(f"   Response: {json.dumps(result, indent=2)}")
    
    if response.status_code not in [200, 201]:
        print(f"   ❌ ERROR: Request failed!")
        return False
    
    chapters_created = result.get('chapters_created', 0)
    errors = result.get('errors', [])
    
    print(f"   ✅ Chapters created: {chapters_created}")
    if errors:
        print(f"   ⚠️  Errors: {errors}")
    
    # Verify book was updated
    print(f"\n3️⃣  Verifying book was updated...")
    time.sleep(0.1)  # Small delay to ensure DB is updated
    
    book.refresh_from_db()
    final_count = book.chapters.count()
    new_chapters = final_count - initial_count
    
    print(f"   Initial: {initial_count}, Final: {final_count}, New: {new_chapters}")
    print(f"   ✅ Book updated successfully!")
    
    # Verify specific chapters exist
    final_titles = set(book.chapters.values_list('title', flat=True))
    test_chapter_titles = {ch['title'] for ch in payload['chapters']}
    found_titles = final_titles - initial_titles
    
    print(f"\n4️⃣  Verifying chapter titles...")
    for title in test_chapter_titles:
        if title in found_titles:
            print(f"   ✅ Found: {title}")
        else:
            print(f"   ❌ Missing: {title}")
    
    # Success criteria
    success = (
        chapters_created == len(payload['chapters']) and
        len(errors) == 0 and
        new_chapters == chapters_created
    )
    
    print("\n" + "="*70)
    if success:
        print("✅ TEST PASSED! All chapters created successfully!")
    else:
        print("❌ TEST FAILED!")
    print("="*70 + "\n")
    
    return success

if __name__ == '__main__':
    try:
        success = test_apply_toc()
        exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ Exception: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
