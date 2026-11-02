# Mobile Students: fix plan (admin and principal)

Status: PLAN, waiting for approval. Date 2026-11-01. Companion to `MOBILE_WEB_GAP_REPORT.md`.

## What is wrong today (verified in the browser and in code)

1. **List**: plain rows, empty avatar slot (no initials), no count cards, no status filter, no Add button, no list/card choice.
2. **Add**: does not exist (`studentsApi.createStudent` is unused).
3. **Edit** (`app/(admin)/students/[id]/edit.tsx`, 135 lines): sends `email` and `phone`, which are not in the web's student field list (`frontend/src/pages/students/studentFieldConfig.js`), so those two inputs probably save nothing. It also leaves out gender, blood group, parent name and phone, guardian relation, email, occupation and address, emergency contact, roll number, admission number and date, previous school. Date of birth is a plain text box with no check. No phone normalising (the web turns `03xx` into `+923xx` for WhatsApp/notification use).
4. **Photo**: no upload or remove.
5. **Delete / restore / status / reclassify / parent invite / portal account**: none on mobile.
6. **Profile Info tab**: a flat label/value list; no History, Assessment or Documents tabs.

## Scope, in three steps (each ends with tsc, jest, and my own browser check at 375px; you check on the phone)

### Step 1: Add and a proper Edit form (the core gap)
- One shared form screen used for Add and Edit, built from a single field list that mirrors the web `STUDENT_FIELDS`: Basic (name, roll number), Personal (date of birth, gender, blood group, address), Guardian (parent name and phone, guardian name, relation, phone, email, occupation, address, emergency contact), Admission (admission number, admission date, previous school). Four collapsible sections; Add shows only the quick fields (name, roll number, parent name, parent phone) with "More fields" below, same as the web.
- Uses the existing UI kit: `DateField` for dates, `Select` for gender, `BottomSheet` where useful, `Toast` for results.
- Same rules as the web: gender sent as `M/F/O`, only `parent_phone` is normalised to `+92...`, dates send `null` when empty. The pure functions (`parsePhone`, `normalizeGender`, `formToPayload`) go in `services/studentForm.ts` with jest tests that copy the web's expected outputs.
- Add also needs a class and, when the year has sections, a section. The web sends `school`, `class_obj` and optional `session_class_id`; the mobile class picker already gives me both (`useAttendanceClassOptions`).
- Server validation errors (for example duplicate roll number) are shown next to the field, not only as a toast.
- Optional portal login at creation: **left out of step 1** (see questions).
- Add button on the list header; the old `edit.tsx` is replaced by the new form.

### Step 2: List and profile look and feel
- List: avatar with initials fallback (fix the empty slot), name, roll and class, status pill, parent phone tap-to-call; count line and the status scope filter (Enrolled / Departed / Alumni, as the web `STATUS_SCOPES`); the existing class filter and search stay; pull to refresh stays.
- Use the shared `RecordCard` and `StatusPill` (`StudentCard` already exists, unused).
- Profile: header with avatar, name, roll, class and status; the stat strip stays; Info tab becomes grouped sections (Personal, Guardian, Admission) with tap-to-call on phone numbers.
- Photo: take or choose a photo, upload, remove (uses `expo-image-picker`, already in the build, and the web's upload/remove endpoints).

### Step 3: Lifecycle actions on the profile (needs your decisions below)
- Delete (soft delete with a reason, with the web's removal preview), Restore, and Recently Deleted list.
- Status update and reclassify (move to another class/section).
- Parent invite.
- These are the high-risk actions, so each gets a confirmation that shows what will happen (the web's `removal-preview` and `reclassify-preview` endpoints exist for this).

**Not in this plan (stay on web, with the existing "open on web" notice):** bulk import and export, renumber section, exit wizard and readmit, bulk portal-account conversion, bulk report downloads. The profile History, Assessment and Documents tabs come after step 3.

## Safety
- Writes hit the real Supabase database through the local backend. I will only create and edit test students in **demo school 42**, and delete only students I created in that session. Nothing is committed or pushed without your approval, and I show the diff first.
- No schema change and no backend change are needed: the endpoints exist and the web already uses them. Backend student permissions are enforced server-side, so a teacher cannot gain write access through this.

## Files (expected)
New: `services/studentForm.ts`, `__tests__/studentForm.test.ts`, `components/students/StudentFormScreen.tsx`, `components/students/StudentSections.tsx`, `app/(admin)/students/new.tsx`, rewritten `app/(admin)/students/[id]/edit.tsx`.
Changed: `components/students/{StudentsListScreen,StudentProfileScreen}.tsx`, `services/students.ts`, `hooks/useStudents.ts`, `services/api.ts` (photo, delete, restore, outcome calls), `navigation/routes.ts` if a route is added.

## Decisions I need from you
1. **Portal login at creation** (the web can create the student's username and password in the same form): include it in step 1, or leave it out for now? My default: leave out; add later with parent invite.
2. **Delete on mobile**: soft delete only (restorable), never the permanent purge. My default: yes.
3. **Principal**: same write access as admin on the web (`canManageStudentLifecycle`). My default: follow that function; teachers and managers stay read-only.
4. **Order**: do step 1, show you in the browser and phone, then 2, then 3. OK?
