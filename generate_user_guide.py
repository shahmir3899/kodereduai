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

    pdf.body_text("Follow every admission from first enquiry to enrolled student.")

    pdf.section_title("Admission Workflow Overview")
    pdf.body_text("An enquiry is New, then Confirmed once the family agrees, then Converted when it becomes a student in the academic year and class you choose. Cancelled enquiries stay on record.")

    pdf.section_title("Creating Enquiries")
    pdf.nav_path("Sidebar > Admissions > Enquiries")
    pdf.step("Click 'New Enquiry'. Enter the student's name, the father's name, the mobile number and the grade applied for.")
    pdf.step("Choose how the family found you (Walk-in, Phone Call, Website, WhatsApp, Referral, Social Media, Ad Campaign or Other) and add a note.")
    pdf.step("Click 'Create Enquiry'. It appears in the list with status New.")

    pdf.section_title("Admission Pipeline Stages")
    pdf.simple_table(
        ["Stage", "Meaning"],
        [
            ["New", "Enquiry received"],
            ["Confirmed", "Admission agreed, ready to convert"],
            ["Converted", "Now a student with an enrollment"],
            ["Cancelled", "Withdrawn"],
        ],
        [50, 140]
    )

    pdf.section_title("Managing Enquiries")
    pdf.step("The funnel at the top counts enquiries in each stage. Click a stage to filter the list, or search by the child's name or phone number.")
    pdf.step("When the family agrees, click 'Confirm'. The enquiry moves out of New.")
    pdf.step("If a family withdraws, search for them and click 'Cancel'. Use 'Edit' to change details.")

    pdf.section_title("Followup Management")
    pdf.step("Click 'Edit' on the enquiry, pick the next follow-up date and write what was discussed.")
    pdf.step("Click 'Update Enquiry'. The date shows in the Follow-up column, in red once it is overdue.")

    pdf.section_title("Converting Enquiries to Students")
    pdf.step("Tick the Confirmed enquiries you want to convert. A bar appears with 'Convert to students'.")
    pdf.step("Choose the academic year, then the class and section. You can also tick 'Auto-generate fee records'.")
    pdf.step("Click 'Convert N Enquiries'. The student record and enrollment are created, and roll numbers are assigned in order.")
    pdf.info_box("Future years", "You can admit students into next year before promotion is run. Roll numbers are separate for each year and class, so nothing clashes.")

    pdf.section_title("Admission Analytics")
    pdf.body_text("The funnel on the Enquiries page also shows the conversion rate, and which sources (Walk-in, Referral and so on) bring the most enquiries.")

    # =========================================================================
    # CHAPTER 9: TRANSPORT MODULE
    # =========================================================================
    pdf.chapter_title("Transport Module")

    pdf.body_text("Routes, buses, which students ride where, and daily boarding attendance.")

    pdf.section_title("Setting Up Routes")
    pdf.nav_path("Sidebar > Transport > Routes")
    pdf.step("Click 'Add Route'. Enter the route name, where it starts, where it ends and the estimated minutes. Click 'Create Route'.")
    pdf.step("Click 'Stops' on the route, then '+ Add Stop'. Enter the stop name, its order, and the pickup and drop times.")
    pdf.step("Click 'Add Stop'. The stop shows in the route with its order and times. 'Duplicate' copies a route with all its stops.")

    pdf.section_title("Adding Vehicles")
    pdf.nav_path("Sidebar > Transport > Vehicles")
    pdf.step("Click 'Add Vehicle'. Enter the number plate, the type (Bus, Van or Car), the seats and the make.")
    pdf.step("Enter the driver's name and phone, and choose the route the vehicle serves.")
    pdf.step("Click 'Add Vehicle'. It appears in the list with its driver and route.")

    pdf.section_title("Assigning Students to Routes")
    pdf.nav_path("Sidebar > Transport > Assignments")
    pdf.step("Click 'New Assignment'. Search for each student and click the name; you can add several at once.")
    pdf.step("Choose the route, then the stop. The vehicle is optional. Choose Pickup Only, Drop Only or Both.")
    pdf.step("Click 'Assign'. A student has one assignment per year, and students who already have one are skipped.")

    pdf.section_title("Transport Attendance")
    pdf.nav_path("Sidebar > Transport > Attendance")
    pdf.step("Choose the date (today by default) and the route. Its students are listed, all starting as Boarded.")
    pdf.step("Click 'Not Boarded' for a student who missed the bus, and 'Absent' for one who stayed home.")
    pdf.step("Click 'Save All'. One record is saved for every student on the route for that day; saving again updates it.")

    pdf.section_title("Transport Dashboard")
    pdf.nav_path("Sidebar > Transport > Dashboard")
    pdf.body_text("Totals for routes, vehicles, assigned students and today's attendance. Only Admins and Principals can change transport data; other roles can view it.")

    # =========================================================================
    # CHAPTER 10: LIBRARY MODULE
    # =========================================================================
    pdf.chapter_title("Library Module")

    pdf.body_text("Catalog, lending and overdue books. Only Admins and Principals can change anything here; other staff can browse the catalog and see which books are out.")

    pdf.section_title("Setting Up Book Categories")
    pdf.nav_path("Sidebar > Library > Catalog")
    pdf.step("Click 'Manage Categories'. Type a name (for example Fiction or Science) and a short description, then click 'Add Category'.")
    pdf.step("Click 'Edit' next to a category to rename it, then 'Save Changes'; click 'Done' when finished. Categories appear in the catalog filter and the Add Book form.")
    pdf.body_text("Deleting a category keeps its books, which stay in the catalog without a category.")

    pdf.section_title("Adding Books to the Catalog")
    pdf.nav_path("Sidebar > Library > Catalog")
    pdf.step("Click 'Add Book'. Enter the title and the author (both required), then the ISBN and the publisher.")
    pdf.step("Choose the category, set how many copies the library owns and note the shelf location, then click 'Add Book'. All copies show as available.")
    pdf.step("Search by title, author or ISBN, or pick a category to browse one section.")
    pdf.info_box("Editing and removing", "Total copies cannot go below the copies currently issued. A book that has ever been issued cannot be deleted; edit it and untick 'Active' to take it off the shelf.")

    pdf.section_title("Issuing Books")
    pdf.nav_path("Sidebar > Library > Issue / Return")
    pdf.step("On the 'Issue Book' tab, choose Student or Staff, type at least two letters of the name and pick the person.")
    pdf.step("Type part of the title and pick the book. Only books with copies available are listed.")
    pdf.step("The due date is already set from the loan period (14 days by default). Change it only if this loan is different, then click 'Issue Book'.")
    pdf.info_box("Limits", "A borrower cannot go over the limit in Library Settings (3 books for a student and 5 for staff by default) or take a second copy of the same book.")

    pdf.section_title("Returning Books")
    pdf.nav_path("Sidebar > Library > Issue / Return")
    pdf.step("Open the 'Return Book' tab and search by the borrower or the book title.")
    pdf.step("Click 'Process Return' and check the summary. For a late book it shows the days overdue and the fine, which is worked out for you.")
    pdf.step("Click 'Confirm Return'. The copy goes back on the shelf and the fine is recorded on the loan.")

    pdf.section_title("Tracking Overdue Books")
    pdf.nav_path("Sidebar > Library > Overdue")
    pdf.step("The tiles show how many books are overdue, the fines so far and the fine per day.")
    pdf.step("Each row shows the borrower, due date, days overdue and fine, oldest first. Click 'Return' on a row and confirm to take the book back.")

    pdf.section_title("Library Dashboard")
    pdf.nav_path("Sidebar > Library > Dashboard")
    pdf.body_text("Counts of titles, copies, books out and overdue, plus the most borrowed titles. Admins and Principals also get 'Library Settings' for the loan period, borrowing limits and the daily fine.")

    # =========================================================================
    # CHAPTER 11: LMS (LEARNING MANAGEMENT)
    # =========================================================================
    pdf.chapter_title("LMS - Learning Management System")

    pdf.body_text("Organise textbooks, plan lessons, set assignments and mark what students hand in. Works in English, Urdu and other right-to-left languages.")

    pdf.section_title("Managing Curriculum (Books, Chapters, Topics)")
    pdf.nav_path("Sidebar > Content Creation > Curriculum")
    pdf.body_text("Each class and subject has Books, each book has Chapters, and each chapter has Topics. Lesson plans and syllabus progress use this structure.")
    pdf.step("Choose the class and subject; its books are listed. Click 'Add Book', enter the title and edition, and click 'Add Book' again.")
    pdf.step("Click the book to see its chapters. Click 'Add Chapter', enter the title and save.")
    pdf.step("Open the chapter and click 'Add Topic'. Enter the title and save.")
    pdf.step("For a whole book at once, click 'Import Table of Contents'. On 'Manual Entry' type or paste the chapters and topics, or upload a photo of the contents page to read it automatically; review, then apply.")
    pdf.body_text("A progress bar shows how many topics are covered. A topic counts as covered when a teacher publishes a lesson plan that uses it.")

    pdf.section_title("Creating Lesson Plans")
    pdf.nav_path("Sidebar > Planning & Delivery > Lesson Plans")
    pdf.step("Click 'Add Lesson Plan', then 'Create single lesson plan'. Choose 'Standard' for the full details.")
    pdf.step("Enter the title, class, subject and teacher. Click 'Select chapter / topic', tick a topic from the book and click 'Apply'.")
    pdf.step("Set the lesson date and write an objective. Leave the status as Draft and click 'Create Lesson Plan'.")
    pdf.step("Click 'Publish' on the plan to share it.")
    pdf.body_text("'Minimal' saves a draft from just the class, subject, topics and date. This page is not available to Managers.")

    pdf.section_title("Creating Assignments")
    pdf.nav_path("Sidebar > Academics > Assignments")
    pdf.step("Click 'Create Assignment'. Enter the title, then choose the class, subject and teacher.")
    pdf.step("Choose the type (Homework, Project, Classwork or Lab), then set the due date and total marks. Diary entries use 'Create Daily Diary'.")
    pdf.step("Write the description (required) and the instructions for students, then click 'Create Assignment'. It starts as a Draft.")
    pdf.step("Click 'Publish' so students can see it in their portal.")

    pdf.section_title("Reviewing Submissions")
    pdf.nav_path("Sidebar > Academics > Assignments > Submissions")
    pdf.step("Click the number in the Submissions column of an assignment. The cards at the top count submitted, graded and late work.")
    pdf.step("Open a submission, click 'Grade', enter the marks and some feedback, and click 'Save'.")
    pdf.step("A graded submission can be sent back to the student with 'Return'.")

    # =========================================================================
    # CHAPTER 12: NOTIFICATIONS
    # =========================================================================
    pdf.chapter_title("Notifications Module")

    pdf.body_text("Everyone can read their notifications. Admins can also send messages to groups, save templates and control the automatic ones.")

    pdf.section_title("Viewing Notifications (All Users)")
    pdf.nav_path("Sidebar > Notifications")
    pdf.step("Click the bell in the top bar for the latest few, or open 'Notifications' in the sidebar for the full list. New ones are grouped under Today.")
    pdf.step("Click a notification to read it; it also opens the related page. Unread ones stand out.")
    pdf.step("Use the 'All Types' list to see one kind, such as Fee Due, and tick 'Unread only' to hide what you have read.")
    pdf.step("Click 'Mark all read' and confirm to clear everything at once.")

    pdf.section_title("Creating Notification Templates (Admin)")
    pdf.nav_path("Sidebar > Notifications > Templates Tab")
    pdf.step("On the 'Templates' tab, click 'New Template'. Type a name, choose the event and the channel, and write the message. Placeholders use double braces, such as {{student_name}}.")
    pdf.step("Click 'Save'. Search for it later and click 'Preview' to see the message with sample values.")
    pdf.body_text("Templates marked 'Shared' belong to every school and cannot be changed. Untick 'Active' to hide a template from the Send tab.")

    pdf.section_title("Sending Notifications (Admin)")
    pdf.nav_path("Sidebar > Notifications > Send Tab")
    pdf.step("On the 'Send' tab, 'Broadcast to Group' is selected. Choose a template to fill in the title and message, or write your own. (Choose 'Single Recipient' to message one person.)")
    pdf.step("Choose the group, such as All Teachers, and the channel (In-App, which also reaches phones, or Email).")
    pdf.step("Click 'Review & Send Broadcast', check the number of recipients and click 'Confirm Send'. A message shows how many were sent, skipped or failed.")
    pdf.info_box("Placeholders", "Manual sends do not fill in {{placeholders}}. If the text still has any, a warning appears first. 'Test Send to Me' sends a copy to your own inbox.")
    pdf.info_box("Run now", "'Send Fee Reminders Now', 'Generate Daily Report Now' and 'Remind Teachers to Mark Attendance' at the top of the Send tab send this school's automatic notifications on demand.")

    pdf.section_title("Notification Analytics (Admin)")
    pdf.nav_path("Sidebar > Notifications > Analytics Tab")
    pdf.body_text("Choose 7 days, 30 days, 90 days or all time to see how many notifications were delivered and read, by channel and by kind.")

    pdf.section_title("Automation Settings")
    pdf.nav_path("Sidebar > Notifications > Settings")
    pdf.body_text(
        "Switch each automatic notification on or off for your school: absence alerts, fee reminders, fee overdue alerts, "
        "exam results published, the daily absence summary and transport notifications. Options for a module your school "
        "has turned off are hidden. Scheduled ones run by themselves; you do not need to do anything."
    )

    # =========================================================================
    # CHAPTER 13: MESSAGING
    # =========================================================================
    pdf.chapter_title("Messaging")

    pdf.body_text("Private conversations between school staff, teachers, parents and students. What you can do depends on your role.")

    pdf.section_title("Who Can Message Whom")
    pdf.simple_table(
        ["Sender", "Can message"],
        [
            ["School Admin / Principal", "Any staff member"],
            ["Teacher", "Parents and students of their classes, and Admins and Principals"],
            ["Other staff", "Admins and Principals"],
            ["Parent", "Teachers of their children's classes"],
        ],
        [60, 130]
    )

    pdf.section_title("Accessing Messages")
    pdf.nav_path("Sidebar > Messages")
    pdf.body_text("Conversations are listed on the left and the open one is on the right. On a phone, you move between the list and the conversation.")

    pdf.section_title("Starting a New Conversation")
    pdf.nav_path("Messages > New Message button")
    pdf.step("Click 'New Message' in the sidebar of the Messages page.")
    pdf.step("Open the 'To' box, search for a name and pick the person. For a parent or student, the child is filled in for you.")
    pdf.step("Add a subject if you like, type your message and click 'Send Message'. The conversation opens on the right.")
    pdf.info_box("No duplicates", "If you already have a conversation with the same person about the same student, your message is added to it.")

    pdf.section_title("Replying to Messages")
    pdf.step("Open a conversation. Conversations with unread messages show a number.")
    pdf.step("Type your reply in the box at the bottom and press Enter, or the arrow button, to send. Shift+Enter starts a new line. Your messages appear on the right.")

    pdf.section_title("Unread Message Indicators")
    pdf.body_text("Unread conversations show a number badge, and Messages in the sidebar shows the total. Opening a conversation marks it as read.")

    pdf.section_title("Searching Conversations")
    pdf.step("Type in the search box above the list. It matches people's names and the latest message.")

    # =========================================================================
    # CHAPTER 14: PARENT PORTAL
    # =========================================================================
    pdf.chapter_title("Parent Portal")

    pdf.body_text("See your children's attendance, fees, timetable and results, apply for leave and message teachers.")

    pdf.section_title("Parent Dashboard")
    pdf.nav_path("Login as Parent > Dashboard")
    pdf.body_text("After you sign in, the dashboard shows a card for each of your children, shortcuts for Apply Leave and Messages, and recent notifications from the school.")

    pdf.section_title("Viewing Child's Information")
    pdf.step("On the dashboard, click 'Overview' on your child's card.")
    pdf.step("The top shows the photo, class and roll number. The cards below show attendance, fees due, the last exam and days present.")
    pdf.step("Under 'Details', choose a page for the full picture: Attendance Calendar, Fee Details, Timetable, Exam Schedule or Exam Results.")
    pdf.info_box("Fees", "Online payment is not available yet. Pay at the school office until your school announces it.")
    pdf.info_box("Exam results", "Results appear after the school announces them.")

    pdf.section_title("Applying for Leave")
    pdf.nav_path("Sidebar > Leave Requests")
    pdf.step("Click 'Leave Requests' in the sidebar. The 'Apply for Leave' tab opens first. Choose the child, then enter the start date and the end date.")
    pdf.step("Write the reason. A link to a supporting document is optional.")
    pdf.step("Click 'Submit Leave Request'. A green message confirms it was sent to the school.")
    pdf.step("Open 'My Requests'. The new request is Pending, and earlier ones show the school's decision and remarks. A pending request can be cancelled with 'Cancel'.")

    pdf.section_title("Messages")
    pdf.nav_path("Sidebar > Messages")
    pdf.body_text("Message your children's teachers. See the Messaging chapter for how conversations work.")

    # =========================================================================
    # CHAPTER 14: STUDENT PORTAL
    # =========================================================================
    pdf.chapter_title("Student Portal")

    pdf.body_text("Your attendance, timetable, assignments, fees and results in one place, plus an AI study helper.")

    pdf.section_title("Student Dashboard")
    pdf.nav_path("Login as Student > Dashboard")
    pdf.body_text("Your attendance rate, assignments waiting for you, your fee balance, today's timetable and upcoming deadlines.")

    pdf.section_title("My Attendance")
    pdf.nav_path("Student Portal > Attendance")
    pdf.step("Open 'Attendance' to see each month and day, and your attendance percentage.")

    pdf.section_title("My Timetable")
    pdf.nav_path("Student Portal > Timetable")
    pdf.step("Open 'Timetable' to see each day's subjects, teachers and period times.")

    pdf.section_title("My Assignments")
    pdf.nav_path("Student Portal > Assignments")
    pdf.step("Click 'Assignments' in the sidebar to see work from all your teachers. Each card shows the subject, type, due date and status. Graded work shows your marks and the teacher's feedback.")
    pdf.step("A Diary Entry is for reading only, so it has no Submit button. For an open assignment, click 'Submit'.")
    pdf.step("Type your answer. Submission Text is required, and a link to your file is optional.")
    pdf.step("Click 'Submit Assignment'. A green message confirms it and the card now shows Submitted.")

    pdf.section_title("My Fees")
    pdf.nav_path("Student Portal > Fees")
    pdf.step("Open 'Fees' to see your balance, payment history and due dates.")

    pdf.section_title("My Results")
    pdf.nav_path("Student Portal > Results")
    pdf.step("Open 'Results'. Each published exam is a card with your total, percentage and grade.")
    pdf.step("Under each exam you see marks, percentage and a Pass or Fail badge for every subject. Click an exam title to show only that exam. A paper you missed shows as Absent.")

    pdf.section_title("My Profile")
    pdf.nav_path("Student Portal > My Profile")
    pdf.step("Open 'My Profile' to see your details and class.")

    pdf.section_title("AI Study Helper")
    pdf.nav_path("Student Portal > AI Study Helper")
    pdf.body_text("A tutor that knows your class and subjects. It only answers study questions.")
    pdf.step("Click 'AI Study Helper' in the sidebar. Click one of the suggestions to ask it right away.")
    pdf.step("Or type your own question and press Enter. Shift+Enter starts a new line.")
    pdf.step("Your chat is saved, so you can come back to it. Click 'Clear Chat' to start again.")
    pdf.info_box("Daily limit", "You can send up to 30 messages a day.")

    # =========================================================================
    # CHAPTER 15: HOSTEL MANAGEMENT
    # =========================================================================
    pdf.chapter_title("Hostel Management")

    pdf.body_text("Hostel buildings and rooms, who sleeps where, and gate passes. Only Admins and Principals can see these pages, because they list students and their reasons for leaving.")

    pdf.section_title("Hostel Dashboard")
    pdf.nav_path("Sidebar > Hostel > Dashboard")
    pdf.body_text("Occupancy and available beds, pending gate-pass requests, students currently out, and shortcuts to rooms, allocations and gate passes.")

    pdf.section_title("Managing Hostels & Rooms")
    pdf.nav_path("Sidebar > Hostel > Rooms")
    pdf.step("Click 'Add Hostel'. Enter the name, choose Boys, Girls or Mixed, and set the capacity and a warden. Click 'Add Hostel' again to save.")
    pdf.step("Open the 'Rooms' tab and choose the hostel.")
    pdf.step("Click 'Add Room'. Enter the room number, floor and capacity, choose the room type, and click 'Add Room' again. It shows its capacity and how many beds are taken.")
    pdf.info_box("Taking things out of use", "A hostel or room that has allocation records cannot be deleted, so the history stays. Mark the hostel Inactive, or untick 'Available for allocation' on the room. A room's capacity cannot go below the students in it.")

    pdf.section_title("Student Allocations")
    pdf.nav_path("Sidebar > Hostel > Allocations")
    pdf.step("Click 'Allocate Student'. Choose the student, the hostel and a room that has a free bed, then click 'Allocate'. The student appears in the list with the room.")
    pdf.step("To free a bed, click 'Vacate' on the student and confirm.")
    pdf.step("Choose 'Vacated' in the status filter to see students who left, with the date.")
    pdf.info_box("One bed per year", "A student can hold one active bed in a year. Vacate the current one before choosing another room.")

    pdf.section_title("Gate Passes")
    pdf.nav_path("Sidebar > Hostel > Gate Passes")
    pdf.body_text("A pass moves through: Pending Approval, Approved (or Rejected), Checked Out, Returned.")
    pdf.step("Click 'New Gate Pass'. Choose the student and the pass type, then enter the reason and where the student is going.")
    pdf.step("The leaving time and expected return are filled in; change them if the student leaves at a different time. Click 'Create Gate Pass'. It starts as Pending Approval.")
    pdf.step("Click 'Approve', add a remark if you like and confirm (or click 'Reject').")
    pdf.step("When the student leaves the gate, click 'Check Out'. When the student is back, click 'Mark Returned'. The pass is complete.")

    # =========================================================================
    # CHAPTER 16: SETTINGS & CONFIGURATION
    # =========================================================================
    pdf.chapter_title("Settings & Configuration")

    pdf.body_text("Settings has two tabs: 'School Profile' for school preferences such as Examination Settings, and 'Users', where Admins and Principals manage accounts.")

    pdf.section_title("Examination Settings")
    pdf.nav_path("Sidebar > Settings > School Profile > Examination Settings")
    pdf.body_text("Switch between Simple Average and Weighted Average for report cards. See Chapter 6 (Weighted Average Configuration).")

    pdf.section_title("Finance Accounts Management")
    pdf.body_text("See Chapter 7, Setting Up Finance Accounts.")

    pdf.section_title("Online Payments")
    pdf.info_box("Not switched on yet", "Online payment is not available for schools yet, so there is nothing to set up. Record payments under Finance > Collect Payments.")

    # =========================================================================
    # CHAPTER 17: USER MANAGEMENT
    # =========================================================================
    pdf.chapter_title("User Management")

    pdf.body_text("School Admins and Principals create and manage the people who can log in to their school.")

    pdf.section_title("User Roles & Hierarchy")
    pdf.simple_table(
        ["Role", "Can create"],
        [
            ["School Admin", "Principal, Manager, Accountant, Teacher, Staff, Driver"],
            ["Principal", "Manager, Accountant, Teacher, Staff, Driver"],
            ["Manager, Accountant, Teacher, Staff, Driver", "Nobody"],
            ["Parent, Student", "Nobody (they get accounts through the school)"],
        ],
        [70, 120],
    )
    pdf.body_text("What each person sees also depends on the modules your school has turned on.")

    pdf.section_title("Managing Users (School Admin & Principal)")
    pdf.nav_path("Sidebar > Settings > Users Tab")
    pdf.step("Open Settings and click the 'Users' tab. It lists every user of your school; search by name, username or email, or filter by role.")
    pdf.step("Click 'Add User'. Enter the name, a username, an email and a password, then choose the role. The list only offers roles you are allowed to create.")
    pdf.step("Click 'Create User'. A green message confirms it, and the user can log in straight away.")
    pdf.step("Click 'Edit' to change the name, email, role or phone. The username cannot be changed.")
    pdf.step("If someone forgets their password, click 'Reset Password'. Set a new one now, or email them a reset link when they have an email address.")
    pdf.step("Click 'Deactivate' and the user can no longer log in. Click 'Activate' to give the access back.")
    pdf.info_box("Who you can change", "You can only edit or deactivate users whose role you could create. A Principal cannot deactivate a School Admin.")

    pdf.section_title("Creating Student User Accounts")
    pdf.nav_path("Sidebar > Management > Students > Add Student")
    pdf.step("In the Add Student form, choose the class and enter the student's name and the parent details.")
    pdf.step("At the bottom, tick 'Create User Account'. The username is suggested from the name.")
    pdf.step("Enter a password of at least eight characters and confirm it. Click 'Add Student'. The student and the login are created together.")

    pdf.section_title("Converting Existing Students to Users")
    pdf.nav_path("Sidebar > Management > Students")
    pdf.body_text("Students without a login show 'No Account'. Click 'Create Account' beside one, or tick several and use 'Create Accounts' in the bar that appears. Usernames are made from the name, such as ahmed_khan.")

    pdf.section_title("Creating Staff User Accounts")
    pdf.nav_path("Sidebar > HR & Staff > Staff Directory")
    pdf.body_text("When you add a staff member, tick 'Create User Account' and choose their role (Teacher, Staff, Manager, Accountant or Driver) to give them a login at the same time.")

    pdf.section_title("Converting Existing Staff to Users")
    pdf.body_text("Staff without a login show 'No Account'. Click 'Create Account' beside one, or tick several and use 'Create Accounts', then choose the role and a starting password.")

    pdf.section_title("Linking Existing User Accounts to Staff")
    pdf.body_text("If the login already exists, click 'Link Account' on the staff row instead and pick the user. See Chapter 8, Linking & Unlinking User Accounts.")

    pdf.warning_box("Passwords cannot be looked up. If someone forgets theirs, an Admin or Principal resets it from the Users tab.")

    # =========================================================================
    # CHAPTER: AI INTELLIGENCE FEATURES
    # =========================================================================
    pdf.chapter_title("AI Features")

    pdf.body_text("AI helps with everyday work: dashboard insights, timetables, report card comments, letters and early warnings. Always read AI output before you share it.")

    pdf.section_title("AI Dashboard Insights")
    pdf.body_text("The dashboard lists what needs attention: red for urgent, amber for important, blue for reminders. Each one links to the page where you can act. Each role sees only its own area, so teachers see attendance and accountants see finance.")

    pdf.section_title("OR-Tools Timetable Optimization")
    pdf.nav_path("Sidebar > Academics > Timetable > Auto-Generate")
    pdf.body_text("'Auto-Generate' fills a timetable for you. 'Quick (Greedy)' gives a draft almost at once. 'Optimal (OR-Tools)' takes up to 30 seconds and spreads subjects better across days without double-booking anyone. Review it, then click 'Save Timetable'.")

    pdf.section_title("AI Report Card Comments")
    pdf.nav_path("Sidebar > Academics > Results")
    pdf.body_text("On an exam's results page, click 'Generate Comments' to draft a comment for every student from their marks, grades and attendance. They appear on report cards. Read them before parents do.")

    pdf.section_title("AI Letter Drafting")
    pdf.nav_path("Sidebar > HR & Staff > Letter Composer > Draft with AI")
    pdf.body_text("Describe the letter in plain words, for example 'Write a warning letter for late attendance'. The draft uses the chosen template and employee details. Edit it before you generate the PDF.")

    pdf.section_title("At-Risk Students (Attendance)")
    pdf.nav_path("Dashboard > AI Insights > At-Risk Students")
    pdf.body_text("Students whose attendance is falling, with their rate now, the predicted rate in 4 weeks and the trend. Filter by severity and class. School Admin and Principal only.")
    pdf.section_title("Student Risk Score")
    pdf.nav_path("Sidebar > Management > Student Risk Score")
    pdf.body_text("One score that combines attendance, likelihood of unpaid fees and academic results. Filter by severity and class. School Admin and Principal only.")
    pdf.section_title("Academic Risk")
    pdf.nav_path("Sidebar > Academic Risk")
    pdf.body_text("Students heading towards failing grades, with their average, the predicted next exam and the trend. School Admin and Principal only.")
    pdf.section_title("Staff Risk")
    pdf.nav_path("Sidebar > HR & Staff > Staff Risk")
    pdf.body_text("Staff with rising leave or falling attendance. School Admin and Principal only.")
    pdf.warning_box("Risk scores are estimates to start a conversation, not a judgment about a person. For the student pages, choose an academic year first.")

    # =========================================================================
    # CHAPTER: INVENTORY & STORE
    # =========================================================================
    pdf.chapter_title("Inventory & Store")

    pdf.body_text("Store items, stock movements and who holds what. Available to School Admins, Principals and Accountants; only Admins and Principals can change things.")

    pdf.section_title("Inventory Dashboard")
    pdf.nav_path("Sidebar > Inventory > Dashboard")
    pdf.body_text("Total items, stock value, active assignments, low-stock alerts and recent transactions, with links to the other pages.")

    pdf.section_title("Items & Stock")
    pdf.nav_path("Sidebar > Inventory > Items")
    pdf.step("Open 'Categories' and add one. Vendors work the same way.")
    pdf.step("Click 'Add Item'. Enter the name, choose the category and unit, and set the current stock, the minimum stock and the price. Click 'Create'.")
    pdf.step("Use 'Stock Status' to see only Low Stock or Out of Stock items, so you know what to reorder.")
    pdf.step("'AI Suggest' lists items for the kind of school you choose, such as Science Lab. Tick the ones you want and add them in one go.")

    pdf.section_title("Stock Transactions")
    pdf.nav_path("Sidebar > Inventory > Transactions")
    pdf.step("Every stock movement is listed with its date, type and quantity. Click 'Record Transaction'.")
    pdf.step("Choose 'Purchase', then the item. The unit price is filled in. Enter the quantity, choose the vendor and add the invoice number, then click 'Record Transaction'. The item's stock goes up.")
    pdf.step("For damaged or expired items choose 'Disposal' and enter a positive quantity; the stock goes down by that amount. An 'Adjustment' corrects a count and takes a negative number to reduce stock.")
    pdf.step("Use 'Type' and the From and To dates to narrow the history.")
    pdf.info_box("Issues and returns", "These are not typed in by hand. They are created automatically when you assign an item or mark it returned.")

    pdf.section_title("Item Assignments")
    pdf.nav_path("Sidebar > Inventory > Assignments")
    pdf.step("It shows who currently holds which item. Click 'Assign Item', choose the item, the person and the quantity, and add a note such as a serial number or the purpose.")
    pdf.step("Click 'Assign'. The item is dated today and its stock goes down.")
    pdf.step("When an item comes back, click 'Return' on its row, choose its condition and confirm. The stock is restored.")
    pdf.step("Open the 'Returned' tab to see items that came back, with the date and condition. Search by person or item.")
    pdf.body_text("Accountants, Teachers and Staff can only view assignments; Teachers and Staff see just the items assigned to them.")

    pdf.section_title("Reorder Prediction")
    pdf.nav_path("Sidebar > Inventory > Reorder Prediction")
    pdf.body_text("Items the AI expects to run low or out, with severity, current stock and the projected stock-out time.")

    # =========================================================================
    # APPENDIX: TIPS, BEST PRACTICES & OPERATIONS CHECKLIST
    # =========================================================================
    pdf.chapter_title("Tips, Best Practices & Operations Checklist")

    pdf.section_title("General Tips")
    pdf.bullet("Choose the right academic year first; class lists depend on it.")
    pdf.bullet("Import students from Excel when you start with many.")
    pdf.bullet("Search and filter any list to find records fast.")
    pdf.bullet("Use strong passwords, log out on shared computers, and deactivate accounts nobody uses.")

    pdf.section_title("Attendance Tips")
    pdf.bullet("Manual: press 'Mark All Present', change only the exceptions, and save before you leave the page.")
    pdf.bullet("Face: enroll every student first, with clear, well-lit portraits (quality above 70%), and review the yellow matches.")
    pdf.bullet("To correct a day, reopen the same class and date and save again. Nothing is duplicated.")

    pdf.section_title("Finance Tips")
    pdf.bullet("Set up accounts and fee amounts before the year starts, and close each month when it is done.")
    pdf.bullet("Use discounts and scholarships rather than editing fees by hand.")
    pdf.bullet("Use 'Pay Full' for quick month-end collection, and download the monthly PDF from the Finance Dashboard.")

    pdf.section_title("Operations Checklist")
    pdf.simple_table(
        ["How often", "What to do"],
        [
            ["Daily", "Mark attendance, record payments, check notifications and dashboard alerts"],
            ["Weekly", "Check overdue books, answer leave requests, follow up admission enquiries"],
            ["Monthly", "Run payroll, send fee reminders, review the Finance Dashboard, close the month"],
            ["Each term", "Create exams, enter marks, announce results, print report cards, then promote students and set up the new year"],
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
