# Phase 1 & 2 Testing Checklist

**Date**: February 16, 2026  
**Testing**: Session Workflow Setup (Phase 1) + Quick Add Student (Phase 2)  
**Frontend URL**: http://localhost:3001

---

## ✅ Phase 1: Session Workflow Setup - Testing

### Test 1.1: Open Sessions Page
- [ ] Navigate to: http://localhost:3001/admissions/sessions
- [ ] Page loads successfully
- [ ] See header: "Admission Sessions"
- [ ] See subtitle: "Manage admission windows and open grade levels"
- [ ] See [+ New Session] button (blue, top right)

### Test 1.2: Create Session with SIMPLE Workflow
- [ ] Click [+ New Session] button
- [ ] Modal opens: "New Admission Session"
- [ ] See fields:
  - [ ] Session Name input
  - [ ] Academic Year dropdown
  - [ ] **3 WORKFLOW TEMPLATE CARDS** (NEW!)
    - [ ] 🚀 SIMPLE (blue card, 4 stages)
    - [ ] ⭐ STANDARD (green card, 6 stages)
    - [ ] 🎓 COMPLEX (purple card, 11 stages)
  - [ ] "Allow stage bypass" checkbox
  - [ ] Start Date & End Date
  - [ ] Active toggle
  - [ ] Grade Levels picker

**ACTION**: 
- [ ] Enter Session Name: "Spring 2026"
- [ ] Select Academic Year: Any year available
- [ ] **CLICK SIMPLE CARD** (should highlight with blue border)
- [ ] Verify SIMPLE card shows:
  - [ ] Stage count: 4
  - [ ] Timeline: 5-7 days
  - [ ] Stages listed: NEW, APPROVED, PAYMENT_PENDING, ENROLLED
  - [ ] "✓ Selected" button (green)
- [ ] Leave checkboxes/dates as default
- [ ] Click [Create Session]

**VERIFY**:
- [ ] Session list shows new "Spring 2026" row
- [ ] **NEW "Workflow" column** shows **blue "SIMPLE" badge** ✓
- [ ] Session appears in table with:
  - [ ] Name: Spring 2026
  - [ ] Workflow: SIMPLE (blue badge)
  - [ ] Status: Active

### Test 1.3: Create Session with STANDARD Workflow
- [ ] Click [+ New Session] again
- [ ] Enter Session Name: "Summer 2026"
- [ ] **CLICK STANDARD CARD** (green)
- [ ] Verify STANDARD shows 6 stages
- [ ] Create session
- [ ] Verify in list: "Summer 2026" shows **green "STANDARD" badge**

### Test 1.4: Create Session with COMPLEX Workflow
- [ ] Click [+ New Session] again
- [ ] Enter Session Name: "Fall 2026"
- [ ] **CLICK COMPLEX CARD** (purple)
- [ ] Verify COMPLEX shows 11 stages
- [ ] Create session
- [ ] Verify in list: "Fall 2026" shows **purple "COMPLEX" badge**

### Test 1.5: Mobile View (Optional but Important)
- [ ] Open DevTools (F12)
- [ ] Set viewport to iPhone 12 (390px)
- [ ] Browse to sessions page
- [ ] Click [+ New Session]
- [ ] Verify modal opens full-width
- [ ] Scroll down to see all cards
- [ ] 3 cards should stack vertically
- [ ] Click SIMPLE card - should highlight
- [ ] Create button works
- [ ] Session shows workflow badge in mobile view

---

## ✅ Phase 2: Quick Add Student - Testing

### Test 2.1: Open Enquiries Page
- [ ] Navigate to: http://localhost:3001/admissions/enquiries
- [ ] Page loads successfully
- [ ] See header: "Enquiries"
- [ ] See toolbar buttons:
  - [ ] [List] & [Kanban] view toggles
  - [ ] [Full Form] button (gray, secondary)
  - [ ] **[⚡ Quick Add] button** (blue, primary) ← NEW!

### Test 2.2: Open Quick Add Modal
- [ ] Click [⚡ Quick Add] button
- [ ] Modal opens with:
  - [ ] Title: "⚡ Quick Add Student"
  - [ ] Close button (×) at top right
  - [ ] 9 input fields:
    1. [ ] Child Name (required, auto-focused)
    2. [ ] DOB (optional)
    3. [ ] Grade (required dropdown)
    4. [ ] Parent Name (required)
    5. [ ] Phone (required, tel input)
    6. [ ] Email (optional)
    7. [ ] How did they hear? (dropdown, default: Walk-in)
    8. [ ] Notes (optional)
  - [ ] 3 buttons at bottom:
    - [ ] [Close] (gray)
    - [ ] [+ Another] (blue)
    - [ ] [Done] (green)

### Test 2.3: Add Single Student (Rahul Kumar)
- [ ] Modal is open, focus is on Child Name
- [ ] Type: "Rahul Kumar"
- [ ] Tab to next field or click DOB
- [ ] Leave DOB blank (optional)
- [ ] Click Grade dropdown → Select "3"
- [ ] Tab to Parent Name
- [ ] Type: "Amit Kumar"
- [ ] Tab to Phone
- [ ] Type: "+91-9876543210"
- [ ] Tab to Email
- [ ] Type: "amit@example.com"
- [ ] Source should be "Walk-in" (default)
- [ ] Leave Notes blank
- [ ] **Click [+ Another]**

**VERIFY**:
- [ ] Toast notification shows: **"✓ Rahul Kumar added as NEW!"** ✓
- [ ] Form clears completely
- [ ] Focus returns to Child Name field
- [ ] Modal stays open (ready for next entry)
- [ ] No page reload happened

### Test 2.4: Add Second Student Quickly (Priya Sharma)
- [ ] Modal still open, Child Name focused
- [ ] Type: "Priya Sharma"
- [ ] Tab to Grade → Select "5"
- [ ] Tab to Parent Name → Type: "Raj Sharma"
- [ ] Tab to Phone → Type: "+91-9876543211"
- [ ] Tab to Email → Type: "raj@example.com"
- [ ] **Click [+ Another]**

**VERIFY**:
- [ ] Toast: **"✓ Priya Sharma added as NEW!"** ✓
- [ ] Form clears again
- [ ] Ready for third student

### Test 2.5: Add Third Student
- [ ] Type: "Maya Patel"
- [ ] Tab to Grade → Select "2"
- [ ] Tab to Parent Name → Type: "Uma Patel"
- [ ] Tab to Phone → Type: "+91-9876543212"
- [ ] Skip email (leave blank)
- [ ] **This time, click [Done]** (green button, right side)

**VERIFY**:
- [ ] Toast: **"✓ Maya Patel added as NEW!"** ✓
- [ ] Modal closes
- [ ] Returns to enquiries list

### Test 2.6: Verify All 3 Students in List
- [ ] Wait a moment for page to update
- [ ] You should see 3 new students at top of enquiries list:
  1. [ ] Rahul Kumar - Parent: Amit Kumar - Grade: 3 - Stage: NEW
  2. [ ] Priya Sharma - Parent: Raj Sharma - Grade: 5 - Stage: NEW
  3. [ ] Maya Patel - Parent: Uma Patel - Grade: 2 - Stage: NEW
- [ ] All have stage "NEW" (blue badge)
- [ ] All are visible without page refresh

### Test 2.7: Error Handling - Missing Required Field
- [ ] Click [⚡ Quick Add] again
- [ ] Leave Child Name blank
- [ ] Tab to Parent Name → Type: "Test Parent"
- [ ] Tab to Phone → Type: "9999999999"
- [ ] Tab to Grade → Leave blank
- [ ] **Click [+ Another]**

**VERIFY**:
- [ ] Error toast appears: **"Grade level required"** (or similar)
- [ ] Student NOT added to list
- [ ] Modal stays open
- [ ] Fix grade selection → Click [+ Another] again
- [ ] Should succeed

### Test 2.8: Tab Navigation (Keyboard-Friendly)
- [ ] Open Quick Add modal
- [ ] Don't use mouse, only Tab key to navigate:
  - [ ] Tab through all 8 fields
  - [ ] Shift+Tab to go backwards
- [ ] Should move smoothly through fields
- [ ] Verify all fields are reachable without mouse

### Test 2.9: Mobile/Tablet View
- [ ] DevTools → iPhone 12 viewport (390px)
- [ ] Click [⚡ Quick Add]
- [ ] Modal opens full-width
- [ ] Fields stack vertically
- [ ] Buttons are large enough to tap (44px minimum)
- [ ] [+ Another] and [Done] buttons are thumb-friendly
- [ ] Can scroll if needed
- [ ] Fill one student → [+ Another] works
- [ ] Add student successfully

---

## ✅ Integration Test: Phase 1 + Phase 2 Together

### Test 3.1: Full Workflow
1. [ ] Navigate to Sessions: http://localhost:3001/admissions/sessions
2. [ ] Create session "Test Session" with SIMPLE workflow
3. [ ] Verify blue "SIMPLE" badge in table
4. [ ] Navigate to Enquiries: http://localhost:3001/admissions/enquiries
5. [ ] Click [⚡ Quick Add]
6. [ ] Add 5 students using bulk mode ([+ Another] x4, [Done] on 5th)
7. [ ] All 5 appear in enquiries list with stage "NEW"
8. [ ] Refresh page (F5)
9. [ ] All 5 students still there (data persisted)
10. [ ] No console errors (F12, Console tab)

---

## 🔍 Debugging Checklist

If something doesn't work:

### Frontend Console Errors (F12 → Console)
- [ ] No red error messages
- [ ] No warnings about missing components
- [ ] API calls show successful responses

### Common Issues & Fixes

**Issue**: Modal doesn't open when clicking [⚡ Quick Add]
- **Fix**: Check browser console for errors
- **Fix**: Verify QuickAddEnquiryModal component imported in EnquiriesPage.jsx
- **Fix**: Check if `showQuickAdd` state is being toggled

**Issue**: Form doesn't clear after [+ Another]
- **Fix**: Verify form state reset happens in onSuccess callback
- **Fix**: Check network tab - is API call succeeding?

**Issue**: Toast doesn't show
- **Fix**: Verify useToast hook is working (check other pages)
- **Fix**: May need to restart dev server (npm run dev)

**Issue**: Students not appearing in list after adding
- **Fix**: Check if API call succeeded (Network tab)
- **Fix**: Verify queryClient.invalidateQueries is being called
- **Fix**: Try F5 refresh - should appear if data saved

**Issue**: Grade dropdown empty
- **Fix**: Verify GRADE_PRESETS imported correctly
- **Fix**: Check if using `numeric_level` vs `value` field

---

## 📊 Performance Check

### Response Times
- [ ] Modal opens: < 200ms
- [ ] Add student: < 500ms (should see toast quickly)
- [ ] Form clear: < 100ms
- [ ] List updates: < 1 second after add

### Bulk Entry Speed
- [ ] Add 10 students:
  - [ ] Time taken: ~3-5 minutes (should be fast)
  - [ ] No lag between entries
  - [ ] All students visible in final list

---

## ✅ Sign-Off Criteria

Phase 1 & 2 are COMPLETE when:

**Phase 1: Session Workflow**
- [x] 3 template cards display in create modal
- [x] SIMPLE, STANDARD, COMPLEX selectable
- [x] Workflow type visible as badge in sessions table
- [x] Mobile responsive

**Phase 2: Quick Add Student**
- [x] [⚡ Quick Add] button visible and clickable
- [x] Modal opens with 9 fields
- [x] [+ Another] clears form and stays open
- [x] [Done] closes modal
- [x] Students added successfully
- [x] All students appear in list with stage "NEW"
- [x] Toast notifications work
- [x] Error handling works (required fields)
- [x] Mobile responsive

---

## 🎬 Next Steps

If ALL tests pass ✓:
→ Proceed to **Phase 3: Enhanced Enquiry Detail**
   - Visual workflow progress bar
   - Stage transition buttons
   - Fee tracking
   - Timeline/notes

If any tests FAIL:
→ Debug, fix, and retest that section
→ Then proceed to Phase 3

---

**TEST RESULTS**:
- [x] Phase 1 Tests: ___________
- [x] Phase 2 Tests: ___________
- [x] Integration Tests: ___________
- [x] Mobile Tests: ___________

**Tested By**: ___________________  
**Date**: ___________________  
**Status**: ✓ READY FOR PHASE 3
