"""
Education AI - Comprehensive User Guide PDF Generator
Generates a professional PDF user guide covering all modules and workflows.

Source: generate_user_guide.py (project root)
Output: EducationAI_User_Guide.pdf (project root)
        frontend/src/data/userGuide.json (for in-app guide)
Run:    python generate_user_guide.py
"""

from fpdf import FPDF
from guide_meta import apply_meta, sync_video_catalog, START_HERE
import os
import json
from datetime import datetime, timezone

class UserGuidePDF(FPDF):
    def __init__(self):
        super().__init__()
        self.set_auto_page_break(auto=True, margin=20)
        self.chapter_num = 0
        self.section_num = 0
        self.step_counter = 0
        self.toc_entries = []
        # JSON collection state (for in-app guide)
        self.json_chapters = []
        self.json_current_chapter = None
        self.json_current_section = None
        self.json_step_counter = 0
        self.json_modules = []

    def header(self):
        if self.page_no() > 1:
            self.set_font("Helvetica", "I", 8)
            self.set_text_color(120, 120, 120)
            self.cell(0, 8, "Education AI - User Guide", align="L")
            self.cell(0, 8, f"Page {self.page_no()}", align="R", new_x="LMARGIN", new_y="NEXT")
            self.set_draw_color(200, 200, 200)
            self.line(10, 14, 200, 14)
            self.ln(4)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 7)
        self.set_text_color(150, 150, 150)
        self.cell(0, 10, "Confidential - For Internal Use Only", align="C")

    @staticmethod
    def _make_slug(title):
        slug = title.lower()
        slug = ''.join(c if c.isalnum() or c == ' ' else '' for c in slug).strip()
        slug = '-'.join(slug.split())
        return slug

    def _ensure_json_section(self):
        """Create implicit intro section if content is added before any section_title."""
        if self.json_current_section is None and self.json_current_chapter is not None:
            self.json_current_section = {
                "id": f"{self.chapter_num}.0",
                "title": "Introduction",
                "slug": "introduction",
                "content": []
            }
            self.json_current_chapter["sections"].insert(0, self.json_current_section)

    def cover_page(self):
        self.add_page()
        self.ln(50)
        self.set_font("Helvetica", "B", 36)
        self.set_text_color(25, 60, 120)
        self.cell(0, 20, "Education AI", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(5)
        self.set_font("Helvetica", "", 20)
        self.set_text_color(80, 80, 80)
        self.cell(0, 15, "School Administration Guide", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(10)
        self.set_draw_color(25, 60, 120)
        self.set_line_width(0.8)
        self.line(60, self.get_y(), 150, self.get_y())
        self.ln(15)
        self.set_font("Helvetica", "", 12)
        self.set_text_color(100, 100, 100)
        self.cell(0, 8, "School Management System", align="C", new_x="LMARGIN", new_y="NEXT")
        self.cell(0, 8, "Version 3.4 - Manual Attendance & Updated Navigation", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(40)
        self.set_font("Helvetica", "", 10)
        self.cell(0, 6, "Modules Covered:", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(3)
        modules = [
            "Dashboard | Classes & Students | Attendance (Manual Entry)",
            "Face Attendance (Camera-Based) | Academics & Examinations",
            "Finance & Online Payments | HR & Staff Management",
            "Admissions CRM | Transport | Library | Hostel | Inventory",
            "LMS | Notifications | Messaging | Parent & Student Portals | AI Study Helper",
            "AI Features: OR-Tools Timetable | AI Report Comments | AI Letter Drafting"
        ]
        self.json_modules = modules  # store for JSON export
        self.set_font("Helvetica", "I", 9)
        for m in modules:
            self.cell(0, 6, m, align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(15)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 5, "To update this guide, edit: generate_user_guide.py (project root)", align="C", new_x="LMARGIN", new_y="NEXT")
        self.cell(0, 5, "Then run: python generate_user_guide.py", align="C", new_x="LMARGIN", new_y="NEXT")

    def add_toc(self):
        self.add_page()
        self.set_font("Helvetica", "B", 22)
        self.set_text_color(25, 60, 120)
        self.cell(0, 15, "Table of Contents", new_x="LMARGIN", new_y="NEXT")
        self.ln(8)
        self.set_draw_color(25, 60, 120)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(8)
        # placeholder - we'll add entries later
        self.toc_page = self.page_no()

    def chapter_title(self, title):
        self.chapter_num += 1
        self.section_num = 0
        self.add_page()
        page = self.page_no()
        self.toc_entries.append(("chapter", f"{self.chapter_num}. {title}", page))
        # Decorative bar
        self.set_fill_color(25, 60, 120)
        self.rect(10, 20, 5, 20, style="F")
        self.set_xy(20, 20)
        self.set_font("Helvetica", "B", 22)
        self.set_text_color(25, 60, 120)
        self.cell(0, 20, f"{self.chapter_num}. {title}")
        self.ln(25)
        self.set_draw_color(200, 200, 200)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(8)
        # JSON tracking
        self.json_current_chapter = {
            "id": self.chapter_num,
            "title": title,
            "slug": self._make_slug(title),
            "sections": []
        }
        self.json_chapters.append(self.json_current_chapter)
        self.json_current_section = None
        self.json_step_counter = 0

    def section_title(self, title):
        self.section_num += 1
        self.step_counter = 0
        if self.get_y() > 240:
            self.add_page()
        page = self.page_no()
        self.toc_entries.append(("section", f"  {self.chapter_num}.{self.section_num} {title}", page))
        self.ln(4)
        self.set_font("Helvetica", "B", 14)
        self.set_text_color(40, 90, 160)
        self.cell(0, 10, f"{self.chapter_num}.{self.section_num}  {title}", new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(40, 90, 160)
        self.line(10, self.get_y(), 80, self.get_y())
        self.ln(5)
        # JSON tracking
        self.json_current_section = {
            "id": f"{self.chapter_num}.{self.section_num}",
            "title": title,
            "slug": self._make_slug(title),
            "content": []
        }
        if self.json_current_chapter:
            self.json_current_chapter["sections"].append(self.json_current_section)
        self.json_step_counter = 0

    def sub_section(self, title):
        if self.get_y() > 250:
            self.add_page()
        self.ln(2)
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(60, 60, 60)
        self.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")
        self.ln(2)
        self._ensure_json_section()
        if self.json_current_section:
            self.json_current_section["content"].append({"type": "sub_section", "title": title})

    def body_text(self, text):
        self.set_font("Helvetica", "", 10)
        self.set_text_color(50, 50, 50)
        self.multi_cell(0, 6, text)
        self.ln(3)
        self._ensure_json_section()
        if self.json_current_section:
            self.json_current_section["content"].append({"type": "body_text", "text": text})

    def step(self, text):
        self.step_counter += 1
        if self.get_y() > 260:
            self.add_page()
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(255, 255, 255)
        # Step number circle
        x = self.get_x() + 2
        y = self.get_y() + 1
        self.set_fill_color(40, 90, 160)
        self.ellipse(x, y, 6, 6, style="F")
        self.set_xy(x, y)
        self.set_font("Helvetica", "B", 7)
        self.cell(6, 6, str(self.step_counter), align="C")
        self.set_xy(x + 9, y - 1)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(50, 50, 50)
        self.multi_cell(170, 6, text)
        self.ln(2)
        self.json_step_counter += 1
        self._ensure_json_section()
        if self.json_current_section:
            self.json_current_section["content"].append({"type": "step", "number": self.json_step_counter, "text": text})

    def bullet(self, text, indent=15):
        if self.get_y() > 265:
            self.add_page()
        x = self.get_x()
        self.set_x(x + indent)
        self.set_font("Helvetica", "", 9)
        self.set_text_color(50, 50, 50)
        self.cell(3, 5, "-")
        self.multi_cell(170 - indent, 5, f"  {text}")
        self.ln(1)
        self._ensure_json_section()
        if self.json_current_section:
            self.json_current_section["content"].append({"type": "bullet", "text": text})

    def info_box(self, title, text):
        if self.get_y() > 240:
            self.add_page()
        self.ln(3)
        self.set_fill_color(235, 245, 255)
        self.set_draw_color(40, 90, 160)
        y_start = self.get_y()
        self.set_x(15)
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(25, 60, 120)
        self.cell(175, 7, f"  {title}", new_x="LMARGIN", new_y="NEXT", fill=True)
        self.set_x(15)
        self.set_font("Helvetica", "", 9)
        self.set_text_color(50, 50, 50)
        self.multi_cell(175, 5, f"  {text}", fill=True)
        y_end = self.get_y()
        self.set_draw_color(40, 90, 160)
        self.rect(15, y_start, 175, y_end - y_start)
        self.ln(5)
        self._ensure_json_section()
        if self.json_current_section:
            self.json_current_section["content"].append({"type": "info_box", "title": title, "text": text})

    def warning_box(self, text):
        if self.get_y() > 240:
            self.add_page()
        self.ln(3)
        y_start = self.get_y()
        self.set_fill_color(255, 248, 230)
        self.set_x(15)
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(180, 120, 0)
        self.cell(175, 7, "  Important Note", new_x="LMARGIN", new_y="NEXT", fill=True)
        self.set_x(15)
        self.set_font("Helvetica", "", 9)
        self.set_text_color(100, 70, 0)
        self.multi_cell(175, 5, f"  {text}", fill=True)
        y_end = self.get_y()
        self.set_draw_color(180, 120, 0)
        self.rect(15, y_start, 175, y_end - y_start)
        self.ln(5)
        self._ensure_json_section()
        if self.json_current_section:
            self.json_current_section["content"].append({"type": "warning_box", "text": text})

    def nav_path(self, path):
        """Show navigation breadcrumb"""
        if self.get_y() > 260:
            self.add_page()
        self.set_font("Helvetica", "I", 9)
        self.set_text_color(100, 100, 100)
        self.cell(0, 6, f"Navigate to:  {path}", new_x="LMARGIN", new_y="NEXT")
        self.ln(2)
        self._ensure_json_section()
        if self.json_current_section:
            self.json_current_section["content"].append({"type": "nav_path", "path": path})

    def simple_table(self, headers, rows, col_widths=None):
        if self.get_y() > 230:
            self.add_page()
        if col_widths is None:
            col_widths = [190 // len(headers)] * len(headers)
        # Header
        self.set_font("Helvetica", "B", 9)
        self.set_fill_color(25, 60, 120)
        self.set_text_color(255, 255, 255)
        for i, h in enumerate(headers):
            self.cell(col_widths[i], 8, h, border=1, fill=True, align="C")
        self.ln()
        # Rows
        self.set_font("Helvetica", "", 8)
        self.set_text_color(50, 50, 50)
        fill = False
        for row in rows:
            if self.get_y() > 265:
                self.add_page()
                # Reprint header
                self.set_font("Helvetica", "B", 9)
                self.set_fill_color(25, 60, 120)
                self.set_text_color(255, 255, 255)
                for i, h in enumerate(headers):
                    self.cell(col_widths[i], 8, h, border=1, fill=True, align="C")
                self.ln()
                self.set_font("Helvetica", "", 8)
                self.set_text_color(50, 50, 50)
            if fill:
                self.set_fill_color(245, 245, 250)
            else:
                self.set_fill_color(255, 255, 255)
            for i, cell in enumerate(row):
                self.cell(col_widths[i], 7, str(cell), border=1, fill=True)
            self.ln()
            fill = not fill
        self.ln(5)
        self._ensure_json_section()
        if self.json_current_section:
            self.json_current_section["content"].append({
                "type": "table",
                "headers": headers,
                "rows": [[str(cell) for cell in row] for row in rows]
            })


def build_guide():
    pdf = UserGuidePDF()

    # =========================================================================
    # COVER PAGE
    # =========================================================================
    pdf.cover_page()

    # =========================================================================
    # TABLE OF CONTENTS (placeholder page - we'll note the page)
    # =========================================================================
    pdf.add_toc()

    # =========================================================================
    # CHAPTER 1: GETTING STARTED
    # =========================================================================
    pdf.chapter_title("Getting Started")

    pdf.section_title("Overview")
    pdf.body_text(
        "Education AI runs your whole school in one place: students and attendance, fees, staff, exams and more. "
        "Parents and students get their own portals."
    )

    pdf.section_title("User Roles")
    pdf.body_text("Each person sees only what their role needs.")
    pdf.simple_table(
        ["Role", "What they do"],
        [
            ["School Admin", "Everything in the school; creates other users"],
            ["Principal", "School operations; creates staff users"],
            ["Teacher", "Attendance, marks and lesson plans for their classes"],
            ["Manager", "Academics, content, classes and students"],
            ["Accountant", "Fees, expenses and reports"],
            ["Driver", "Transport attendance and routes"],
            ["Staff", "Basic access and notifications"],
            ["Parent", "Their child's attendance, fees and results"],
            ["Student", "Own attendance, timetable and assignments"],
        ],
        [40, 150]
    )
    pdf.body_text("Admins and Principals create users in Settings > Users. See the User Management chapter.")

    pdf.section_title("Logging In")
    pdf.step("Open the Education AI address in your browser.")
    pdf.step("Type your username and password, then click 'Sign In'. You land on your dashboard.")
    pdf.step("If you manage several schools, pick the school from the top bar.")
    pdf.info_box("First time?", "Your School Admin account is ready. After you log in, follow Chapter 2 to set up your school.")

    pdf.section_title("Navigating the Application")
    pdf.body_text(
        "Use the menu on the left to open any page. You only see the pages your role can use and the modules "
        "your school has turned on. On a phone, open the menu with the button at the top."
    )
    pdf.sub_section("The top bar")
    pdf.bullet("School name - switch schools here if you have more than one")
    pdf.bullet("Academic year - choose which year you are looking at")
    pdf.bullet("Moon icon - light or dark mode")
    pdf.bullet("Bell - your unread notifications")
    pdf.bullet("Logout is at the bottom of the menu")
    pdf.info_box("Cannot see a page?", "Your role may not include it, or your school has not turned that module on. Ask your School Admin.")

    # =========================================================================
    # CHAPTER 2: INITIAL SETUP (ORDER OF OPERATIONS)
    # =========================================================================
    pdf.chapter_title("Initial Setup - Order of Operations")

    pdf.body_text(
        "Set up in this order, because each step needs the one before it. For a new school, the School Setup "
        "wizard (last topic in this chapter) can walk you through everything."
    )

    pdf.section_title("Step 1: Academic Year & Terms")
    pdf.nav_path("Sidebar > Management > Sessions")
    pdf.step("Click '+ Add Academic Year'. Enter a name (for example 2026-27), the start date and the end date, then save.")
    pdf.step("On the year's card, click 'Set Current' to make it the active year.")
    pdf.step("On the same card, click 'Manage terms', then '+ Add Term'. The first term is created for you.")
    pdf.step("Drag the handles on the timeline bar, or type the dates, to set the term. Changes save by themselves.")
    pdf.step("Add the other terms the same way. Each one starts the day after the previous one ends.")
    pdf.info_box("Overlapping terms", "If two terms overlap, you get a warning and the change is not saved until you click 'Save anyway'.")

    pdf.section_title("Step 2: Create Classes")
    pdf.nav_path("Sidebar > Management > Classes")
    pdf.step("Open 'Classes' and switch to 'Master'.")
    pdf.step("Click 'Add Class', choose the grade level, confirm the name and save without sections. Repeat once per grade.")
    pdf.step("Switch to 'Session Classes' for the active year and create sections such as A and B there.")
    pdf.info_box("Why two lists?", "Master classes are the shared catalog and stay the same every year. Sections belong to one academic year.")

    pdf.section_title("Step 3: Add Students")
    pdf.nav_path("Sidebar > Management > Students")
    pdf.step("Click 'Add Student'. Choose the class and enter the student's name; the roll number is suggested for you.")
    pdf.step("Add the parent's name and phone number, then save. The student appears in the list.")
    pdf.step("To add many students at once, click 'Download Excel' for the template, fill it in, then click 'Upload Excel'.")
    pdf.info_box("Add classes first", "A student must belong to a class, so finish Step 2 before adding students.")

    pdf.section_title("Step 4: Add Subjects")
    pdf.nav_path("Sidebar > Academics > Subjects")
    pdf.step("In the 'Subjects' tab, click '+ Add Subject'.")
    pdf.step("Enter the subject name. The code is filled in for you and you can change it. Click 'Create'.")
    pdf.step("Repeat for every subject, then open 'Class Assignments' to give each class its subjects and teachers.")

    pdf.section_title("Step 5: Create Timetable")
    pdf.nav_path("Sidebar > Academics > Timetable")
    pdf.step("Select the class. If its rows are empty, click 'Time Slots' and add the periods first.")
    pdf.step("Click a cell, choose the subject for that period and click 'Set'. The teacher assigned to the subject is filled in.")
    pdf.step("Click 'Save Timetable'. Students and parents can now see it.")
    pdf.info_box("Needs Step 4", "A class needs its subjects assigned before you can fill its timetable.")

    pdf.section_title("Module Dependency Reference")
    pdf.body_text("What must exist before each feature works:")
    pdf.simple_table(
        ["Feature", "Needs"],
        [
            ["Attendance", "Classes, students"],
            ["Face attendance", "Classes, students, enrolled faces"],
            ["Timetable, LMS", "Subjects assigned to classes"],
            ["Exams and report cards", "Academic year, terms, classes, subjects"],
            ["Fee collection", "Fee structures, finance accounts"],
            ["Payroll", "Staff, salary structures"],
            ["Transport", "Routes, vehicles, students"],
            ["Library", "Books in the catalog"],
            ["Hostel", "Hostels, rooms, students"],
        ],
        [60, 130]
    )

    pdf.section_title("School Setup Wizard")
    pdf.nav_path("Sidebar > School Setup")
    pdf.body_text(
        "For a new school, the wizard does Steps 1-5 and more in order: school profile, academic year, classes, "
        "students, staff, subjects and finance. Steps for modules you do not use are skipped."
    )
    pdf.step("Open 'School Setup' in the sidebar.")
    pdf.step("Finish each step and click 'Next Step', or click 'Skip' to leave it for later.")
    pdf.step("Click 'Exit Setup' at any time. You can come back later.")
    pdf.step("On the last step, review everything and click 'Go to Dashboard'.")

    # =========================================================================
    # CHAPTER 3: ATTENDANCE MODULE
    # =========================================================================
    pdf.chapter_title("Attendance Module")

    pdf.body_text(
        "Mark attendance one class at a time with Manual Entry, or by camera with Face Attendance (Chapter 4). "
        "Teachers see only the classes assigned to them; Admins and Principals see all classes."
    )

    pdf.section_title("Marking Attendance")
    pdf.nav_path("Sidebar > Attendance > 1. Manual Entry")
    pdf.step("Pick the class. The date is today; change it only to mark a past day.")
    pdf.step("Press 'Mark All Present' to start, then tap only the students who are absent or on leave. Each tap cycles Present, Absent, Leave.")
    pdf.step("The counts above the list update as you go. Press 'Save Attendance'.")
    pdf.step("A green message shows how many records were saved, for example 'Saved! 4 created, 0 updated.'")
    pdf.warning_box("On off days (holidays marked in the Academic Calendar) attendance does not apply and Save is disabled.")

    pdf.section_title("Correcting Attendance That Is Already Marked")
    pdf.step("Open Manual Entry and choose the same class and date. A blue notice says records already exist, and the saved statuses load.")
    pdf.step("Tap a student's status to correct it, then press 'Save Attendance'. The message shows records updated, and nothing is duplicated.")

    pdf.section_title("Viewing the Attendance Register")
    pdf.nav_path("Sidebar > Attendance > Attendance Record")
    pdf.step("Select a class, then use the month arrows to move between months.")
    pdf.step("Students are in rows and days in columns. Students who joined or left mid-month, and approved leave, look different from normal absences.")
    pdf.step("Press the download button to save the register as a PDF.")

    pdf.section_title("Attendance Status Meanings")
    pdf.simple_table(
        ["Status", "Meaning"],
        [
            ["Present", "Student was in class"],
            ["Absent", "Student was not in class"],
            ["Leave", "Student on approved leave"],
            ["Not Set", "No mark yet; it is not saved"],
        ],
        [50, 140]
    )

    # =========================================================================
    # CHAPTER 4: FACE ATTENDANCE (CAMERA-BASED)
    # =========================================================================
    pdf.chapter_title("Face Attendance (Camera-Based)")

    pdf.body_text(
        "Take one photo of the whole class and the system finds each student's face and marks them present. "
        "You check the result, fix any mistakes, and confirm."
    )

    pdf.section_title("Prerequisites")
    pdf.bullet("The class and its students exist (Chapter 2).")
    pdf.bullet("Every student has an enrolled face photo (Step 1). A student without one cannot be matched automatically.")

    pdf.section_title("Step 1: Enroll Student Faces")
    pdf.nav_path("Sidebar > Attendance > 2. Face Attendance > Manage Enrollments")
    pdf.body_text("This is a one-time job per student: upload a clear portrait photo for the system to remember.")
    pdf.step("On Face Attendance, click 'Manage Enrollments' (top right). Choose the class, then the student.")
    pdf.step("Upload or capture a portrait with exactly one face, then click 'Enroll Face'.")
    pdf.step("The student appears on the right with a quality score. Repeat for every student in the class.")
    pdf.info_box("Photo tips", "Use a well-lit photo, facing the camera, without sunglasses or heavy shadows. A quality score above 70% works best. To undo an enrollment, click 'Remove' next to the student.")

    pdf.section_title("Step 2: Capture Class Photo")
    pdf.nav_path("Sidebar > Attendance > 2. Face Attendance > Group Photo Tab")
    pdf.step("On the 'Group Photo' tab, choose the class and the date (today by default).")
    pdf.step("Click 'Select or Capture Photo' to use the camera or upload an image. Click 'Clear' to retake.")
    pdf.step("Click 'Process Attendance'. You are taken to the Review page automatically.")
    pdf.body_text("The 'Mobile Capture' tab takes the photo with a live camera, and the 'Sessions' tab lists past sessions.")

    pdf.section_title("Step 3: Review Detected Faces")
    pdf.nav_path("Sidebar > Attendance > 2. Face Attendance > Review Page")
    pdf.body_text("After 10-30 seconds the page shows the photo, the faces found, and the class list with Present or Absent toggles.")
    pdf.simple_table(
        ["Badge", "Meaning"],
        [
            ["Auto (green)", "Confident match, accepted for you"],
            ["Review (yellow)", "Not sure: please check this one"],
            ["Manual (blue)", "You matched it yourself"],
            ["Ignored (gray)", "No match found"],
        ],
        [50, 140]
    )
    pdf.step("Remove a wrong detection with its red X.")
    pdf.step("In the class list, click a student to switch between Present and Absent. Matched students start as Present, the rest as Absent.")

    pdf.section_title("Step 4: Confirm Attendance")
    pdf.step("Click 'Confirm Attendance'. Everyone in the class is saved as Present or Absent and the session shows 'Confirmed'.")
    pdf.step("The records appear in the Attendance Record register next to manual ones.")
    pdf.info_box("Not happy with the result?", "Click 'Reprocess' to run the same photo again from scratch.")

    pdf.section_title("Viewing Past Sessions")
    pdf.nav_path("Sidebar > Attendance > 2. Face Attendance > Sessions Tab")
    pdf.step("Open the 'Sessions' tab to see past sessions with their class, date, number of faces and status.")
    pdf.step("Click a session to open its Review page and see the confirmed result, or finish a pending one.")

    pdf.section_title("Match Confidence Thresholds")
    pdf.body_text(
        "The system compares each face with the enrolled photos. A close match is accepted automatically, a "
        "medium match is flagged for you to check, and a weak match is ignored."
    )

    # =========================================================================
    # CHAPTER 5: ACADEMICS MODULE
    # =========================================================================
    pdf.chapter_title("Academics Module")

    pdf.section_title("Managing Subjects")
    pdf.nav_path("Sidebar > Academics > Subjects")
    pdf.step("In the 'Subjects' tab, click '+ Add Subject'. Enter the name; the code is filled in and you can change it.")
    pdf.step("Tick 'Elective subject' if students can choose it, then click 'Create'. The subject appears in the list.")
    pdf.step("Open 'Class Assignments' and click 'Assign Subject'. Choose the class, subject, teacher and periods per week, then save. Repeat for each combination.")
    pdf.body_text("The 'AI Insights' tab shows workload balance across subjects.")

    pdf.section_title("Academic Sessions (Years & Terms)")
    pdf.nav_path("Sidebar > Management > Sessions")
    pdf.body_text(
        "An academic year is the school year; terms split it into parts. Attendance, fees, exams and roll numbers "
        "all belong to one year, and the year switcher in the top bar changes which one you are looking at."
    )

    pdf.sub_section("Academic years")
    pdf.step("Each year has a card with a timeline bar. Click '+ Add Academic Year' to make a new one (name, start and end date).")
    pdf.step("Click 'Set Current' on the year the school is working in now.")
    pdf.step("The strip at the top shows your years side by side, so an overlap between two years stands out in red.")
    pdf.info_box("Dates that look wrong", "If a year overlaps another, or is very short or very long, you get a warning and the button changes to 'Save anyway'. A year that has ended or not started will ask you to confirm before it becomes current.")

    pdf.sub_section("Terms")
    pdf.step("On the year's card, click 'Manage terms'. A window opens with that year's timeline.")
    pdf.step("Click '+ Add Term'. The next term is created for you, starting the day after the last one.")
    pdf.step("Click a term on the bar, then drag its handles, or use the arrow keys, or type the dates below. It saves by itself.")
    pdf.step("Terms that overlap show a warning and are not saved until you click 'Save anyway'.")

    pdf.sub_section("Copy terms from another year")
    pdf.step("In 'Manage terms', click 'Import from another year'.")
    pdf.step("Pick the source and target years and what to do with terms that already exist, then click 'Preview Import'.")
    pdf.step("Check the preview, then click 'Import Terms'. Use this at the start of a new year.")

    pdf.section_title("Student Promotion")
    pdf.nav_path("Sidebar > Management > Promotion")
    pdf.step("Choose the year you are promoting from and the year you are promoting to, then click 'Next'.")
    pdf.step("Choose the class to promote and click 'Next'.")
    pdf.step("For each student choose an action: Promote, Repeat or Graduate. For the highest class the default is Graduate. Choose the target class for everyone.")
    pdf.step("Click 'Promote Students'. The result shows how many were promoted.")
    pdf.info_box("Fixing a mistake", "Open 'Promotion History' to check what happened. Correct one student from their row, or tick several rows for a Bulk Correction. A reason is required, and every correction is recorded.")
    pdf.info_box("New admissions", "You can admit new students to next year's classes before promoting. Roll numbers are separate for each year, so nothing clashes.")

    pdf.section_title("AI Analytics")
    pdf.nav_path("Sidebar > AI Analytics")
    pdf.body_text("Shows how subjects, attendance and marks relate, to help you spot students and subjects that need attention.")

    pdf.section_title("Academic Calendar")
    pdf.nav_path("Sidebar > Management > Academic Calendar")
    pdf.body_text("A month view of terms, off days and school events. Sundays are off automatically.")
    pdf.step("Use the year and month selectors to move around. Filter by class or 'Whole School' if you need to.")
    pdf.step("Click 'Add Event / Off Day'. Enter a title and choose the type. Switch on 'OFF Day' if school is closed, and pick a category such as Summer Vacation or Religious Holiday.")
    pdf.step("Choose who it applies to, set the start and end date, and click 'Save'. It appears on the calendar.")
    pdf.warning_box("Attendance cannot be saved on off days (see Chapter 3).")

    # =========================================================================
    # CHAPTER 5: EXAMINATIONS
    # =========================================================================
    pdf.chapter_title("Examinations Module")

    pdf.body_text("The exam cycle, in order: grade scale, exam types, create an exam, enter marks, announce results, report cards.")

    pdf.section_title("Step 1: Define Grade Scale")
    pdf.nav_path("Sidebar > Academics > Grade Scale")
    pdf.step("Click 'Add Grade'. Enter the grade label, the minimum and maximum percentage, and the grade point, then click 'Create'.")
    pdf.step("To add a grade above an existing one, first lower the top of the grade below: click 'Edit', change its maximum, and click 'Update'.")
    pdf.body_text("Grades and GPA on results and report cards are worked out from this scale.")

    pdf.section_title("Step 2: Create Exam Types")
    pdf.nav_path("Sidebar > Academics > Exam Types")
    pdf.step("Click 'Add Exam Type'. Type the name (for example Unit Test or Final Exam).")
    pdf.step("Set the weight: how much this exam counts toward the final result.")
    pdf.step("Tick 'Final exam' only for exams that decide promotion, then click 'Create'.")

    pdf.section_title("Step 3: Create an Exam")
    pdf.nav_path("Sidebar > Academics > Exams")
    pdf.step("Click 'Create Exam'. Choose the academic year, term and exam type.")
    pdf.step("Enter the dates, click 'Next', and choose the classes.")
    pdf.step("Continue through the date sheet to the preview, check it, then click 'Create Exam'.")
    pdf.body_text("A new exam starts as Scheduled. You move it forward as marks are entered and results are published.")

    pdf.section_title("Step 4: Enter Marks")
    pdf.nav_path("Sidebar > Academics > Marks Entry")
    pdf.step("Choose the exam, the class and the subject. The class's students load automatically.")
    pdf.step("Type each student's marks. The maximum marks are checked for you.")
    pdf.step("Click 'Save All Marks'. You can come back and edit until the results are published.")

    pdf.section_title("Step 5: View & Publish Results")
    pdf.nav_path("Sidebar > Academics > Results")
    pdf.step("Choose the class and the exam to see marks and grades. Check them before you announce.")
    pdf.step("Optional: click 'Generate Comments' to draft a comment for every student. Open a student's row to read or edit it.")
    pdf.step("To show results to students and parents, open 'Exams', expand the exam group and click 'Announce Results', then confirm. If some classes are still missing marks, use 'Announce Ready Classes'.")

    pdf.section_title("Step 6: Generate Report Cards")
    pdf.nav_path("Sidebar > Academics > Report Cards")
    pdf.step("Choose a class, then the student. You can also filter by session and exams.")
    pdf.step("The preview shows exam results, grades and GPA. Click 'Download PDF' for a printable report card.")

    pdf.section_title("Weighted Average Configuration")
    pdf.nav_path("Sidebar > Settings > School Profile > Examination Settings")
    pdf.body_text("By default report cards use a simple average. With weighted average, each exam type counts by its weight (for example Mid-Term 30%, Final 70%).")
    pdf.step("Open Settings, go to the 'School Profile' tab and scroll to 'Examination Settings'.")
    pdf.step("Click the 'Weighted Average' switch on, then check each exam type's weight on the Exam Types page.")

    pdf.section_title("Step 7: Monthly Skill & Behaviour Assessments")
    pdf.nav_path("Sidebar > Academics > Assessments")
    pdf.body_text("Each month, teachers rate every student's skills and behaviour and add a remark. This is separate from exam marks.")
    pdf.step("Choose the class and the month. Every student in the class is listed.")
    pdf.step("Rate each skill and behaviour (Needs Improvement to Excellent), then write a teacher remark. 'AI Suggest' can draft one from the ratings; check it before saving.")
    pdf.step("Click 'Save' on a row for one student, or 'Save Month' for the whole class.")
    pdf.info_box("Principal remark", "Only School Admins and Principals can edit the principal remark. A teacher's save never overwrites it.")
    pdf.body_text("The latest saved month appears automatically on the student's Comprehensive Report.")

    pdf.section_title("Question Bank")
    pdf.nav_path("Sidebar > Content Creation > Question Bank")
    pdf.body_text("Reusable questions for papers and curriculum coverage.")
    pdf.step("Click 'Add Question'. Choose the class, subject, book and chapter.")
    pdf.step("Choose the type, difficulty and marks, then type the question. For multiple choice, add the options and mark the correct one.")
    pdf.step("Tick the topic it tests, then save. The bank lists questions by class through their topics, so a question with no topic will not appear when you filter by class.")
    pdf.step("To find it again, choose the class (and subject) in the filters. The list stays empty until a class is chosen.")
    pdf.info_box("AI questions", "Questions made by AI are marked Unverified. Check them, then mark them Verified.")

    pdf.section_title("Question Paper Builder and Question Papers")
    pdf.nav_path("Sidebar > Content Creation > Paper Builder")
    pdf.step("Choose the class and subject, then finish the title; it starts from the exam, class and subject.")
    pdf.step("Under 'Paper Structure', sections are optional. If section marks do not add up to the total, a 'Marks mismatch' message asks you to click 'Continue' to confirm.")
    pdf.step("Add questions with 'Type manually', 'From question bank / lesson plans' or 'Capture from image' (a handwritten paper; check the extracted questions).")
    pdf.step("Open the draft to save it. All your papers are listed under 'Question Papers' as Draft, Ready or Published.")
    pdf.info_box("Availability", "The paper builder appears only if the feature is turned on for your school.")

    pdf.section_title("Worksheets")
    pdf.nav_path("Sidebar > Content Creation > Worksheets")
    pdf.body_text("Practice or homework sheets. Create them by hand, from the question bank, or by scanning a printed sheet. Marks are optional. Each is Draft, Ready or Published.")

    pdf.section_title("Curriculum Coverage")
    pdf.nav_path("Sidebar > Planning & Delivery > Curriculum Coverage")
    pdf.step("Choose a class and a subject. The tiles show total, taught and tested topics.")
    pdf.step("Use the coverage filter to see only what is not covered yet, and switch to 'Timeline' to see topics across the year.")
    pdf.body_text("This page is not shown to Managers or Staff.")

    # =========================================================================
    # CHAPTER 6: FINANCE MODULE
    # =========================================================================
    pdf.chapter_title("Finance Module")

    pdf.body_text("Fee collection, expenses, other income and your money accounts, all in one place.")

    pdf.section_title("Setting Up Finance Accounts")
    pdf.nav_path("Sidebar > Finance > Accounts")
    pdf.step("Open 'Manage Accounts' and click 'Add Account'.")
    pdf.step("Enter the account name, choose its type (Cash, Bank or Person) and enter the opening balance.")
    pdf.step("Keep 'Visible to Staff' ticked if staff should see this account. Click 'Save'.")
    pdf.info_box("Before you collect fees", "Create at least one Cash account and one Bank account.")

    pdf.section_title("Finance Dashboard")
    pdf.nav_path("Sidebar > Finance > Dashboard")
    pdf.body_text(
        "Your money at a glance: account balances, income, expenses, fee collection and a monthly trend. "
        "Change the period at the top, and click 'PDF' to download a finance report."
    )

    pdf.section_title("Fee Setup Page")
    pdf.nav_path("Sidebar > Finance > Fee Setup")
    pdf.body_text("Set what each class pays before you collect anything. The page has four tabs: Monthly Structure, Annual Charges, Generate Records and Student Discounts.")
    pdf.sub_section("Monthly Structure")
    pdf.step("Choose 'By Class' and click 'Edit' on the class you want to change (or '+ Set Up' if it has no fee yet).")
    pdf.step("Change the amount for the fee category. Use '+ Add Charge' for more categories.")
    pdf.step("Click 'Review & Save' to check the new total, then 'Confirm & Save'. Fee records you generate later use this amount.")
    pdf.body_text("'By Student' lets you override one student's fee; their override beats the class fee. 'Annual Charges' works the same way for yearly fees such as admission and books.")
    pdf.sub_section("Generate Records")
    pdf.step("Choose the fee type. For monthly fees, choose the month and year.")
    pdf.step("Check the preview, then click 'Generate' and confirm. Students with no fee set, or who already have a record, are skipped.")
    pdf.sub_section("Student Discounts")
    pdf.step("Choose a class to see each student's base fee, discount and effective fee. Click 'Assign' on a row to give a discount or scholarship, or 'Remove' to take it off.")
    pdf.step("Click 'Bulk Assign' to give the whole class one discount or scholarship at once.")

    pdf.section_title("Creating Individual Fee Records")
    pdf.nav_path("Sidebar > Finance > Collect Payments > Generate Single Fee Record")
    pdf.step("Click 'Generate Single Fee Record'. Choose the class, then search for the student.")
    pdf.step("Choose the fee category. The amount fills in from the fee structure.")
    pdf.step("If the student has already paid, enter the amount paid. Click 'Create'. A warning appears if the same fee already exists.")

    pdf.section_title("Fee Collection Page")
    pdf.nav_path("Sidebar > Finance > Collect Payments")
    pdf.body_text(
        "Every fee record for the chosen month, with totals (Total Payable, Received, Balance, Collection Rate) at the top. "
        "Narrow the table with the fee type, month, year, class and status filters."
    )

    pdf.section_title("Recording Payments")
    pdf.nav_path("Sidebar > Finance > Collect Payments")
    pdf.step("Tick the student's row in the fee table.")
    pdf.step("In the bar that appears, enter the amount paid and choose the account and payment method.")
    pdf.step("Click 'Update' and confirm with 'Yes', or click 'Pay Full' to take the whole balance. The status updates by itself (Paid, Partial, Unpaid or Advance).")

    pdf.section_title("Bulk Operations")
    pdf.nav_path("Sidebar > Finance > Collect Payments")
    pdf.step("Tick the box in the table header to select every student, or tick students one by one.")
    pdf.step("In the bar at the bottom, choose the account that receives the money.")
    pdf.step("Click 'Pay Full'. Every selected student is marked fully paid at once. The same bar can delete the selected records.")

    pdf.section_title("Managing Discounts & Scholarships")
    pdf.nav_path("Sidebar > Finance > Discounts")
    pdf.step("On the 'Discounts' tab, click 'Add Discount'. Enter the name, choose Percentage or Fixed Amount and enter the value.")
    pdf.step("In 'Applies To', choose all students, a grade level, a class or siblings. You can also set dates and make it stackable. Click 'Create Discount'.")
    pdf.step("Scholarships work the same way on the 'Scholarships' tab (Merit, Need, Sports, Staff Child or Other) with 'Add Scholarship'.")
    pdf.step("Give them to students from Fee Setup > Student Discounts, which shows the effect on each student's fee.")

    pdf.section_title("Recording Expenses")
    pdf.nav_path("Sidebar > Finance > Expenses")
    pdf.step("Click 'Add Expense'. Enter the amount, category, the account that pays and a description. The date is today by default.")
    pdf.step("Save. The expense is recorded and the account balance goes down.")
    pdf.step("Use the category filter to review expenses by type.")

    pdf.section_title("Online Payment Collection (when enabled)")
    pdf.info_box("Not switched on yet", "Online fee payment is not available for schools yet. Until it is, record every payment yourself under Collect Payments.")
    pdf.body_text("When it is enabled, parents see a 'Pay Now' button on unpaid fees, and paid fees are recorded for you.")
    pdf.info_box("Deleting students", "If you delete a student, their payment history is kept under 'Deleted Student'. It is better to mark a student inactive instead.")

    pdf.section_title("Inter-Account Transfers")
    pdf.nav_path("Sidebar > Finance > Accounts > Transfers tab")
    pdf.step("On the 'Transfers' tab, click 'Record Transfer'. Choose the account the money leaves and the account that receives it.")
    pdf.step("Enter the amount and a short description, then click 'Review Transfer'.")
    pdf.step("Check the details and click 'Confirm Transfer'. Both balances update and the transfer is listed.")

    pdf.section_title("Month Closing")
    pdf.nav_path("Sidebar > Finance > Accounts > Close Month")
    pdf.step("At the end of the month, click 'Close Month' at the top of Accounts (admins only). Choose the month and year.")
    pdf.step("Tick the box that confirms you understand, and click 'Close Month' again. The page now shows the last closed month.")
    pdf.warning_box("Closing locks the month: no payments, expenses or income can be added or changed in it afterwards. A month needs at least one transaction before it can be closed.")

    pdf.section_title("Fee Overview")
    pdf.nav_path("Sidebar > Finance > Fee Overview")
    pdf.step("Choose Monthly or Annual, then the month and year.")
    pdf.step("'Category-wise Collection' shows how much of each fee is collected, and the progress bar shows how much of the total is paid.")
    pdf.step("Use 'Collect Payments' to record payments, or 'Fee Setup' to change amounts. Generate the fee records first, or nothing shows here.")

    pdf.section_title("Other Income")
    pdf.nav_path("Sidebar > Finance > Other Income")
    pdf.body_text("For money that is not fees, such as sales and donations.")
    pdf.step("Click 'Add Income'. Enter the amount, choose the category and the account that receives it, and add a short description. The date is today by default.")
    pdf.step("Click 'Add Income' again to save. It appears in the list and the total at the top goes up.")

    # =========================================================================
    # CHAPTER 7: HR & STAFF MODULE
    # =========================================================================
    pdf.chapter_title("HR & Staff Management Module")

    pdf.body_text("Staff records, salaries and payslips, leave, attendance, appraisals, documents and official letters.")

    pdf.section_title("Setting Up Departments")
    pdf.nav_path("Sidebar > HR & Staff > Departments")
    pdf.step("Click 'Add Department'. Type the name (for example Science or Administration) and an optional description.")
    pdf.step("Click 'Add Department' again to save. The department is now offered when you add staff.")
    pdf.body_text("The 'Quick Add Common Departments' chips add the usual ones in one click. Designations, such as Senior Teacher, are added in the section below with 'Add Designation'.")

    pdf.section_title("Adding Staff Members")
    pdf.nav_path("Sidebar > HR & Staff > Staff Directory")
    pdf.step("Click 'Full Form'. (Use 'Quick Add' to enter only a name, phone, department and designation now and the rest later.)")
    pdf.step("Enter the first and last name, email and phone. Choose the department and designation; both are optional but make reports and payroll easier.")
    pdf.step("Click 'Add Staff Member'. A login account is optional and can be added later. The new staff member appears in the directory.")

    pdf.section_title("Staff Directory")
    pdf.nav_path("Sidebar > HR & Staff > Staff Directory")
    pdf.body_text("Everyone who works at the school. Search by name, email or employee ID, filter by department or status, click a person to open their profile, and export the list to Excel or PDF.")

    pdf.section_title("Salary Management")
    pdf.nav_path("Sidebar > HR & Staff > Salary")
    pdf.step("Click 'Add Salary Structure' and choose the staff member.")
    pdf.step("Enter the basic salary. Add allowances (such as house rent) and deductions (such as tax) with '+ Add'. The summary shows the net salary.")
    pdf.step("Set the date it starts from and click 'Create'. The person now appears in the salary list.")
    pdf.info_box("Needed for payroll", "A staff member needs a salary structure before a payslip can be generated for them.")

    pdf.section_title("Payroll Processing")
    pdf.nav_path("Sidebar > HR & Staff > Payroll")
    pdf.step("Choose the month. Click 'Generate Payslips' and confirm. A payslip is made for every active staff member with a salary structure.")
    pdf.step("Each payslip starts as a draft. Click 'Approve' to check and confirm it.")
    pdf.step("After you pay the salary, click 'Mark Paid'. Click 'View' to see the full breakdown.")
    pdf.step("Click 'Download PDF' (or 'PDF' on the row) for a printable payslip named with the staff name, month and year.")
    pdf.info_box("School logo", "The payslip shows your school logo if one is set in Settings > School Profile.")

    pdf.section_title("Leave Management")
    pdf.nav_path("Sidebar > HR & Staff > Leave")
    pdf.step("Find the pending request. It shows the leave type, the dates and the reason.")
    pdf.step("Approve or reject it, and add remarks if you like. When a request is approved, the leave balance updates automatically.")
    pdf.body_text("Staff send their own requests from Self Service (see the last topic of this chapter).")

    pdf.section_title("Staff Attendance")
    pdf.nav_path("Sidebar > HR & Staff > Attendance")
    pdf.step("The page opens on today with every staff member unmarked. Click 'Mark All Present' to start from a full day.")
    pdf.step("Change anyone who was absent, late or on leave. Check-in and check-out times are optional.")
    pdf.step("Click 'Save All'. Open the 'Summary' tab to see each person's month: present, absent, late and attendance rate.")

    pdf.section_title("Performance Appraisals")
    pdf.nav_path("Sidebar > HR & Staff > Performance")
    pdf.step("Click 'New Appraisal' and choose the staff member. Set the start and end dates of the review period.")
    pdf.step("Click the stars to give a rating, and write the strengths and the goals for the next period.")
    pdf.step("Click 'Create'. The review appears in the list with its rating, and every review for a person is kept.")

    pdf.section_title("Staff Documents")
    pdf.nav_path("Sidebar > HR & Staff > Documents")
    pdf.step("'Qualifications' tab: click 'Add Qualification', choose the staff member, the type, the qualification name, the institution and the year, then 'Create'.")
    pdf.step("'Documents' tab: click 'Add Document', choose the staff member and the type, give it a title and attach the file (required). A yellow badge warns when a document is about to expire.")

    pdf.section_title("Linking & Unlinking User Accounts")
    pdf.nav_path("Sidebar > HR & Staff > Staff Directory")
    pdf.body_text("Connect a person's HR record to the login they already have.")
    pdf.step("In the directory, find a staff member with no login and click 'Link Account'.")
    pdf.step("Search for the user by name or username and click the right one. Their username now shows on the staff row.")
    pdf.step("To remove the link, click 'Unlink' and confirm. Neither the staff record nor the user account is deleted.")
    pdf.warning_box("A user can be linked to only one staff member. If they are already linked to someone else, unlink them first.")

    pdf.section_title("Letter Composer")
    pdf.nav_path("Sidebar > HR & Staff > Letter Composer")
    pdf.step("Under 'To', click 'Employee' and pick the staff member. Their name and ID fill in for you.")
    pdf.step("Choose a 'Quick Draft Template', such as Warning Letter, or write a custom letter. The subject and body are written for you.")
    pdf.step("Read the preview on the right and edit the text. Replace the REASON placeholder with the real reason.")
    pdf.step("Click 'Generate PDF'. The letter downloads on your school letterhead and is saved in the history below.")
    pdf.info_box("Draft with AI", "Click 'Draft with AI', describe the letter in plain words, and review the draft before you generate the PDF.")
    pdf.info_box("Letterhead", "Set the letterhead in Settings > School Profile. Without one, letters print on a white background.")

    pdf.section_title("Self Service")
    pdf.nav_path("Sidebar > Self Service")
    pdf.body_text("Staff see two tabs: 'Leave' for their own leave requests and 'Attendance' for their own attendance. Teachers see these as 'My Leave' and 'My Attendance' in the sidebar.")

    # =========================================================================
    # CHAPTER 8: ADMISSIONS CRM
    # =========================================================================
    pdf.chapter_title("Admissions CRM Module")

    pdf.body_text(
        "The Admissions CRM manages the complete student enrollment pipeline from initial enquiry "
        "to final enrollment. It tracks leads, followups, and conversion rates."
    )

    pdf.section_title("Admission Workflow Overview")
    pdf.body_text(
        "Admissions uses the school's academic years (set up in Management > Sessions). "
        "When converting enquiries to students, you select the target academic year and class. "
        "The system creates the student record and enrolls them in that session."
    )

    pdf.section_title("Creating Enquiries")
    pdf.nav_path("Sidebar > Admissions > Enquiries")
    pdf.step("Click 'New Enquiry'.")
    pdf.step("Fill in: Student Name, Father Name, Mobile and Grade Applied For.")
    pdf.step("Set Source: Walk-in, Phone Call, Website, WhatsApp, Referral, Social Media, Ad Campaign or Other.")
    pdf.step("Optionally set the Next Follow-up Date and add notes.")
    pdf.step("Click 'Create Enquiry'. The enquiry appears in the list with status New.")

    pdf.section_title("Admission Pipeline Stages")
    pdf.body_text("Each enquiry progresses through these stages:")
    pdf.simple_table(
        ["Stage", "Description"],
        [
            ["NEW", "Initial enquiry received - lead captured"],
            ["CONFIRMED", "Admission confirmed - ready for conversion to student"],
            ["CONVERTED", "Converted to a student record with enrollment"],
            ["CANCELLED", "Enquiry cancelled or withdrawn"],
        ],
        [50, 140]
    )

    pdf.section_title("Managing Enquiries")
    pdf.step("View all enquiries in a searchable table or card view. Search by child name or phone number.")
    pdf.step("Filter by Grade and Source. Click a stage in the Admission funnel to filter by status.")
    pdf.step("The Admission funnel at the top shows the count for each stage (New, Confirmed, Converted, Cancelled) and the conversion rate.")
    pdf.step("Use 'Edit' to update enquiry details, 'Cancel' to mark an enquiry as cancelled, or 'Delete' to remove one that is not yet converted.")
    pdf.step("Click 'Confirm' on a New enquiry when the admission is approved.")

    pdf.section_title("Followup Management")
    pdf.step("Click 'Edit' on the enquiry.")
    pdf.step("Set the Next Follow-up Date and write what was discussed in Notes, then click 'Update Enquiry'.")
    pdf.step("The date shows in the Follow-up column of the Enquiries list, in red once it is overdue.")

    pdf.section_title("Converting Enquiries to Students")
    pdf.body_text(
        "Confirmed enquiries can be batch-converted into student records. Each converted student "
        "gets a Student record and a StudentEnrollment record linking them to the chosen academic year."
    )
    pdf.step("Select one or more enquiries with 'Confirmed' status using the checkboxes.")
    pdf.step("Click the 'Convert to students' button in the bar that appears.")
    pdf.step("In the modal, select the target Academic Year and Class & Section. Optionally tick 'Auto-generate fee records' and choose the fee types.")
    pdf.step("Click 'Convert N Enquiries'. Roll numbers are auto-assigned sequentially within that session and class.")
    pdf.step("Converted enquiries change status to 'Converted' and link to the created student.")
    pdf.info_box("Session-Scoped Admissions",
                 "You can admit students into any academic year, including a future session. "
                 "Roll numbers start from 1 for each session-class combination, independent "
                 "of other sessions. This means admissions work even before running promotion "
                 "for the current year.")
    pdf.info_box("Admissions and Promotion Relationship",
                 "Admissions create enrollment in the selected academic year directly. Promotion manages "
                 "existing enrolled students between years. If you admit future-year students before promotion, "
                 "that is valid and expected because roll numbers are scoped per academic year and class/session class.")

    pdf.section_title("Admission Analytics")
    pdf.body_text("The enquiries page provides at-a-glance analytics:")
    pdf.bullet("Admission funnel - Count of enquiries in each stage (New, Confirmed, Converted, Cancelled)")
    pdf.bullet("Conversion Rate - Percentage of enquiries that become students")
    pdf.bullet("Source Tracking - Which channels (Walk-in, Referral, etc.) bring the most enquiries")

    # =========================================================================
    # CHAPTER 9: TRANSPORT MODULE
    # =========================================================================
    pdf.chapter_title("Transport Module")

    pdf.body_text(
        "The Transport module manages school buses, routes, student-bus assignments, "
        "and daily transport attendance."
    )

    pdf.section_title("Setting Up Routes")
    pdf.nav_path("Sidebar > Transport > Routes")
    pdf.step("Click 'Add Route'.")
    pdf.step("Enter: Route Name, Start Location, End Location and Estimated Duration (minutes) - "
             "these four are required. Description and Distance (km) are optional. "
             "You can also click the maps to mark the start and end points.")
    pdf.step("Click 'Create Route'. The route appears in the list.")
    pdf.step("Click 'Stops' on the route, then '+ Add Stop'.")
    pdf.step("For each stop, enter: Stop Name, Order, Pickup Time and Drop Time (all required). "
             "Address and a map location are optional.")
    pdf.step("Click 'Add Stop'. Stops are listed in order. Use Edit or Delete on a stop to change it, "
             "and Duplicate on a route to copy it with all its stops.")

    pdf.section_title("Adding Vehicles")
    pdf.nav_path("Sidebar > Transport > Vehicles")
    pdf.step("Click 'Add Vehicle'.")
    pdf.step("Enter: Vehicle Number, Vehicle Type (Bus, Van or Car) and Capacity. "
             "Make / Model is optional.")
    pdf.step("Under Driver Information enter the Driver Name and Driver Phone (required). "
             "The Driver License Number is optional.")
    pdf.step("Choose the Assigned Route this vehicle serves (optional).")
    pdf.step("Click 'Add Vehicle'. The vehicle appears in the list, linked to the route.")

    pdf.section_title("Assigning Students to Routes")
    pdf.nav_path("Sidebar > Transport > Assignments")
    pdf.step("Click 'New Assignment'.")
    pdf.step("Search for a student by name or roll number and click the name. "
             "Repeat to add several students at once; they appear as chips above the list.")
    pdf.step("Choose the Route, then the Stop (both required). Choosing a Vehicle is optional; "
             "only vehicles on that route are listed. Set the Transport Type: Pickup Only, Drop Only or Both.")
    pdf.step("Click 'Assign'. A student can have one assignment per academic year; students "
             "who already have one are skipped.")
    pdf.step("Use the filters to find assignments by route, class or type, and 'Remove' to delete one.")

    pdf.section_title("Transport Attendance")
    pdf.nav_path("Sidebar > Transport > Attendance")
    pdf.step("Select the date (today by default) and the route. The students assigned to it are listed.")
    pdf.step("Everyone starts as Boarded. Click 'Not Boarded' or 'Absent' for the students who did not ride.")
    pdf.step("Click 'Save All'. One record is saved per student, per route, per day; "
             "saving again for the same day updates it.")

    pdf.section_title("Transport Dashboard")
    pdf.nav_path("Sidebar > Transport > Dashboard")
    pdf.body_text("The Transport Dashboard shows:")
    pdf.bullet("Total Routes - Number of active routes")
    pdf.bullet("Total Vehicles - Number of active vehicles")
    pdf.bullet("Students Assigned - Students with an active transport assignment")
    pdf.bullet("Today's Attendance - Students whose transport attendance was recorded today")
    pdf.body_text("Only School Admins and Principals can add or change Transport data; "
                  "other roles can view it.")

    # =========================================================================
    # CHAPTER 10: LIBRARY MODULE
    # =========================================================================
    pdf.chapter_title("Library Module")

    pdf.body_text(
        "The Library module provides a complete book management system including cataloging, "
        "issuing/returning books, and tracking overdue items. Only School Admins and Principals can "
        "change anything here; other staff roles can browse the catalog and see which books are out."
    )

    pdf.section_title("Setting Up Book Categories")
    pdf.nav_path("Sidebar > Library > Catalog")
    pdf.step("On the Book Catalog page, click 'Manage Categories'.")
    pdf.step("Type a Category Name (for example Fiction, Science, Mathematics, History, Reference), add an optional description and click 'Add Category'.")
    pdf.step("Use Edit to rename a category, or Delete to remove it. Its books stay in the catalog without a category.")
    pdf.step("Category names must be unique. Categories help organize and filter the book catalog.")

    pdf.section_title("Adding Books to the Catalog")
    pdf.nav_path("Sidebar > Library > Catalog")
    pdf.step("Click 'Add Book'.")
    pdf.step("Enter Title and Author (both required), then ISBN, Publisher, Category, Total Copies and Shelf Location.")
    pdf.step("Click 'Add Book'. The book appears in the catalog with all copies available.")
    pdf.step("Use the search bar to find books by title, author, or ISBN, and the Category filter to browse one section.")
    pdf.step("Edit changes a book. Total Copies cannot go below the copies currently issued.")
    pdf.step("A book that has ever been issued cannot be deleted because its history is kept. Edit it and untick Active to take it off the shelf instead.")

    pdf.section_title("Issuing Books")
    pdf.nav_path("Sidebar > Library > Issue / Return")
    pdf.step("On the 'Issue Book' tab, choose Student or Staff as the Borrower Type.")
    pdf.step("Type at least two letters of the borrower's name and pick them from the list.")
    pdf.step("Type at least two letters of the book title and pick the book (only books with copies available are listed).")
    pdf.step("Check the Due Date. It starts at today plus the loan period set in Library Settings (14 days by default).")
    pdf.step("Add optional notes and click 'Issue Book'. The book's available copies drop by 1.")
    pdf.step("A borrower cannot go over the limit set in Library Settings (3 books for a student, 5 for staff by default) or take a second copy of the same book. You can also start from the catalog: click 'Issue' next to a book.")

    pdf.section_title("Returning Books")
    pdf.nav_path("Sidebar > Library > Issue / Return")
    pdf.step("Open the 'Return Book' tab and search by student name, staff name or book title.")
    pdf.step("Click 'Process Return' next to the entry.")
    pdf.step("Check the summary. For a late book it shows the days overdue and the fine (days overdue x the daily fine in Library Settings).")
    pdf.step("Click 'Confirm Return'. The book's available copies increase by 1 and the fine is recorded on the issue.")

    pdf.section_title("Tracking Overdue Books")
    pdf.nav_path("Sidebar > Library > Overdue")
    pdf.step("The page lists every book past its due date that has not come back, oldest first, with the borrower, days overdue and the fine so far.")
    pdf.step("The summary shows the number of overdue books, the total estimated fines and the fine per day.")
    pdf.step("Click 'Return' on a row to take the book back and record its fine.")
    pdf.step("Due-date reminders to borrowers and parents are sent by the Notifications module's on-demand job, not from this page.")

    pdf.section_title("Library Dashboard")
    pdf.nav_path("Sidebar > Library > Dashboard")
    pdf.body_text("The Library Dashboard displays:")
    pdf.bullet("Book Titles - Number of active titles in the catalog")
    pdf.bullet("Total Copies - Sum of all copies of active titles")
    pdf.bullet("Currently Issued - Books checked out and not yet returned")
    pdf.bullet("Overdue Books - Issued books past their due date")
    pdf.bullet("Categories - Number of book categories")
    pdf.bullet("Most Issued Books - The five most borrowed titles")
    pdf.body_text(
        "School Admins and Principals also get a 'Library Settings' button for the loan period, the borrowing "
        "limits for students and staff, and the fine per overdue day."
    )

    # =========================================================================
    # CHAPTER 11: LMS (LEARNING MANAGEMENT)
    # =========================================================================
    pdf.chapter_title("LMS - Learning Management System")

    pdf.body_text(
        "The LMS module provides curriculum management (books, chapters, topics), lesson planning, "
        "assignments, and student submissions. It integrates with the Academics module and supports "
        "multiple languages including Urdu, Arabic, Sindhi, Pashto, and Punjabi with RTL text display."
    )

    pdf.section_title("Managing Curriculum (Books, Chapters, Topics)")
    pdf.nav_path("Sidebar > Content Creation > Curriculum")
    pdf.body_text(
        "The Curriculum page lets you organize textbooks into a Book > Chapter > Topic hierarchy "
        "for each class and subject. This structure powers syllabus progress tracking and lesson plan topic selection."
    )
    pdf.step("Select a Class and Subject from the filter dropdowns.")
    pdf.step("Click 'Add Book'. Choose the Class and Subject, enter the Title, and optionally the Author, Publisher, Edition, Language and Description, then click 'Add Book'. The toast 'Book created' confirms it.")
    pdf.step("Click the book to view its chapters and topics in the tree view.")
    pdf.step("Click 'Add Chapter' (Title, Chapter Number, Description) and, inside a chapter, 'Add Topic' (Title, Topic Number, Estimated Periods, Description). Or use 'Import Table of Contents' for bulk import.")

    pdf.sub_section("Importing Table of Contents")
    pdf.body_text("The Import Table of Contents window has two tabs:")
    pdf.step("Manual Entry: type or paste the table of contents text with indentation for chapter/topic structure, then click 'Next: Review'.")
    pdf.step(
        "Upload Photo: upload a photo of the book's printed contents page. "
        "The system extracts the text with OCR so you can review it."
    )
    pdf.step("Review and edit the chapters and topics, then apply them to create the structure.")
    pdf.info_box("Multi-Language Support",
        "The OCR feature supports all configured languages. For non-English books, the system uses the book's "
        "language setting to optimize text recognition. The editor displays RTL direction automatically for supported languages."
    )

    pdf.sub_section("Syllabus Progress")
    pdf.body_text(
        "A progress bar shows how many topics have been covered by published lesson plans. "
        "Topics are automatically marked as covered when a teacher publishes a lesson plan referencing them."
    )

    pdf.section_title("Creating Lesson Plans")
    pdf.nav_path("Sidebar > Planning & Delivery > Lesson Plans")
    pdf.body_text("This page is not available to the Manager role.")
    pdf.step("Click 'Add Lesson Plan'. This opens the bulk wizard; click 'Create single lesson plan' for one plan.")
    pdf.step("Choose Minimal (Class, Subject, chapters/topics, Lesson Date, Teacher; saved as a Draft with an automatic title) or Standard (full details).")
    pdf.step("In Standard mode enter Title, Description and Objectives, then set Duration (minutes), Materials Needed and Teaching Methods.")
    pdf.step("Standard mode also has a Status of Draft or Published. Click 'Create Lesson Plan'; the toast 'Lesson plan created successfully!' confirms it.")
    pdf.step("A Draft can be published later with the 'Publish' button on its row.")

    pdf.section_title("Creating Assignments")
    pdf.nav_path("Sidebar > Academics > Assignments")
    pdf.step("Click 'Create Assignment'.")
    pdf.step("Enter the Title, then select Class, Subject and Teacher.")
    pdf.step("Choose the Assignment Type: Homework, Project, Classwork or Lab. Diary entries use 'Create Daily Diary' instead.")
    pdf.step("Set the Due Date (required when 'Require student submission' is on) and Total Marks; turn 'Allow file attachments' on or off.")
    pdf.step("Enter the Description (required) and Instructions.")
    pdf.step("Click 'Create Assignment'. New assignments start as Draft; click 'Publish' on the row to make them appear in student portals.")

    pdf.section_title("Reviewing Submissions")
    pdf.nav_path("Sidebar > Academics > Assignments > Submissions")
    pdf.step("Click the number in the Submissions column of an assignment (or the 'Submissions' button in card view).")
    pdf.step("For each submission you can view the submitted text or attached file, enter Marks and Feedback, and click 'Grade' then 'Save'.")
    pdf.step("Graded submissions can be re-graded or sent back to the student with 'Return'.")
    pdf.step("The cards at the top count Total, Submitted, Graded, Returned, Pending and Late submissions.")

    # =========================================================================
    # CHAPTER 12: NOTIFICATIONS
    # =========================================================================
    pdf.chapter_title("Notifications Module")

    pdf.body_text(
        "The Notifications module enables school-wide communication with students, parents, and staff. "
        "Admins can create templates, send bulk notifications, and track delivery."
    )

    pdf.section_title("Viewing Notifications (All Users)")
    pdf.nav_path("Sidebar > Notifications")
    pdf.step("Click the Notification Bell icon in the top bar for a quick dropdown (shows 8 most recent). The bell bounces when new notifications arrive.")
    pdf.step("Or navigate to 'Notifications' in the sidebar for the full Inbox tab with pagination.")
    pdf.step("Unread notifications stand out with a bold white card; click a notification to mark it as read (it also opens the related page, such as Fee Collection). Older ones are grouped under Today, Yesterday and Earlier.")
    pdf.step("Use 'Mark all read' (with confirmation) to clear all unread notifications at once.")
    pdf.step("Filter with the 'All Types' dropdown (Absence, Fee Due, Exam Result, Transport Update, etc.) or tick 'Unread only'.")

    pdf.section_title("Creating Notification Templates (Admin)")
    pdf.nav_path("Sidebar > Notifications > Templates Tab")
    pdf.step("Switch to the 'Templates' tab.")
    pdf.step("Click 'New Template'.")
    pdf.step("Enter a Template Name, pick the Event Type and Channel, add an optional Subject, and write the Message body (placeholders use double braces, like {{student_name}}).")
    pdf.step("Click 'Save'. Use Edit, Duplicate, Preview or Delete on any row later; untick 'Active' to hide a template from the Send tab. Templates marked 'Shared' belong to every school and cannot be changed.")

    pdf.section_title("Sending Notifications (Admin)")
    pdf.nav_path("Sidebar > Notifications > Send Tab")
    pdf.step("Switch to the 'Send' tab.")
    pdf.step("Choose the mode: 'Broadcast to Group' for everyone in a role, or 'Single Recipient' for one person (phone, email or user ID).")
    pdf.step("In Broadcast mode, select a group: All Parents, All Teachers, All Staff, All Admins, Principals, Managers, Accountants, or All Students. Optionally narrow parents or students to one session class.")
    pdf.step("Optionally pick an existing template to pre-fill the message, or compose a custom message.")
    pdf.step("Choose the channel: In-App (also delivered as a mobile push notification) or Email.")
    pdf.step("Click 'Review & Send Broadcast', check the estimated recipients, then 'Confirm Send' (Single mode: 'Send Notification'). If the text still contains {{placeholders}} a warning appears first; manual sends do not fill them in. A message shows how many were sent, skipped or failed. 'Test Send to Me' sends a copy to your own inbox.")
    pdf.info_box("Run Now buttons", "At the top of the Send tab, 'Send Fee Reminders Now', 'Generate Daily Report Now' and "
                 "'Remind Teachers to Mark Attendance' fire this school's automatic notifications on demand.")

    pdf.section_title("Notification Analytics (Admin)")
    pdf.nav_path("Sidebar > Notifications > Analytics Tab")
    pdf.body_text("Track notification effectiveness with configurable date ranges (7 days, 30 days, 90 days, or all time):")
    pdf.bullet("Delivery Rate - How many notifications were successfully delivered")
    pdf.bullet("Read Rate - Percentage of notifications opened/read")
    pdf.bullet("Breakdown by channel (In-App, Email, Push) and event type")

    pdf.section_title("Automation Settings")
    pdf.nav_path("Sidebar > Notifications > Settings")
    pdf.body_text(
        "Configure notification channels, smart scheduling (AI-optimized send times), and "
        "automated notification controls from the Settings tab. Each automation type can be "
        "toggled ON/OFF per school. Toggles are module-aware: if a module (e.g., Transport, "
        "Finance) is disabled for the school, its related toggles are automatically hidden."
    )
    pdf.simple_table(
        ["Automation", "Default", "Trigger"],
        [
            ["Absence Alerts", "ON", "Sent when attendance is marked"],
            ["Fee Reminders", "ON", "Monthly on configured day"],
            ["Fee Overdue Alerts", "ON", "Weekly on Mondays"],
            ["Exam Results Published", "ON", "When admin publishes results"],
            ["Daily Absence Summary", "OFF", "Sent daily at configured time"],
            ["Transport Notifications", "ON", "Bus departed, arriving at stop, journey completed"],
            ["Smart Scheduling", "OFF", "AI learns optimal send times over 2-4 weeks"],
        ],
        [50, 25, 115]
    )
    pdf.body_text(
        "The Settings tab also warns you about unsaved changes before navigating away. "
        "Channel toggles cover In-App and Email; push notifications are delivered together with In-App."
    )
    pdf.info_box("Background Tasks", "Scheduled notifications such as absence summaries, fee reminders and "
                 "attendance reminders run automatically. No manual action required.")

    # =========================================================================
    # CHAPTER 13: MESSAGING
    # =========================================================================
    pdf.chapter_title("Messaging")

    pdf.body_text(
        "The Messaging module provides a unified, threaded conversation system for all school roles. "
        "Admins, Teachers, Staff, Parents, and Students can exchange messages with role-based "
        "access controls determining who can contact whom."
    )

    pdf.section_title("Who Can Message Whom")
    pdf.simple_table(
        ["Sender Role", "Can Message", "Student Context"],
        [
            ["School Admin / Principal", "Any staff member in the school", "Not required"],
            ["Teacher", "Parents of students in their classes", "Required (auto-set)"],
            ["Teacher", "Students with accounts in their classes", "Required (auto-set)"],
            ["Teacher", "Admins and Principal", "Not required"],
            ["Other Staff", "Admins and Principal", "Not required"],
            ["Parent", "Teachers of their children's classes", "Required (auto-set)"],
        ],
        [45, 65, 80]
    )

    pdf.section_title("Accessing Messages")
    pdf.nav_path("Sidebar > Messages")
    pdf.body_text(
        "All roles access the same Messages page from the sidebar. The page shows a split-panel "
        "layout: thread list on the left, conversation view on the right. On mobile devices, "
        "the view switches between list and conversation."
    )

    pdf.section_title("Starting a New Conversation")
    pdf.nav_path("Messages > New Message button")
    pdf.step("Click the 'New Message' button (top of the thread list).")
    pdf.step("Pick who to write to using the Staff, Parent or Student tabs, then search for the name in the 'To' box.")
    pdf.step("For teacher-parent/student conversations, the student context is automatically set based on the recipient.")
    pdf.step("Optionally enter a subject line for the conversation.")
    pdf.step("Type your message and click 'Send Message'.")
    pdf.info_box("Thread Reuse", "If you already have an active conversation with the same person "
                 "(and same student context), your new message will be added to the existing thread "
                 "instead of creating a duplicate.")

    pdf.section_title("Replying to Messages")
    pdf.step("Click on any thread in the thread list to open the conversation.")
    pdf.step("All messages in the thread are displayed chronologically (oldest first).")
    pdf.step("Your messages appear on the right side, the other person's on the left.")
    pdf.step("Type your reply in the box at the bottom, then press Enter or click the paper-plane button (Shift+Enter starts a new line).")
    pdf.step("The thread is automatically marked as read when you open it.")

    pdf.section_title("Unread Message Indicators")
    pdf.body_text(
        "Unread threads are highlighted in the thread list with a blue badge showing the unread "
        "message count. The Messages navigation item in the sidebar also shows a total unread "
        "count badge. The badge updates automatically every 15 seconds."
    )

    pdf.section_title("Searching Conversations")
    pdf.step("Use the search box at the top of the thread list to filter conversations.")
    pdf.step("Search matches against participant names and the latest message preview.")

    # =========================================================================
    # CHAPTER 14: PARENT PORTAL
    # =========================================================================
    pdf.chapter_title("Parent Portal")

    pdf.body_text(
        "Parents have a dedicated portal to monitor their children's school activities. "
        "Parents can view attendance, fees, timetable, exam results, and communicate with the school."
    )

    pdf.section_title("Parent Dashboard")
    pdf.nav_path("Login as Parent > Dashboard")
    pdf.body_text("After logging in, parents see their dashboard with:")
    pdf.bullet("List of linked children (if multiple children attend the school)")
    pdf.bullet("Quick action cards for common tasks (Apply Leave, Messages)")
    pdf.bullet("Recent notifications from the school")

    pdf.section_title("Viewing Child's Information")
    pdf.step("On the dashboard, click 'Overview' on a child's card to open their overview page.")
    pdf.step("The header shows the child's photo, name, class and roll number.")
    pdf.step("Four cards summarise: Attendance Rate, Fees (amount due, or 'Nothing due'), Last Exam and Days Present.")
    pdf.step("Under 'Details', choose Attendance Calendar, Fee Details, Timetable, Exam Schedule or Exam Results for the full pages.")

    pdf.sub_section("Attendance")
    pdf.nav_path("Parent Portal > Child > Attendance")
    pdf.step("Click 'Attendance' to view the child's attendance records.")
    pdf.step("See monthly and daily breakdowns with Present/Absent/Late counts.")
    pdf.step("View attendance percentage and trends.")

    pdf.sub_section("Fees & Online Payments")
    pdf.nav_path("Parent Portal > Child > Fees")
    pdf.step("View fee balance, payment history, and outstanding amounts.")
    pdf.step("See due amounts and upcoming fee deadlines.")
    pdf.step("Download fee receipts for past payments.")

    pdf.sub_section("Paying Fees Online (when enabled)")
    pdf.info_box("Not enabled yet", "Online payment is not available yet. Pay at the school office until your school announces it.")
    pdf.nav_path("Parent Portal > Child > Fees > Pay Now")
    pdf.step("If the school has configured online payment gateways, a 'Pay Now' button appears next to each unpaid fee.")
    pdf.step("Click 'Pay Now' on the fee you wish to pay.")
    pdf.step("A modal appears showing available payment methods (e.g., JazzCash, Easypaisa, Manual Transfer).")
    pdf.step("Select your preferred payment method and click 'Proceed to Pay'.")
    pdf.step("For JazzCash/Easypaisa: You will be redirected to the gateway's checkout page to complete payment.")
    pdf.step("For Manual Transfer: Bank account details are displayed. Make the transfer and inform the school office.")
    pdf.step("After payment, you are redirected to a Payment Result page showing the transaction status.")
    pdf.step("Payment statuses: Successful (green), Pending (yellow - being verified), Failed (red - try again).")
    pdf.step("Pending payments are automatically verified within a few minutes. The page auto-refreshes.")

    pdf.info_box("Online Payment Availability", "Online payments are only available if your school's administration "
                 "has switched online payment on. If you don't see the Pay Now button, pay at the school office.")

    pdf.sub_section("Timetable")
    pdf.nav_path("Parent Portal > Child > Timetable")
    pdf.step("View the child's class timetable.")
    pdf.step("See subjects, teachers, and period timings for each day.")

    pdf.sub_section("Exam Results")
    pdf.nav_path("Parent Portal > Child > Exam Results")
    pdf.step("View exam marks and grades (once published by the school).")
    pdf.step("See subject-wise marks, percentage and grade for each exam.")

    pdf.section_title("Applying for Leave")
    pdf.nav_path("Parent Portal > Leave Application")
    pdf.step("Click 'Leave Requests' in the sidebar. The 'Apply for Leave' tab opens first.")
    pdf.step("Select the child, then enter Start Date, End Date and Reason. A supporting document link is optional.")
    pdf.step("Click 'Submit Leave Request'. The message 'Leave request submitted successfully.' appears.")
    pdf.step("Open the 'My Requests' tab to track the status (Pending, Approved, Rejected or Cancelled) and read the school's remarks.")
    pdf.step("A request that is still Pending can be cancelled with 'Cancel'.")

    pdf.section_title("Messages")
    pdf.nav_path("Sidebar > Messages")
    pdf.body_text(
        "Parents can send and receive threaded messages with their children's teachers. "
        "See the Messaging chapter for full details on how conversations work."
    )

    # =========================================================================
    # CHAPTER 14: STUDENT PORTAL
    # =========================================================================
    pdf.chapter_title("Student Portal")

    pdf.body_text(
        "Students have their own portal to view attendance, timetable, assignments, "
        "fees, exam results, and manage their profile."
    )

    pdf.section_title("Student Dashboard")
    pdf.nav_path("Login as Student > Dashboard")
    pdf.body_text("The Student Dashboard displays:")
    pdf.bullet("Welcome card with student name and class")
    pdf.bullet("Attendance rate (percentage)")
    pdf.bullet("Assignment stats (pending, submitted, graded)")
    pdf.bullet("Fee balance summary")
    pdf.bullet("Today's timetable")
    pdf.bullet("Upcoming assignment deadlines")

    pdf.section_title("My Attendance")
    pdf.nav_path("Student Portal > Attendance")
    pdf.step("View your attendance history with monthly/daily breakdown.")
    pdf.step("See attendance percentage and trend over time.")

    pdf.section_title("My Timetable")
    pdf.nav_path("Student Portal > Timetable")
    pdf.step("View your class timetable for each day of the week.")
    pdf.step("See subject names, teacher names, and period timings.")

    pdf.section_title("My Assignments")
    pdf.nav_path("Student Portal > Assignments")
    pdf.step("The page lists every assignment from your teachers with its subject, type, due date and status.")
    pdf.step("Diary entries are for reading only; they have no Submit button.")
    pdf.step("Click 'Submit' on an open assignment, type your answer in Submission Text (required), and optionally add a link to your file and a file name.")
    pdf.step("Click 'Submit Assignment'. The message 'Assignment submitted successfully!' appears. Late work is marked Late.")
    pdf.step("After the teacher grades it, the card shows your marks and feedback. Closed assignments can no longer be submitted.")

    pdf.section_title("My Fees")
    pdf.nav_path("Student Portal > Fees")
    pdf.step("View your fee balance and payment history.")
    pdf.step("See upcoming due dates.")

    pdf.section_title("My Results")
    pdf.nav_path("Student Portal > Results")
    pdf.step("Each published exam appears as a card with your total, percentage and grade. Click its title to open or close the subject table.")
    pdf.step("The table lists marks, total marks, percentage and a Pass or Fail badge for each subject; an absent paper shows 'Absent'.")

    pdf.section_title("My Profile")
    pdf.nav_path("Student Portal > My Profile")
    pdf.step("View and update your profile information.")
    pdf.step("See contact details and class information.")

    pdf.section_title("AI Study Helper")
    pdf.nav_path("Student Portal > AI Study Helper")
    pdf.body_text(
        "The AI Study Helper is an intelligent chatbot that assists students with their studies. "
        "It is aware of the student's class, subjects, lesson plans, and assignments, allowing it "
        "to provide personalized, curriculum-aligned academic support."
    )
    pdf.step("Navigate to 'AI Study Helper' in the student sidebar.")
    pdf.step("Type your study question in the message box at the bottom of the screen.")
    pdf.step("Click Send or press Enter to submit your question.")
    pdf.step("The AI will respond with explanations, examples, and study tips tailored to your curriculum.")
    pdf.step("Your conversation history is saved and can be reviewed later.")
    pdf.step("Use the suggestion chips (e.g., 'Help me understand fractions', 'Explain photosynthesis') for quick prompts.")
    pdf.step("Click 'Clear Chat' to start a fresh conversation.")
    pdf.info_box("Daily Limit", "Students can send up to 30 messages per day to the AI Study Helper. "
                 "The counter resets every 24 hours. This ensures fair usage for all students.")
    pdf.warning_box("The AI Study Helper is designed for academic topics only. Questions about personal information, "
                    "violence, or other inappropriate content will be blocked by the safety system.")

    # =========================================================================
    # CHAPTER 15: HOSTEL MANAGEMENT
    # =========================================================================
    pdf.chapter_title("Hostel Management")

    pdf.body_text(
        "The Hostel Management module helps schools manage their boarding facilities. "
        "It covers hostel buildings, rooms, student allocations, and gate passes for "
        "students leaving and returning to the hostel. Hostel pages are available to "
        "School Admin and Principal roles only, because they list students and the reasons "
        "for their leave."
    )

    pdf.section_title("Hostel Dashboard")
    pdf.nav_path("Sidebar > Hostel > Dashboard")
    pdf.body_text("The Hostel Dashboard provides a quick overview of all hostel operations:")
    pdf.bullet("Total hostels and rooms, total capacity and current occupancy")
    pdf.bullet("Occupancy rate (percentage of available beds filled) and available beds")
    pdf.bullet("Pending gate pass requests")
    pdf.bullet("Students currently out on gate passes")
    pdf.bullet("Number of boys' and girls' hostels")
    pdf.bullet("Quick action links to manage rooms, allocations, and gate passes")

    pdf.section_title("Managing Hostels & Rooms")
    pdf.nav_path("Sidebar > Hostel > Rooms")
    pdf.sub_section("Creating a Hostel")
    pdf.step("Navigate to Hostel > Rooms in the sidebar. The 'Hostels' tab is open.")
    pdf.step("Click 'Add Hostel'.")
    pdf.step("Enter the Hostel Name, choose the Hostel Type (Boys / Girls / Mixed) and enter the Capacity.")
    pdf.step("Optionally enter the Address and Contact Number, and choose a Warden from your active staff.")
    pdf.step("Click 'Add Hostel'. The hostel appears in the list with its occupancy.")

    pdf.sub_section("Creating Rooms")
    pdf.step("Open the 'Rooms' tab and choose a hostel in 'Select Hostel'.")
    pdf.step("Click 'Add Room'.")
    pdf.step("Enter the Room Number, Floor and Capacity, and choose the Room Type (Single / Double / Dormitory).")
    pdf.step("Click 'Add Room'. The room shows its occupancy and whether it is Available, Full or Unavailable.")
    pdf.info_box("Room status", "A room shows Full when every bed is taken. Untick 'Available for allocation' "
                 "when you take a room out of use; it is then shown as Unavailable and cannot be chosen for new allocations. "
                 "A room's capacity cannot be lowered below the number of students in it.")
    pdf.warning_box("A hostel or room that has student allocation records cannot be deleted, so the history is kept. "
                    "Mark a hostel Inactive, or a room Unavailable, instead.")

    pdf.section_title("Student Allocations")
    pdf.nav_path("Sidebar > Hostel > Allocations")
    pdf.body_text(
        "Allocations assign students to specific hostel rooms for an academic year. "
        "The list can be filtered by hostel, by status (Active or Vacated) and searched by student name."
    )
    pdf.sub_section("Allocating a Student")
    pdf.step("Navigate to Hostel > Allocations and click 'Allocate Student'.")
    pdf.step("The Academic Year is the current one. Search for and choose the Student; students who already hold a bed this year are not listed.")
    pdf.step("Choose the Hostel, then a Room. Only rooms with a free bed are listed.")
    pdf.step("Click 'Allocate'. The student appears in the list with the room.")
    pdf.sub_section("Vacating a Student")
    pdf.step("Find the active allocation in the list and click 'Vacate'.")
    pdf.step("Confirm. The allocation is marked Vacated with today's date and the room's occupancy decreases.")
    pdf.step("Choose 'Vacated' in the status filter to see students who have left.")
    pdf.warning_box("Each student can only hold one active hostel bed per academic year. "
                    "Vacate the current allocation before placing the student in another room; "
                    "a vacated student can be allocated again in the same year.")

    pdf.section_title("Gate Passes")
    pdf.nav_path("Sidebar > Hostel > Gate Passes")
    pdf.body_text(
        "Gate passes track students leaving and returning to the hostel. "
        "They follow a workflow: Request > Approve/Reject > Check Out > Return."
    )
    pdf.sub_section("Creating a Gate Pass")
    pdf.step("Click 'New Gate Pass'.")
    pdf.step("Choose the Student (only students who currently hold a hostel bed are listed) and the Pass Type (Day Pass / Overnight / Weekend / Vacation Leave).")
    pdf.step("Enter the Reason and where the student is Going To, and optionally a contact number at the destination.")
    pdf.step("The Departure Date and Expected Return are filled in (the next full hour, and eight hours later); change them if needed, then click 'Create Gate Pass'. The pass starts as Pending Approval.")
    pdf.sub_section("Approving / Rejecting Gate Passes")
    pdf.step("Review pending gate passes in the list.")
    pdf.step("Click 'Approve' to authorize the student's departure, or 'Reject' to deny the request.")
    pdf.step("Add optional remarks in the box and confirm.")
    pdf.sub_section("Check Out & Return")
    pdf.step("When the student leaves the gate, click 'Check Out' on the approved pass.")
    pdf.step("When the student is back, click 'Mark Returned'. The actual return time is recorded.")
    pdf.simple_table(
        ["Status", "Meaning", "Next Action"],
        [
            ["Pending Approval", "Pass requested, awaiting approval", "Approve or Reject"],
            ["Approved", "Pass approved, student may leave", "Check Out when departing"],
            ["Rejected", "Pass denied", "No further action"],
            ["Checked Out", "Student has left the hostel", "Mark Returned when student comes back"],
            ["Returned", "Student has returned to hostel", "Complete - no action needed"],
        ],
        [35, 75, 80]
    )

    # =========================================================================
    # CHAPTER 16: SETTINGS & CONFIGURATION
    # =========================================================================
    pdf.chapter_title("Settings & Configuration")

    pdf.body_text(
        "The Settings page has two tabs: Profile (your own account and school preferences such as "
        "Examination Settings) and Users (School Admins and Principals manage user accounts there)."
    )

    pdf.section_title("Examination Settings")
    pdf.nav_path("Sidebar > Settings > School Profile > Examination Settings")
    pdf.body_text(
        "Toggle between Simple Average and Weighted Average for report card calculations. "
        "When Weighted Average is enabled, each exam type's contribution is scaled by its weight "
        "(configured in Exam Types). See Chapter 6 (Examinations) for details."
    )

    pdf.section_title("Finance Accounts Management")
    pdf.body_text("See Chapter 7 (Finance Module) > Setting Up Finance Accounts for detailed instructions.")

    pdf.section_title("Online Payments")
    pdf.info_box("Not enabled yet",
                 "Online payment gateways are not configured for schools yet, so there is nothing to set up "
                 "here. Record fee payments under Finance > Collect Payments. This section will be "
                 "updated when online payments are switched on.")

    # =========================================================================
    # CHAPTER 17: USER MANAGEMENT
    # =========================================================================
    pdf.chapter_title("User Management")

    pdf.body_text(
        "Education AI uses a hierarchical role system for user management. "
        "School Admins and Principals can create and manage users within their schools."
    )

    pdf.section_title("User Roles & Hierarchy")
    pdf.body_text("The system has the following roles, listed from highest to lowest privilege:")
    pdf.simple_table(
        ["Role", "Can Create", "Typical Sidebar"],
        [
            ["Super Admin", "All roles, including Super Admin", "Everything, across schools"],
            ["School Admin", "Principal, Manager, Accountant, Teacher, Staff, Driver", "Everything in the school"],
            ["Principal", "Manager, Accountant, Teacher, Staff, Driver", "Everything in the school"],
            ["Manager", "- (no user creation)", "Dashboard, Academics, Content Creation, Management"],
            ["Accountant", "- (no user creation)", "Finance"],
            ["Teacher", "- (no user creation)", "Own classes: Attendance, Academics, Content Creation, Planning"],
            ["Staff", "- (no user creation)", "Limited menu: notifications and messages"],
            ["Driver", "- (no user creation)", "Transport"],
            ["Parent", "- (self-registered via invite)", "Parent portal: own child's data only"],
            ["Student", "- (self-registered via invite)", "Student portal: own data only"],
        ],
        [35, 75, 80],
    )
    pdf.info_box("What you see",
                 "The sidebar also depends on which modules your school has enabled. If you cannot see a "
                 "page, your role or your school's modules do not include it.")

    pdf.section_title("Managing Users (School Admin & Principal)")
    pdf.nav_path("Sidebar > Settings > Users Tab")
    pdf.body_text(
        "School Admins and Principals can create, edit, and deactivate user accounts "
        "for their school from the Users tab in Settings."
    )
    pdf.step("Navigate to Settings and click the 'Users' tab.")
    pdf.step("Click 'Add User' to open the user creation form.")
    pdf.step("Fill in First name, Last name, Username (required), Email, Password, Confirm password, select a Role from the dropdown, and add a Phone number if you want.")
    pdf.step("The role dropdown only shows roles you are allowed to create based on your role.")
    pdf.step("Click 'Create User' to save. A school membership is automatically created.")
    pdf.step("To edit a user, click 'Edit' in the actions column. You can change name, email, role, and phone.")
    pdf.step("To reset a forgotten password, click 'Reset Password' on the user's row. Choose 'Set a new password now' and type the New Password (at least 8 characters) twice, or choose 'Email a reset link' (only available when the user has an email address), then press 'Reset Password' or 'Send Email'.")
    pdf.step("To deactivate a user, click 'Deactivate'. The user will no longer be able to log in.")
    pdf.step("To reactivate, click 'Activate' on an inactive user.")

    pdf.info_box("Role Restrictions",
                 "You can only edit or deactivate users whose role you are allowed to create. "
                 "For example, a Principal cannot deactivate a School Admin.")

    pdf.section_title("Creating Student User Accounts")
    pdf.nav_path("Sidebar > Management > Students > Add Student")
    pdf.body_text(
        "When adding a new student, you can optionally create a user account so the student "
        "can access the Student Portal."
    )
    pdf.step("Open the Add Student modal and fill in the student details (Class, Name, Roll Number).")
    pdf.step("Check the 'Create User Account (Student Portal)' checkbox at the bottom of the form.")
    pdf.step("Additional fields will appear: Username (auto-suggested from student name), Email, Password, and Confirm Password.")
    pdf.step("Fill in the login credentials. Password must be at least 8 characters.")
    pdf.step("Click 'Add Student'. Both the student record and user account will be created together.")
    pdf.step("The student can now log in to the Student Portal using these credentials.")

    pdf.section_title("Converting Existing Students to Users")
    pdf.nav_path("Sidebar > Management > Students")
    pdf.body_text(
        "Students without accounts show 'No Account' in the Account column. "
        "Individual: Click 'Create Account' next to any student, fill in credentials, and save. "
        "Bulk: Select multiple students using checkboxes, click 'Create Accounts' in the floating bar, "
        "set a default password, and confirm. Usernames are auto-generated (e.g., 'Ahmed Khan' becomes 'ahmed_khan')."
    )

    pdf.section_title("Creating Staff User Accounts")
    pdf.nav_path("Sidebar > HR & Staff > Staff Directory")
    pdf.body_text(
        "When adding a new staff member (full form or Quick Add), check 'Create User Account' "
        "to set up login credentials alongside the staff record. Select a User Role (Teacher, Staff, "
        "Manager, Accountant, Driver) to determine system access level."
    )

    pdf.section_title("Converting Existing Staff to Users")
    pdf.body_text(
        "Staff without accounts show 'No Account' in the Account column. "
        "Individual: Click 'Create Account', set role and credentials. "
        "Bulk: Select multiple staff, click 'Create Accounts', choose default role and password. "
        "Usernames are auto-generated (e.g., 'Jane Doe' becomes 'jane_doe')."
    )

    pdf.section_title("Linking Existing User Accounts to Staff")
    pdf.body_text(
        "If a user account already exists separately (e.g., created before the staff record), "
        "you can link them from the Staff Directory. Click 'Link Account' on the staff row, "
        "search for the user, and select them. To unlink, click the 'Unlink' button. "
        "See Chapter 8 (HR & Staff > Linking & Unlinking User Accounts) for full details."
    )

    pdf.warning_box("Passwords cannot be recovered. If a user forgets their password, "
                    "a School Admin must reset it from the Users tab.")


    # =========================================================================
    # CHAPTER: AI INTELLIGENCE FEATURES
    # =========================================================================
    pdf.chapter_title("AI Features")

    pdf.body_text(
        "Education AI includes AI-assisted features that help with everyday work: dashboard insights, "
        "timetable generation, report card comments and letter drafting. Always review AI output "
        "before sharing it."
    )

    pdf.section_title("AI Dashboard Insights")
    pdf.body_text(
        "The admin dashboard surfaces AI-generated actionable insights across all modules: "
        "Alerts (red) for urgent issues, Warnings (amber) for important items, and Info (blue) "
        "for setup reminders. Each insight links directly to the relevant page. "
        "Insights are role-specific (teachers see attendance only, accountants see finance only)."
    )

    pdf.section_title("OR-Tools Timetable Optimization")
    pdf.nav_path("Sidebar > Academics > Timetable > Auto-Generate")
    pdf.body_text(
        "Timetable auto-generation supports two algorithms: 'Quick (Greedy)' for near-instant drafts, "
        "and 'Optimal (OR-Tools)' for higher quality schedules (up to 30 seconds). OR-Tools enforces "
        "hard constraints (no double-booking) and optimizes subject distribution across days."
    )

    pdf.section_title("AI Report Card Comments")
    pdf.nav_path("Sidebar > Academics > Results")
    pdf.body_text(
        "Generate personalized comments for each student's exam performance based on marks, grades, "
        "and attendance. Click 'Generate Comments' on an exam's results page. Comments appear "
        "on report cards automatically. Teachers should review before sharing with parents."
    )
    pdf.info_box("Fallback", "Without a Groq API key, the system generates rule-based comments automatically.")

    pdf.section_title("AI Letter Drafting")
    pdf.nav_path("Sidebar > HR & Staff > Letter Composer > Draft with AI")
    pdf.body_text(
        "The Letter Composer includes an AI assistant that drafts professional letters from natural "
        "language descriptions. Enter a prompt like 'Write a warning letter for late attendance' or "
        "'Draft an experience certificate for Rajesh who joined 3 years ago as a Math teacher' and "
        "the AI generates a complete subject and body. The AI uses template context (if a template "
        "type is selected) and employee details (if an employee is selected) for more accurate drafts. "
        "Quick suggestion chips are provided for common letter types."
    )
    pdf.info_box(
        "Fallback",
        "Without a Groq API key, the system matches keywords in your prompt to built-in templates "
        "and returns the closest matching template. You can always edit the content manually."
    )

    pdf.section_title("At-Risk Students (Attendance)")
    pdf.nav_path("Dashboard > AI Insights > At-Risk Students")
    pdf.body_text(
        "Students flagged by the attendance risk predictor, showing current attendance, predicted attendance in 4 weeks "
        "and a trend (Declining, Stable, Improving). Filter by severity (High, Medium, Low) and class. School Admin and Principal only."
    )
    pdf.section_title("Student Risk Score")
    pdf.nav_path("Sidebar > Management > Student Risk Score")
    pdf.body_text(
        "A combined risk score that blends attendance, fee default likelihood and academic performance. "
        "Filter by severity and class. School Admin and Principal only."
    )
    pdf.section_title("Academic Risk")
    pdf.nav_path("Sidebar > Academic Risk")
    pdf.body_text(
        "Students trending toward failing grades, showing their average and predicted next exam with a trend. "
        "Filter by severity and class. School Admin and Principal only."
    )
    pdf.section_title("Staff Risk")
    pdf.nav_path("Sidebar > HR & Staff > Staff Risk")
    pdf.body_text(
        "Staff flagged for rising leave frequency or declining attendance, showing leave days (last 90 days), "
        "absence rate and trend. Filter by severity and department. School Admin and Principal only."
    )
    pdf.warning_box("Risk scores are AI estimates meant to start a conversation, not a final judgment about a person. "
                    "Select an academic year first for the student pages.")

    # =========================================================================
    # CHAPTER: INVENTORY & STORE
    # =========================================================================
    pdf.chapter_title("Inventory & Store")

    pdf.body_text(
        "The Inventory module tracks store items, stock movements and items assigned to staff. "
        "It is available to School Admins and Principals."
    )

    pdf.section_title("Inventory Dashboard")
    pdf.nav_path("Sidebar > Inventory > Dashboard")
    pdf.body_text("Shows Total Items, Total Stock Value, Active Assignments, Low Stock Alerts and Recent Transactions, with quick links to the other pages.")

    pdf.section_title("Items & Stock")
    pdf.nav_path("Sidebar > Inventory > Items")
    pdf.step("Click the 'Categories' and 'Vendors' buttons at the top first and add the categories and vendors you use.")
    pdf.step("Add an item: Name, Category, Unit (Pieces, Packets, Boxes, Kilograms, Litres, Sets, Reams, Dozens, Metres), Current Stock, Minimum Stock, Unit Price and Storage Location.")
    pdf.step("Filter the list by category and stock status: In Stock, Low Stock or Out of Stock.")
    pdf.step("Use 'AI Suggest' to get suggested items for the kind of school you describe, select the ones you want and add them.")

    pdf.section_title("Stock Transactions")
    pdf.nav_path("Sidebar > Inventory > Transactions")
    pdf.body_text("School Admins and Principals record stock movements here; other roles with inventory access can only view the history. Issues and Returns are not entered by hand: they are created automatically when you assign an item or mark it returned (see Item Assignments).")
    pdf.step("Press '+ Record Transaction'.")
    pdf.step("Choose the type: Purchase (new stock from a vendor), Adjustment (correct a stock count) or Disposal (damaged or expired items).")
    pdf.step("Select the Item. Its current stock is shown in the list and its unit price is filled in for you.")
    pdf.step("Enter the Quantity. For a Disposal enter a positive number; the stock is reduced for you. For an Adjustment use a negative number to reduce stock. Stock can never go below zero.")
    pdf.step("Choose the Vendor (Purchase only), set the Date, add a Reference number such as an invoice or PO, and any Remarks, then press 'Record Transaction'. A 'Transaction recorded' message appears and the item's stock updates.")
    pdf.step("Filter the history by Type and by From and To dates. Issue and Return rows created by assignments appear here too.")

    pdf.section_title("Item Assignments")
    pdf.nav_path("Sidebar > Inventory > Assignments")
    pdf.body_text("School Admins and Principals assign items and mark them returned. Accountants, Teachers and Staff can only view assignments (Teachers and Staff see just the items assigned to them).")
    pdf.step("Press '+ Assign Item'.")
    pdf.step("Choose the Item (only items in stock are listed) and the person under 'Assign To' (active staff accounts), set the Quantity, pick the item's Condition (New, Good, Fair or Poor) and add notes such as a serial number, then press 'Assign'. The assignment is dated today, the stock is reduced and an Issue transaction is recorded.")
    pdf.step("Switch between the 'Active' and 'Returned' tabs, and search by person or item name.")
    pdf.step("When the item comes back, press 'Return' on its row, choose its condition and press 'Confirm Return'. The stock is restored and a Return transaction is recorded.")

    pdf.section_title("Reorder Prediction")
    pdf.nav_path("Sidebar > Inventory > Reorder Prediction")
    pdf.body_text("Items flagged by the AI as low on stock or projected to run out, with severity (High, Medium, Low), current stock, projected stockout time and trend.")

    # =========================================================================
    # APPENDIX: TIPS, BEST PRACTICES & OPERATIONS CHECKLIST
    # =========================================================================
    pdf.chapter_title("Tips, Best Practices & Operations Checklist")

    pdf.section_title("General Tips")
    pdf.bullet("Class dropdowns are session-scoped: always select the correct academic year first to see the right class list")
    pdf.bullet("Use bulk import (Excel) for students when starting with a large number of records")
    pdf.bullet("Use search and filter features to quickly find records in any list")
    pdf.bullet("Export data regularly as backups (Excel, PDF)")
    pdf.bullet("Use strong, unique passwords; log out when leaving the computer unattended")
    pdf.bullet("Regularly review user access and deactivate unused accounts")
    pdf.bullet("The User Guide covers pages for all roles; if you cannot see a page, your role or school modules do not include it")

    pdf.section_title("Attendance Tips")
    pdf.bullet("Manual: Press Mark All Present, then change only the exceptions; save before leaving the page")
    pdf.bullet("Face: Enroll all students first; use clear portraits (quality > 70%); good lighting for group photos")
    pdf.bullet("Face: Avoid backlighting; review yellow-flagged matches; re-enroll after major appearance changes")
    pdf.bullet("If attendance was already marked, reopen the same class and date: saving updates the records and never duplicates them")
    pdf.bullet("Attendance cannot be saved on OFF days")

    pdf.section_title("Finance Tips")
    pdf.bullet("Set up accounts before the academic year; close months regularly")
    pdf.bullet("Use discounts/scholarships feature instead of manual fee adjustments")
    pdf.bullet("Use 'Pay Full' bulk action for quick month-end collection")
    pdf.bullet("Download PDF reports monthly from the Finance Dashboard for record-keeping")
    pdf.bullet("Online payment is not enabled yet: record every payment under Collect Payments")

    pdf.section_title("Operations Checklist")
    pdf.body_text("Recommended routine tasks by frequency:")
    pdf.simple_table(
        ["Frequency", "Tasks"],
        [
            ["Daily", "Mark attendance (Manual Entry or Face), record fee payments, "
                      "mark staff & transport attendance, issue/return books, check dashboard alerts and notifications"],
            ["Weekly", "Review attendance analytics, check overdue books, process leave applications, "
                       "update admission pipeline"],
            ["Monthly", "Process payroll, close financial month, review Finance Dashboard, "
                        "generate fee reminders"],
            ["Term", "Create exams, enter marks, publish results, generate report cards, "
                     "conduct promotions, set up new academic year"],
        ],
        [30, 160]
    )

    # =========================================================================
    # NOW BUILD THE TOC
    # =========================================================================
    # We need to go back and fill in the TOC page
    # Since fpdf2 doesn't support going back to a page easily,
    # we'll regenerate the PDF with TOC content

    # Save TOC entries for the final build
    toc_data = pdf.toc_entries

    # Generate PDF
    output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "EducationAI_User_Guide.pdf")
    pdf.output(output_path)
    print(f"PDF generated successfully at: {output_path}")
    print(f"Total pages: {pdf.page_no()}")
    print(f"Table of Contents entries: {len(toc_data)}")
    for entry_type, title, page in toc_data:
        print(f"  {'  ' if entry_type == 'section' else ''}{title} ... page {page}")

    # =========================================================================
    # EXPORT JSON for in-app User Guide
    # =========================================================================
    json_data = {
        "meta": {
            "title": "Education AI",
            "subtitle": "School Administration Guide",
            "version": "3.4 - Manual Attendance & Updated Navigation",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "totalChapters": len(pdf.json_chapters),
            "modules": pdf.json_modules,
            "startHere": START_HERE
        },
        "chapters": apply_meta(pdf.json_chapters)
    }

    # A wrong id in START_HERE would silently drop a step from the "Start here" list, so fail loudly instead.
    known_sections = {sec["id"] for ch in json_data["chapters"] for sec in ch["sections"]}
    for role, ids in START_HERE.items():
        unknown = [i for i in ids if i not in known_sections]
        if unknown:
            raise SystemExit(f"START_HERE for {role} names sections that do not exist: {unknown}")

    videos_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend", "src", "data", "guideVideos.json")
    sync_video_catalog(json_data["chapters"], videos_path)

    json_output_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "frontend", "src", "data", "userGuide.json"
    )
    os.makedirs(os.path.dirname(json_output_path), exist_ok=True)
    with open(json_output_path, 'w', encoding='utf-8') as f:
        json.dump(json_data, f, indent=2, ensure_ascii=False)
    print(f"\nJSON guide generated at: {json_output_path}")
    print(f"Total chapters: {len(pdf.json_chapters)}")
    total_sections = sum(len(ch['sections']) for ch in pdf.json_chapters)
    print(f"Total sections: {total_sections}")


if __name__ == "__main__":
    build_guide()
