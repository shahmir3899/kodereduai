# Phase 1 & 2 - Quick Testing Guide

## 🎯 Quick Start (5 Minutes)

### Step 1: Start Your Browsers in Side-by-Side View
```
LEFT SIDE:  Backend Admin: http://localhost:8000/admin/
RIGHT SIDE: Frontend: http://localhost:3001
```

If you don't have a backend running:
```bash
cd backend
python manage.py runserver
```

---

## 🧪 PHASE 1 TEST (3 Minutes)

### Step 1: Go to Sessions
```
URL: http://localhost:3001/admissions/sessions
```

You should see:
```
┌─────────────────────────────────────────┐
│ Admission Sessions      [+ New Session] │
│                                         │
│ (List of existing sessions or empty)    │
└─────────────────────────────────────────┘
```

### Step 2: Click [+ New Session]
Modal opens. Look for **3 COLORED CARDS**:

```
┌──────────────────────────────────────────────────────────────┐
│ New Admission Session                                      × │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ Session Name: [_________________]                          │
│ Academic Year: [Dropdown]                                  │
│                                                              │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│ │ 🚀 SIMPLE   │ │ ⭐STANDARD  │ │ 🎓 COMPLEX  │         │
│ │             │ │             │ │             │         │
│ │ 4 Stages    │ │ 6 Stages    │ │ 11 Stages   │         │
│ │ 5-7 days    │ │ 10-14 days  │ │ 20-30 days  │         │
│ │             │ │             │ │             │         │
│ │ [Select]    │ │ [Select]    │ │ [Select]    │         │
│ └──────────────┘ └──────────────┘ └──────────────┘         │
│                                                              │
│ □ Allow stage bypass                                        │
│ Start Date: ________  End Date: ________                    │
│ [Cancel] [Create Session]                                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Step 3: Test Template Selection
1. **Click the SIMPLE card (blue)**
   - Should highlight with blue border
   - Button changes to "✓ Selected" (green)
   - Shows "Fast track for small schools"
   - Lists 4 stages: NEW, APPROVED, PAYMENT_PENDING, ENROLLED

2. **Fill in form**:
   - Session Name: `Spring 2026`
   - Academic Year: Pick any year
   - Leave other fields as-is

3. **Click [Create Session]**
   - Modal closes
   - Page updates
   - New session appears in table

### Step 4: Verify in Table
Look for this in the sessions table:

```
Name      │ Academic Year │ Workflow  │ Active │ Enquiries
──────────┼───────────────┼───────────┼────────┼──────────
Spring    │ 2025-2026     │ SIMPLE    │ Active │ 0
2026      │               │ (blue)    │ ✓      │
```

**KEY**: The new "Workflow" column shows blue **"SIMPLE"** badge ✓

### Step 5: Create 2 More Sessions
Repeat with:
- **Summer 2026** → Select **STANDARD** (should show green badge)
- **Fall 2026** → Select **COMPLEX** (should show purple badge)

Final table should look like:
```
Spring 2026 │ SIMPLE   (blue)
Summer 2026 │ STANDARD (green)
Fall 2026   │ COMPLEX  (purple)
```

✅ **PHASE 1 COMPLETE** if you see all 3 with correct colored badges!

---

## ⚡ PHASE 2 TEST (2-3 Minutes)

### Step 1: Go to Enquiries
```
URL: http://localhost:3001/admissions/enquiries
```

You should see at top:
```
┌─────────────────────────────────────────┐
│ [List] [Kanban]  [Full Form]  [⚡ Quick Add]
│   (toggle)       (gray btn)   (BLUE btn - NEW!)
└─────────────────────────────────────────┘
```

### Step 2: Click [⚡ Quick Add] Button
Modal opens:

```
┌────────────────────────────────────────┐
│ ⚡ Quick Add Student              × │
├────────────────────────────────────────┤
│                                        │
│ Child Name *      [Rahul_____]        │ ← Auto focused
│ DOB    [____]  Grade * [3 ▼]          │
│ Parent Name *     [Amit_____]         │
│ Phone *    [+91-9876543210]           │
│ Email      [amit@example.com]         │
│ How did they hear? [Walk-in ▼]        │
│ Notes      [_________________]        │
│                                        │
│ [Close]  [+ Another]  [Done]          │
│          (blue)       (green)          │
└────────────────────────────────────────┘
```

### Step 3: Fill One Student (Speed Test)
**Time yourself - should take < 30 seconds**

```
Fill in:
- Child Name: Rahul Kumar
- Grade: 3
- Parent Name: Amit Kumar
- Phone: +91-9876543210
- Email: amit@example.com
(source stays Walk-in, skip Notes)

Click [+ Another]
```

You should see:
1. Toast notification: **"✓ Rahul Kumar added as NEW!"**
2. Form clears completely
3. Focus returns to Child Name field
4. Modal stays open (ready for next student)

### Step 4: Add Second Student (Speed Test 2)
```
- Child Name: Priya Sharma
- Grade: 5
- Parent Name: Raj Sharma
- Phone: +91-9876543211
- Email: raj@example.com

Click [+ Another]
```

Toast: **"✓ Priya Sharma added as NEW!"**

### Step 5: Add Third Student (and Close)
```
- Child Name: Maya Patel
- Grade: 2
- Parent Name: Uma Patel
- Phone: +91-9876543212
(skip email this time - it's optional)

Click [Done] (green button)
```

Modal closes, returns to enquiries list.

### Step 6: Verify Students in List
Look at the top of the enquiries list:

```
Student        │ Parent       │ Grade │ Stage │ Actions
───────────────┼──────────────┼───────┼───────┼─────────
Rahul Kumar    │ Amit Kumar   │ 3     │ NEW   │ ...
Priya Sharma   │ Raj Sharma   │ 5     │ NEW   │ ...
Maya Patel     │ Uma Patel    │ 2     │ NEW   │ ...
```

All three should show:
- ✓ Correct names
- ✓ Correct parents
- ✓ Correct grades
- ✓ Stage: NEW (blue badge)

### Step 7: Speed Measurement
**How long did it take to add 3 students?**
- Ideal: 2-3 minutes
- Acceptable: < 5 minutes
- Compare: Old form would take 15-20 minutes

✅ **PHASE 2 COMPLETE** if all 3 students added and visible!

---

## 🔍 VERIFICATION CHECKLIST

| Test | Status | Notes |
|------|--------|-------|
| Phase 1: Templates visible | ☐ YES ☐ NO | |
| Phase 1: SIMPLE card selectable | ☐ YES ☐ NO | |
| Phase 1: Sessions show workflow badges | ☐ YES ☐ NO | |
| Phase 1: Color coding works (SIMPLE=blue, STANDARD=green, COMPLEX=purple) | ☐ YES ☐ NO | |
| Phase 2: Quick Add button visible | ☐ YES ☐ NO | |
| Phase 2: Modal opens | ☐ YES ☐ NO | |
| Phase 2: Form clears after [+ Another] | ☐ YES ☐ NO | |
| Phase 2: Toast shows student name | ☐ YES ☐ NO | |
| Phase 2: 3 students added & visible | ☐ YES ☐ NO | |
| Phase 2: All students have stage NEW | ☐ YES ☐ NO | |
| Speed: < 3 min for 3 students | ☐ YES ☐ NO | |
| No console errors | ☐ YES ☐ NO | |

---

## 🐛 TROUBLESHOOTING

### "Modal won't open"
1. Check console (F12) for errors
2. Restart dev server: `npm run dev`
3. Hard refresh: Ctrl+Shift+R

### "Form doesn't clear"
1. Check Network tab (F12) - is API call succeeding?
2. Look for 201/200 response
3. If 400/500 error appears, read error message

### "Toast doesn't appear"
1. Check if other pages show toasts (to verify Toast component works)
2. Restart dev server
3. Check console for Toast-related errors

### "Students don't appear in list"
1. Hard refresh (Ctrl+Shift+R)
2. Check backend - did students actually save? Go to Django admin
3. Try adding one more student - should see all of them

### "Grade dropdown is empty"
1. Check console for import errors
2. Verify GRADE_PRESETS constant imported
3. Try restarting dev server

---

## ✅ SUCCESS CRITERIA

You've successfully completed Phase 1 & 2 when:

- [x] Phase 1: 3 workflow templates visible and selectable
- [x] Phase 1: Sessions show correct colored badges
- [x] Phase 2: [⚡ Quick Add] button visible
- [x] Phase 2: Students added in 30 seconds each
- [x] Phase 2: 3+ students added without page reload
- [x] Phase 2: All students visible with stage NEW
- [x] Phase 2: Toast notifications working
- [x] **Total time for 3 students**: < 5 minutes
- [x] No console errors
- [x] Data persists on page refresh

---

## 🎬 What's Next?

Once Phase 1 & 2 tests PASS:
→ Proceed to **Phase 3: Workflow Progress UI**
   - Rich student detail page
   - Visual workflow timeline
   - Stage transitions
   - Fee tracking

---

**Happy Testing! 🚀**
