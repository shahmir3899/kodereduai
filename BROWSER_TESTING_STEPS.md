# 🧪 FRONTEND TESTING INSTRUCTIONS

## ✅ Current Status
- **Backend Fix**: Active (using `Max('chapter_number')` instead of `count()`)
- **Backend Server**: Running on http://localhost:8000
- **Book Status**: English (ID: 44) has 13 chapters, next will be #17
- **Ready for**: Frontend UI testing

## 📋 Test Steps

### Step 1: Open the App
1. Open browser → http://localhost:3000/lms/curriculum
2. You should see the LMS Curriculum page
3. The book **"English by Prof Dr Shazia Naeem"** should already be selected

### Step 2: Click "Import Table of Contents"
1. Look for the "Import Table of Contents" button (should be near top of book details)
2. Click it
3. The 5-step wizard modal should appear

### Step 3: Upload or Use Existing Image
- **Option A**: Upload a book image with chapters visible
- **Option B**: If you have a previous upload, use the image from Step 1 (already cropped)

### Step 4: Proceed Through Steps
Follow the wizard:
1. **Step 1** - Upload image
2. **Step 3** - Crop/rotate as needed
3. **Step 4** - Review OCR text
4. **Step 5** - Review chapter extraction
5. **Step 6** - Click **"Apply to Book"** button

### Step 5: Verify Success
After clicking "Apply to Book":
- ✅ Green toast should appear: "Table of contents imported"
- ✅ Modal should close
- ✅ Page should refresh and show new chapters in the book

### Step 6: Confirm Chapters Were Created
1. Look at the "Chapters" section below the book
2. Scroll down to see the new chapters
3. Should see new chapters #17, #18, #19, etc. (depending on how many were in the wizard)

## 🔍 Troubleshooting

### If Nothing Happens
1. Check browser **Developer Tools** → **Network** tab
2. Look for POST request to `/api/lms/books/44/apply_toc/`
3. Check response status and message
4. Check **Console** tab for any JavaScript errors

### If You See an Error
1. Check the error message in the toast
2. Check browser console for full error details
3. Check Django server logs (Terminal window with backend)

### If Chapters Don't Show Up
1. Hard refresh browser (Ctrl+F5 or Cmd+Shift+R)
2. Click on another book, then back to English
3. Check Django logs for any errors

## 📊 Expected Results

**Before clicking "Apply to Book":**
- Book: English
- Chapters: 13 total (Ch 3, 5-16)
- Max chapter_number: 16

**After clicking "Apply to Book"** (with 6 new chapters):
- Chapters: 19 total (Ch 3, 5-16, 17-22)
- New chapters should show with auto-generated titles or from OCR

**In Django logs**, you should see:
```
[apply_toc_structure] Starting for book 44, max chapter_number: 16, incoming: 6
[apply_toc_structure] Creating chapters starting from number: 17
[apply_toc_structure] Created chapter #17: ...
[apply_toc_structure] Created chapter #18: ...
... (more chapters)
[apply_toc_structure] Successfully created 6 chapters
```

## 🚀 Key Fix Explanation

**The Problem:**
- Old code used `Chapter.objects.filter(book=book).count()` = 13
- This returned 13, but max chapter_number was 16 (due to gaps)
- When trying to create new chapters, it tried Ch 8, 9, etc. which already existed
- Database constraint error → atomic transaction failed → NO chapters created

**The Solution:**
```python
# Before (WRONG)
chapter_number = Chapter.objects.filter(book=book).count()  # Returns 13

# After (CORRECT)
chapter_number = Chapter.objects.filter(book=book).aggregate(Max('chapter_number'))['chapter_number__max'] or 0
# Returns 16, next will be 17 ✅
```

---

**All files modified:**
- ✅ `backend/lms/toc_parser.py` - Fixed chapter number calculation
- ✅ `backend/lms/views.py` - Enhanced logging

**Ready for testing!** 🎉
