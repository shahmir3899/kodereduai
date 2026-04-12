"""
KoderEduAI - Comprehensive User Guide PDF Generator
Generates a professional PDF user guide covering all modules and workflows.

Source: generate_user_guide.py (project root)
Output: KoderEduAI_User_Guide.pdf (project root)
        frontend/src/data/userGuide.json (for in-app guide)
Run:    python generate_user_guide.py
"""

from fpdf import FPDF
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
            self.cell(0, 8, "KoderEduAI - User Guide", align="L")
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
        self.cell(0, 20, "KoderEduAI", align="C", new_x="LMARGIN", new_y="NEXT")
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
        self.cell(0, 8, "Version 3.2 - Historical Scope and Promotion Corrections", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(40)
        self.set_font("Helvetica", "", 10)
        self.cell(0, 6, "Modules Covered:", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(3)
        modules = [
            "Dashboard | Classes & Students | Attendance (AI-Powered)",
            "Face Attendance (Camera-Based) | Academics & Examinations",
            "Finance & Online Payments | HR & Staff Management",
            "Admissions CRM | Transport | Library | Hostel Management",
            "LMS | Notifications | Messaging | Parent & Student Portals | AI Study Helper",
            "AI Intelligence: Adaptive Thresholds | Drift Detection | Anomaly Alerts",
            "Pipeline Fallback | OR-Tools Timetable | AI Report Comments | Smart Scheduling"
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
        "KoderEduAI is a comprehensive School Management System that covers every aspect of school "
        "administration - from student enrollment and attendance tracking to finance, HR, academics, "
        "examinations, transport, library, and more. The system supports multiple user roles and provides "
        "dedicated portals for administrators, teachers, parents, and students."
    )

    pdf.section_title("User Roles")
    pdf.body_text("The system supports the following roles, each with different access levels:")
    pdf.simple_table(
        ["Role", "Access Level", "Description"],
        [
            ["School Admin", "Full School", "Full access; can create users within their school"],
            ["Principal", "School-wide", "School operations; can create staff-level users"],
            ["Teacher", "Assigned Classes", "Attendance, marks entry, lesson plans"],
            ["HR Manager", "HR Module", "Staff management, payroll, leave"],
            ["Accountant", "Finance Module", "Fee management, expenses, reports"],
            ["Staff", "Limited", "Basic access, notifications"],
            ["Parent", "Parent Portal", "View child's attendance, fees, results"],
            ["Student", "Student Portal", "View own attendance, timetable, assignments"],
        ],
        [30, 35, 125]
    )
    pdf.body_text(
        "User Management: School Admins can create Principal, HR Manager, Accountant, Teacher, and Staff users. "
        "Principals can create HR Manager, Accountant, Teacher, and Staff users. "
        "See the User Management chapter for full details."
    )

    pdf.section_title("Logging In")
    pdf.step("Open the application URL in your web browser.")
    pdf.step("Enter your username/email and password on the Login page.")
    pdf.step("Click 'Sign In' to access your dashboard.")
    pdf.step("If you manage multiple schools, use the School Switcher (top bar) to select the active school.")
    pdf.info_box("First-Time Setup", "Your School Admin account is pre-configured for you. "
                 "Once you receive your credentials, log in and follow the Initial Setup steps in Chapter 2. "
                 "You can then create other users from Settings > Users tab.")

    pdf.section_title("Navigating the Application")
    pdf.body_text(
        "The application uses a sidebar navigation on the left side of the screen. The sidebar is organized "
        "into groups and expandable sections. On mobile devices, the sidebar collapses into a hamburger menu."
    )
    pdf.sub_section("Top Bar Features")
    pdf.bullet("School Switcher - Switch between schools if you have access to multiple schools")
    pdf.bullet("Academic Year Switcher - Change the active academic year/session")
    pdf.bullet("Notification Bell - View unread notifications")
    pdf.bullet("User Menu - Profile settings, logout")

    pdf.sub_section("Sidebar Groups (Admin/Teacher View)")
    pdf.bullet("Dashboard - Main overview page")
    pdf.bullet("Management - Classes and Students")
    pdf.bullet("Attendance - Capture, Review, Register, Face Attendance")
    pdf.bullet("Academics - Subjects, Timetable, Sessions, Examinations, LMS")
    pdf.bullet("Finance - Dashboard, Fee Collection, Expenses, Payment Gateways")
    pdf.bullet("HR & Staff - Staff Directory, Departments, Payroll, Leave")
    pdf.bullet("Admissions - CRM pipeline for new admissions")
    pdf.bullet("Transport - Routes, Vehicles, Assignments")
    pdf.bullet("Library - Book Catalog, Issue/Return, Overdue")
    pdf.bullet("Hostel - Dashboard, Rooms, Allocations, Gate Passes")
    pdf.bullet("Notifications - Inbox, Templates, Send")
    pdf.bullet("Settings - System configuration")

    # =========================================================================
    # CHAPTER 2: INITIAL SETUP (ORDER OF OPERATIONS)
    # =========================================================================
    pdf.chapter_title("Initial Setup - Order of Operations")

    pdf.body_text(
        "Before using the system, you must set up foundational data in the correct order. "
        "Each step depends on the previous one being completed. Follow this sequence carefully."
    )

    pdf.warning_box(
        "The setup order matters! For example, you cannot add students before creating classes, "
        "and you cannot create exams before setting up academic years and subjects. Follow the "
        "order below to avoid errors."
    )

    pdf.section_title("Step 1: Academic Year & Terms")
    pdf.nav_path("Sidebar > Academics > Sessions")
    pdf.step("Log in with your School Admin credentials.")
    pdf.step("Navigate to Academics > Sessions in the sidebar.")
    pdf.step("In the 'Years' tab, click 'Add Academic Year'.")
    pdf.step("Enter: Name (e.g., '2025-2026'), Start Date, End Date.")
    pdf.step("Click 'Set as Current' to make it the active year.")
    pdf.step("Switch to the 'Terms' tab and click 'Add Term'.")
    pdf.step("Enter: Name (e.g., 'Term 1'), Term Type (Term/Semester/Quarter), Start Date, End Date, Order.")
    pdf.step("Add all terms for the academic year.")
    pdf.info_box("Why This Matters", "Academic years and terms are required for exams, report cards, "
                 "fee structures, and student promotions. Set this up first.")

    pdf.section_title("Step 2: Create Classes")
    pdf.nav_path("Sidebar > Management > Classes")
    pdf.step("Navigate to 'Classes' in the sidebar under Management.")
    pdf.step("Keep master classes simple: create one section-free class per grade, such as Playgroup, Nursery, Prep, Class 1, and Class 2.")
    pdf.step("Click 'Add Class', choose the Grade Level, confirm the Class Name, and save without adding sections.")
    pdf.step("Repeat once per grade level. The master class list is the shared class catalog used across academic years.")
    pdf.step("After master classes are ready, switch to Session Classes for the active academic year and create sections such as A, B, and C there.")
    pdf.step("Classes are displayed grouped by grade level. Use the 'Grid' toggle for an alternate view.")
    pdf.info_box("Tip", "Create sections in Session Classes, not in the master catalog. Example: keep master 'Class 5' once, then create session sections 'Class 5 - A' and 'Class 5 - B' inside the selected academic year.")

    pdf.section_title("Step 3: Add Students")
    pdf.nav_path("Sidebar > Management > Students")
    pdf.step("Navigate to 'Students' in the sidebar.")
    pdf.step("To add one student: Click 'Add Student' and fill in Name, Roll Number, Class, "
             "Parent Name, Parent Phone, Admission Number.")
    pdf.step("To bulk import: Click 'Import from Excel', download the template, fill it in, and upload.")
    pdf.step("Students will appear in the list. Use the class filter to view students by class.")
    pdf.step("You can export the student list as PDF, PNG, or Excel using the export buttons.")

    pdf.warning_box("Students must be assigned to a class. Make sure classes are created (Step 2) before adding students.")
    pdf.info_box("Session Enrollment",
                 "When you add a student (individually or via Excel upload), the system automatically "
                 "creates an enrollment record for the school's current academic year. This links the "
                 "student to the correct session. Roll numbers are unique per session and class, so "
                 "different academic years can have different students with the same roll number in the same class.")

    pdf.section_title("Step 4: Add Subjects")
    pdf.nav_path("Sidebar > Academics > Subjects")
    pdf.step("Navigate to Academics > Subjects in the sidebar.")
    pdf.step("In the 'Subjects' tab, click 'Add Subject'.")
    pdf.step("Enter: Subject Name, Subject Code, Description, and whether it is an Elective.")
    pdf.step("Save. Repeat for all subjects taught in the school.")
    pdf.step("Switch to the 'Assignments' tab to assign subjects to classes.")
    pdf.step("Select a class, pick a subject, choose the teacher, set periods per week, then save.")

    pdf.section_title("Step 5: Create Timetable")
    pdf.nav_path("Sidebar > Academics > Timetable")
    pdf.step("Navigate to Academics > Timetable.")
    pdf.step("Select a class to create its timetable.")
    pdf.step("Define time slots (period start time, end time).")
    pdf.step("Assign subjects and teachers to each period for each day of the week.")
    pdf.step("Save the timetable. Students and parents can now view it in their portals.")

    pdf.info_box("Prerequisite", "Subjects must be assigned to classes (Step 4) before creating timetables.")

    pdf.section_title("Setup Checklist Summary")
    pdf.simple_table(
        ["Step", "What to Do", "Prerequisite", "Who Does It"],
        [
            ["1", "Set up Academic Year & Terms", "Logged into school", "School Admin"],
            ["2", "Create Classes", "None", "School Admin"],
            ["3", "Add Students", "Classes exist", "School Admin"],
            ["4", "Add Subjects & Assign to Classes", "Classes exist", "School Admin"],
            ["5", "Create Timetable", "Subjects assigned", "School Admin"],
        ],
        [15, 60, 55, 60]
    )

    pdf.section_title("Module Dependency Reference")
    pdf.body_text("Use this table to understand what must be set up before each feature works:")
    pdf.simple_table(
        ["Module / Feature", "Depends On"],
        [
            ["Attendance", "Classes, Students"],
            ["Face Attendance", "Classes, Students, Enrolled Faces"],
            ["Timetable", "Subjects assigned to classes"],
            ["Exams & Marks", "Academic Year, Terms, Classes, Subjects"],
            ["Report Cards", "Published exam results"],
            ["Fee Collection", "Fee Structures, Finance Accounts"],
            ["Payroll", "Staff, Salary Structures"],
            ["Transport", "Routes, Vehicles, Students"],
            ["Library Issues", "Books in Catalog, Students/Staff"],
            ["Hostel", "Hostels, Rooms, Students"],
            ["LMS", "Subjects assigned to classes"],
        ],
        [55, 135]
    )

    # =========================================================================
    # CHAPTER 3: ATTENDANCE MODULE
    # =========================================================================
    pdf.chapter_title("Attendance Module (AI-Powered)")

    pdf.body_text(
        "The Attendance module uses AI-powered OCR to capture attendance from handwritten registers. "
        "Admins and teachers upload photos of attendance registers, and the AI extracts student names and marks. "
        "The system supports review and approval workflows."
    )

    pdf.info_box(
        "Teacher Access",
        "Teachers can upload and review attendance for classes they are assigned to via the "
        "Subjects management page (Academics > Subjects). When a teacher logs in, they only see "
        "their assigned classes in the class dropdown. Admins and Principals see all classes."
    )

    pdf.section_title("Capturing Attendance")
    pdf.nav_path("Sidebar > Attendance > Capture & Review > Upload Tab")
    pdf.step("Navigate to the Attendance section and click 'Capture & Review'.")
    pdf.step("You will see three tabs: Upload, Review, and Approve. Select the 'Upload' tab.")
    pdf.step("Select the Class from the dropdown (teachers see only their assigned classes) and pick the Date.")
    pdf.step("Upload an image of the handwritten attendance register (photo or scan).")
    pdf.step("Use the crop/zoom tool to frame the register area correctly.")
    pdf.step("Click 'Process' - the AI will extract student names and attendance marks (P, A, L, etc.).")
    pdf.step("Review the AI-extracted data on screen. Correct any errors if needed.")
    pdf.step("Click 'Submit' to save the captured attendance for review.")

    pdf.section_title("Reviewing Attendance")
    pdf.nav_path("Sidebar > Attendance > Capture & Review > Review Tab")
    pdf.step("Switch to the 'Review' tab to see all pending attendance records.")
    pdf.step("Click on a record to see the side-by-side view: original image vs. extracted data.")
    pdf.step("Verify each student's mark. Edit any incorrect marks directly in the table.")
    pdf.step("Click 'Approve' to confirm the attendance or 'Reject' to send it back for re-capture.")

    pdf.section_title("Viewing the Attendance Register")
    pdf.nav_path("Sidebar > Attendance > Register & Analytics")
    pdf.step("Navigate to 'Register & Analytics' under Attendance.")
    pdf.step("Select a class and date range to view the full attendance register.")
    pdf.step("The register shows a grid: students as rows, dates as columns, with marks in each cell.")
    pdf.step("Use the Analytics tab to view attendance trends, percentages, and accuracy metrics.")

    pdf.section_title("Attendance Mark Meanings")
    pdf.simple_table(
        ["Symbol", "Meaning", "Status"],
        [
            ["P", "Present", "Student was in class"],
            ["A", "Absent", "Student was not in class"],
            ["L", "Late", "Student arrived late"],
            ["Le", "Leave", "Student on approved leave"],
            ["HD", "Half Day", "Student was present for half the day"],
        ],
        [30, 60, 100]
    )
    pdf.info_box("Customization", "You can customize attendance marks and their meanings in "
                 "Settings > Mappings Tab. Add new symbols or change the default mapping.")

    # =========================================================================
    # CHAPTER 4: FACE ATTENDANCE (CAMERA-BASED)
    # =========================================================================
    pdf.chapter_title("Face Attendance (Camera-Based)")

    pdf.body_text(
        "The Face Attendance module uses AI-powered face recognition to take attendance from a single "
        "group photo of the class. Instead of scanning handwritten registers, a teacher or admin takes "
        "a photo of the class, and the system automatically detects faces, matches them to enrolled "
        "students, and marks attendance. This is faster and works well for classes where camera-based "
        "attendance is preferred."
    )

    pdf.info_box("How It Works",
                 "1. Enroll each student by uploading a clear portrait photo (one-time setup). "
                 "2. Take a group photo of the class. "
                 "3. The AI detects all faces, matches them to enrolled students, and flags uncertain matches. "
                 "4. Review the results and confirm attendance.")

    pdf.warning_box(
        "Face Enrollment is required before using face attendance. Students without an enrolled face "
        "photo cannot be matched automatically. Enroll all students in a class before capturing attendance."
    )

    pdf.section_title("Prerequisites")
    pdf.body_text("Before using Face Attendance, ensure:")
    pdf.bullet("Classes are created with students enrolled (see Chapter 2)")
    pdf.bullet("The face recognition library is installed on the server (dlib + face_recognition)")
    pdf.bullet("Supabase storage bucket is configured for image uploads")

    pdf.section_title("Step 1: Enroll Student Faces")
    pdf.nav_path("Sidebar > Attendance > Face Attendance > Manage Enrollments")
    pdf.body_text(
        "Enrollment is a one-time setup where you upload a clear portrait photo of each student. "
        "The system extracts a facial fingerprint (embedding) that is used for matching during attendance."
    )
    pdf.step("Navigate to Face Attendance and click 'Manage Enrollments' (top-right button).")
    pdf.step("Select a Class from the dropdown on the left panel.")
    pdf.step("Select a Student from the student dropdown (shows all students in the class).")
    pdf.step("Upload or capture a clear portrait photo of the student. The photo must show exactly one face.")
    pdf.step("Click 'Enroll Face'. The system uploads the photo, detects the face, and stores the facial embedding.")
    pdf.step("The enrolled student appears in the right panel with a quality score percentage.")
    pdf.step("Repeat for all students in the class.")

    pdf.info_box("Photo Tips",
                 "Use a clear, well-lit portrait photo with the student facing the camera. "
                 "Avoid group photos, sunglasses, or heavy shadows. Quality score above 70% is recommended. "
                 "The right panel shows all enrolled students with quality scores. "
                 "To remove an enrollment, click 'Remove' next to the student and confirm.")

    pdf.section_title("Step 2: Capture Class Photo")
    pdf.nav_path("Sidebar > Attendance > Face Attendance > Capture Tab")
    pdf.body_text(
        "Once students are enrolled, you can take attendance by capturing a group photo of the class."
    )
    pdf.step("Navigate to Face Attendance. You will see the Capture tab (default).")
    pdf.step("Select the Class from the dropdown.")
    pdf.step("Select the Date (defaults to today).")
    pdf.step("Click 'Select or Capture Photo' to take a photo using the device camera or upload an existing image.")
    pdf.step("A preview of the photo appears. Click 'Clear' to retake if needed.")
    pdf.step("Click 'Process Attendance'. The photo is uploaded and the AI begins processing.")
    pdf.step("You are automatically navigated to the Review page.")

    pdf.section_title("Step 3: Review Detected Faces")
    pdf.nav_path("Sidebar > Attendance > Face Attendance > Review Page")
    pdf.body_text(
        "After processing (10-30 seconds), the Review page shows three sections: the captured photo, "
        "a grid of detected face thumbnails with match info, and the Class Roll with present/absent toggles. "
        "The page auto-refreshes while processing."
    )
    pdf.simple_table(
        ["Badge", "Color", "Meaning"],
        [
            ["Auto", "Green", "High-confidence match (auto-accepted)"],
            ["Review", "Yellow", "Medium-confidence (needs your review)"],
            ["Manual", "Blue", "Manually matched by you"],
            ["Ignored", "Gray", "No match found"],
        ],
        [35, 35, 120]
    )
    pdf.step("Review the detected faces grid. Remove incorrect detections with the red X button.")
    pdf.step("In the Class Roll, click any student to toggle Present/Absent. "
             "AI-matched students are auto-marked Present; unmatched are marked Absent.")

    pdf.section_title("Step 4: Confirm Attendance")
    pdf.step("After reviewing and adjusting the present/absent selections, click 'Confirm Attendance'.")
    pdf.step("The system saves attendance records for all students in the class (Present or Absent).")
    pdf.step("A success message appears and the session status changes to 'Confirmed' (green badge).")
    pdf.step("Confirmed attendance records appear in the main Attendance Register alongside OCR-captured records.")

    pdf.info_box("Reprocessing",
                 "If you are unsatisfied with the AI results, click 'Reprocess' to re-run face detection "
                 "and matching on the same photo. This clears existing detections and starts fresh.")

    pdf.section_title("Viewing Past Sessions")
    pdf.nav_path("Sidebar > Attendance > Face Attendance > Sessions Tab")
    pdf.step("Click the 'Sessions' tab on the Face Attendance page.")
    pdf.step("View all past sessions with class name, date, face count, and status badge.")
    pdf.step("Click any session to open the Review page (view confirmed results or review pending ones).")
    pdf.body_text("Session statuses: Processing (blue), Needs Review (yellow), Confirmed (green), Failed (red).")

    pdf.section_title("Match Confidence Thresholds")
    pdf.body_text(
        "The AI uses distance-based matching to compare detected faces against enrolled student photos. "
        "Matches are classified into three categories based on confidence:"
    )
    pdf.simple_table(
        ["Category", "Threshold", "Action"],
        [
            ["Auto-Matched", "Distance < 0.40 (high confidence)", "Automatically accepted"],
            ["Flagged", "Distance 0.40-0.55 (medium)", "Flagged for manual review"],
            ["Ignored", "Distance >= 0.55 (low)", "No match, ignored"],
        ],
        [40, 70, 80]
    )

    # =========================================================================
    # CHAPTER 5: ACADEMICS MODULE
    # =========================================================================
    pdf.chapter_title("Academics Module")

    pdf.section_title("Managing Subjects")
    pdf.nav_path("Sidebar > Academics > Subjects > Subjects Tab")
    pdf.step("Click 'Add Subject' to create a new subject.")
    pdf.step("Fill in: Subject Name, Code (e.g., MATH, ENG), Description.")
    pdf.step("Check 'Is Elective' if the subject is optional for students.")
    pdf.step("Save. The subject appears in the list with AI-generated insights about workload.")

    pdf.sub_section("Assigning Subjects to Classes")
    pdf.nav_path("Sidebar > Academics > Subjects > Assignments Tab")
    pdf.step("Switch to the 'Assignments' tab.")
    pdf.step("Click 'Assign Subject' and select: Class, Subject, Teacher, Periods Per Week.")
    pdf.step("Save. This links the subject, teacher, and class together.")
    pdf.step("Repeat for all subject-class-teacher combinations.")

    pdf.section_title("Academic Sessions (Years & Terms)")
    pdf.nav_path("Sidebar > Academics > Sessions")
    pdf.body_text(
        "Academic sessions define the school calendar and are critical for exams, promotions, "
        "and reports. All student data - attendance, fees, exams, roll numbers - is scoped to "
        "the active academic session. Use the Academic Year Switcher in the header to view "
        "data for any session."
    )

    pdf.sub_section("Managing Academic Years")
    pdf.step("In the 'Years' tab, view all academic years.")
    pdf.step("Click 'Add Academic Year' to create a new one (Name, Start Date, End Date).")
    pdf.step("Click 'Set as Current' on the year you want to make active.")
    pdf.step("The year summary shows: number of terms, exams created, students enrolled.")
    pdf.info_box("Session-Scoped Data",
                 "When you switch the academic year in the header, all pages update to show data "
                 "for that session: Students, Attendance, Fees, Exams, and more. Roll numbers are "
                 "assigned per session, so the same class can have different students with roll "
                 "number 1 in different academic years.")

    pdf.sub_section("Managing Terms")
    pdf.step("Switch to the 'Terms' tab.")
    pdf.step("Filter by Academic Year if needed.")
    pdf.step("Click 'Add Term' and fill in: Name, Type (Term/Semester/Quarter), Order, Dates.")
    pdf.step("Terms define when exams happen and how report cards are structured.")

    pdf.sub_section("Importing Terms from Previous Session")
    pdf.step("In the 'Terms' tab, click 'Import Terms'.")
    pdf.step("Select Source Academic Year and Target Academic Year, then choose Conflict Mode: Skip Existing or Update Existing.")
    pdf.step("Click 'Preview Import' to review what will be created, updated, or skipped with adjusted dates.")
    pdf.step("Click 'Import Terms' to apply the import. Use this at the start of a new session to save setup time and keep term structure consistent.")

    pdf.section_title("Student Promotion")
    pdf.nav_path("Sidebar > Academics > Promotion")
    pdf.step("Select the source academic year and source class/session class.")
    pdf.step("Select the target academic year.")
    pdf.step("Review each student row and choose an action: PROMOTE, REPEAT, or GRADUATE.")
    pdf.step("For PROMOTE/REPEAT, confirm the target class or target session class and set roll numbers as needed.")
    pdf.step("Use preview helpers where available, then run bulk promotion.")
    pdf.step("After execution, open the Promotion History tab to verify generated event rows.")

    pdf.sub_section("Action Meanings")
    pdf.bullet("PROMOTE: Student moves to next class in the target academic year; source enrollment becomes PROMOTED.")
    pdf.bullet("REPEAT: Student remains at same grade intent in the target academic year; source enrollment becomes REPEAT.")
    pdf.bullet("GRADUATE: Student is marked terminal graduate in source context; no target class is required.")

    pdf.sub_section("Corrections (Single/Bulk)")
    pdf.step("If a promotion result is wrong, use Correct Single or Correct Bulk from Promotion History.")
    pdf.step("Provide source/target years and the correction action.")
    pdf.step("For REPEAT corrections, the system now normalizes stale promoted targets to same-grade repeat targets automatically.")
    pdf.step("When session-class IDs differ across years, correction resolves target-year session class mapping safely.")

    pdf.warning_box("Promotion and correction are audited operations. Always verify source year, target year, and class mappings before confirming.")
    pdf.info_box("Promotion & New Admissions",
                 "New admissions can happen in a future session before promotion is run for the current "
                 "session. For example, you can admit students to Playgroup for 2026-27 while 2025-26 "
                 "students are still in Playgroup. Roll numbers are independent per session, so there "
                 "are no conflicts. When you promote the old students, they move to the next class.")

    pdf.section_title("AI Analytics")
    pdf.nav_path("Sidebar > Academics > AI Analytics")
    pdf.body_text(
        "The AI Analytics page provides intelligent insights about academic performance, "
        "subject workload balance, attendance correlation with grades, and more. Use it to "
        "identify struggling students and subjects that need attention."
    )

    # =========================================================================
    # CHAPTER 5: EXAMINATIONS
    # =========================================================================
    pdf.chapter_title("Examinations Module")

    pdf.body_text(
        "The Examinations module covers the complete exam lifecycle: defining grade scales, "
        "creating exam types, scheduling exams, entering marks, viewing results, and generating report cards."
    )

    pdf.section_title("Step 1: Define Grade Scale")
    pdf.nav_path("Sidebar > Academics > Examinations > Grade Scale")
    pdf.step("Navigate to Grade Scale under Examinations.")
    pdf.step("Click 'Add Grade' and define each grade level.")
    pdf.step("For each grade, enter: Grade Name (A+, A, B+...), Min Marks, Max Marks, Grade Point (GPA).")
    pdf.step("Save all grades. This scale is used to auto-calculate student grades from marks.")

    pdf.simple_table(
        ["Grade", "Min %", "Max %", "Grade Point"],
        [
            ["A+", "90", "100", "4.0"],
            ["A", "80", "89", "3.7"],
            ["B+", "70", "79", "3.3"],
            ["B", "60", "69", "3.0"],
            ["C+", "50", "59", "2.5"],
            ["C", "40", "49", "2.0"],
            ["F", "0", "39", "0.0"],
        ],
        [40, 40, 40, 70]
    )

    pdf.section_title("Step 2: Create Exam Types")
    pdf.nav_path("Sidebar > Academics > Examinations > Exam Types")
    pdf.step("Click 'Add Exam Type'.")
    pdf.step("Enter: Type Name (e.g., 'Mid-Term Exam', 'Final Exam', 'Unit Test').")
    pdf.step("Set the weightage (how much this exam type counts toward the final grade).")
    pdf.step("Save. Exam types can be reused across terms and years.")

    pdf.section_title("Step 3: Create an Exam")
    pdf.nav_path("Sidebar > Academics > Examinations > Exams")
    pdf.step("Click 'Create Exam'.")
    pdf.step("Select: Academic Year, Term, Class, Exam Type.")
    pdf.step("Enter: Exam Name, Start Date, End Date.")
    pdf.step("The exam status will be 'SCHEDULED' initially.")
    pdf.step("As the exam progresses, update status: SCHEDULED > IN_PROGRESS > MARKS_ENTRY > COMPLETED > PUBLISHED.")

    pdf.section_title("Step 4: Enter Marks")
    pdf.nav_path("Sidebar > Academics > Examinations > Marks Entry")
    pdf.step("Select the Exam, Class, and Subject from the dropdowns.")
    pdf.step("The system loads all students in that class.")
    pdf.step("Enter marks for each student. The max marks are validated automatically.")
    pdf.step("Save marks. You can return and edit marks until the exam is published.")
    pdf.step("Bulk import from Excel is also available for large classes.")

    pdf.section_title("Step 5: View & Publish Results")
    pdf.nav_path("Sidebar > Academics > Examinations > Results")
    pdf.step("Select the Exam and Class to view computed results.")
    pdf.step("Results show: Subject-wise marks, grades (auto-calculated from grade scale), GPA.")
    pdf.step("Review results for accuracy.")
    pdf.step("Click 'Generate AI Comments' to create personalized per-subject comments for all students.")
    pdf.step("Click on any student row to expand and view/edit their AI-generated comments.")
    pdf.step("Click 'Publish Results' to make them visible to students and parents.")

    pdf.section_title("Step 6: Generate Report Cards")
    pdf.nav_path("Sidebar > Academics > Examinations > Report Cards")
    pdf.step("Select a Class from the dropdown to filter students.")
    pdf.step("Search or select the student from the filtered list (sorted by roll number).")
    pdf.step("Optionally filter by Academic Year and Term.")
    pdf.step("Preview the report card with all exam results, grades, and GPA.")
    pdf.step("Click 'Download PDF' to generate a printable report card with the school logo, "
             "marks table, grade scale reference, and page footer.")

    pdf.section_title("Weighted Average Configuration")
    pdf.nav_path("Sidebar > Settings > School Profile > Examination Settings")
    pdf.body_text(
        "Schools can choose between two calculation modes for report cards:"
    )
    pdf.bullet("Simple Average (default) - All exam marks summed and divided by total possible marks.")
    pdf.bullet("Weighted Average - Each exam type contributes based on its weight "
               "(e.g., Mid-Term 30%, Final 70%). Enable this toggle if your institution uses weighted grading.")
    pdf.step("Go to Settings > School Profile and scroll to 'Examination Settings'.")
    pdf.step("Toggle 'Weighted Average' ON or OFF.")
    pdf.step("When enabled, set appropriate weights on each Exam Type (Step 2 above).")

    pdf.info_box("Complete Exam Workflow",
                 "Grade Scale > Exam Types > Create Exam > Enter Marks > View Results > Publish > Report Cards. "
                 "Each step depends on the previous one.")

    # =========================================================================
    # CHAPTER 6: FINANCE MODULE
    # =========================================================================
    pdf.chapter_title("Finance Module")

    pdf.body_text(
        "The Finance module manages all monetary aspects of the school including fee collection, "
        "expenses, account management, discounts, and financial reporting."
    )

    pdf.section_title("Setting Up Finance Accounts")
    pdf.nav_path("Sidebar > Settings > Accounts Tab")
    pdf.step("Navigate to Settings and click the 'Accounts' tab.")
    pdf.step("Click 'Add Account' to create finance accounts.")
    pdf.step("Account types: CASH (physical cash), BANK (bank accounts), PERSON (individual accounts).")
    pdf.step("Enter: Account Name, Type, Opening Balance.")
    pdf.step("Check 'Staff Visible' if staff members should see this account.")
    pdf.step("Create at least one CASH and one BANK account before collecting fees.")

    pdf.section_title("Finance Dashboard")
    pdf.nav_path("Sidebar > Finance > Dashboard")
    pdf.body_text(
        "The Finance Dashboard is the central hub for all financial data. Use the period selector "
        "(This Month, Last Month, This Quarter, This Year, Custom) to filter data. "
        "Key metrics at a glance: Account Balance, Total Income, Total Expenses, Net Balance, "
        "and Fee Collection Rate."
    )
    pdf.body_text(
        "Dashboard cards include: Fee Collection Summary, Account Balances, Expense Breakdown (donut chart), "
        "Recent Transfers, Monthly Trend (6-month chart), Recent Entries, and Quick Actions."
    )
    pdf.info_box("PDF Reports", "Click the 'PDF' button on the dashboard header to download a comprehensive "
                 "finance report with summary, account balances, monthly trends, and expense breakdown.")

    pdf.section_title("Fee Setup Page")
    pdf.nav_path("Sidebar > Finance > Fee Setup")
    pdf.body_text(
        "The Fee Setup page is a dedicated configuration page with three tabs: "
        "Fee Structures, Generate Records, and Student Discounts."
    )

    pdf.sub_section("Tab 1: Fee Structures")
    pdf.body_text("Set base fee amounts by class or by individual student.")
    pdf.step("Use the 'By Class' / 'By Student' toggle to switch modes.")
    pdf.step("Use the fee type tabs (Monthly, Annual, Admission, Books, Fine) to switch between fee types.")
    pdf.step("By Class: Enter the fee amount for each class. Leave as 0 for classes that don't pay this fee.")
    pdf.step("By Student: Select a class, then override individual student fees. "
             "Overrides are highlighted in blue. Students without an override use the class default.")
    pdf.step("Set the 'Effective From' date (when this fee amount takes effect).")
    pdf.step("Click 'Review Changes' (by class) or 'Review & Save' (by student) to see a confirmation summary.")
    pdf.step("Confirm to save. Fee structures are used to auto-calculate amounts when generating fee records.")
    pdf.info_box("Fee Priority",
                 "Student-level fee overrides take precedence over class-level defaults. "
                 "You can set a per-student override from the By Student mode.")

    pdf.sub_section("Tab 2: Generate Records")
    pdf.step("Use the fee type tabs to select which type of fee to generate.")
    pdf.step("For Monthly fees: select the month and year. The system shows a preview of how many "
             "records will be created, how many already exist (will be skipped), and the total amount.")
    pdf.step("For non-monthly fees (Annual, Admission, Books, Fine): select the class to preview. "
             "The system shows per-student amounts resolved from fee structures.")
    pdf.step("Review the preview, then click 'Generate' and confirm. Fee records are created for all "
             "eligible students. Students without a fee structure or with existing records are skipped.")
    pdf.warning_box("Fee generation requires fee structures to be set first. Students without a matching "
                    "fee structure will be listed as 'no fee structure' in the preview and will not receive a record.")

    pdf.sub_section("Tab 3: Student Discounts")
    pdf.body_text(
        "Assign discounts or scholarships to individual students directly from the Fee Setup page. "
        "This tab shows each student's base monthly fee, the applied discount/scholarship, "
        "and the calculated effective fee - all in one view."
    )
    pdf.step("Select a class from the dropdown. The student table loads with columns: "
             "Roll, Student Name, Base Fee, Discount/Scholarship, Effective Fee, and Action.")
    pdf.step("Students with an assigned discount show a colored badge (blue for discounts, "
             "purple for scholarships) and their row is highlighted green.")
    pdf.step("Click 'Assign' on a student row to open the assignment modal.")
    pdf.step("In the modal, toggle between 'Discount' and 'Scholarship', select from the dropdown "
             "(shows name, type, and value), add optional notes, then click 'Assign'.")
    pdf.step("To remove a discount, click 'Remove' on the student row and confirm.")
    pdf.step("Use the 'Bulk Assign' button to assign one discount or scholarship to all students "
             "in the selected class at once. The system shows how many were created and how many "
             "were skipped (already assigned).")
    pdf.info_box("Effective Fee Calculation",
                 "Percentage discounts: Effective = Base Fee - (Base Fee x Percentage / 100). "
                 "Fixed discounts: Effective = Base Fee - Fixed Amount. "
                 "Full scholarships: Effective = 0. "
                 "The effective fee column updates instantly when a discount is assigned or removed.")

    pdf.section_title("Creating Individual Fee Records")
    pdf.nav_path("Sidebar > Finance > Fee Collection > Create Fee")
    pdf.step("Click 'Create Fee' to open the single fee creation modal.")
    pdf.step("Select a class, then search for a student using the searchable dropdown.")
    pdf.step("The fee amount auto-fills from the student's fee structure (class default or student override).")
    pdf.step("If the student has already paid, enter the paid amount. Payment fields (Account, Method, Date) "
             "appear automatically when a paid amount is entered.")
    pdf.step("The system warns if a duplicate fee record already exists for the same student/type/period.")
    pdf.step("Click 'Create' to save the fee record.")

    pdf.section_title("Fee Collection Page")
    pdf.nav_path("Sidebar > Finance > Fee Collection")
    pdf.body_text(
        "The fee collection page loads all fee records for the selected month/year in a single request. "
        "Switching class or status filters is instant (no loading delay) because filtering happens on your browser."
    )
    pdf.sub_section("Summary Cards")
    pdf.body_text("Four KPI cards show month-wide totals: Total Payable, Received, Balance, and Collection Rate.")
    pdf.sub_section("Analytics")
    pdf.body_text("Click 'Show Analytics' to reveal class-wise bar charts, payment status donut, and pending student breakdown.")
    pdf.sub_section("Filters")
    pdf.body_text("Use the Fee Type, Month, Year, Class, and Status dropdowns to narrow the table view. "
                  "Class and Status filters apply instantly without re-fetching data.")

    pdf.section_title("Recording Payments")
    pdf.nav_path("Sidebar > Finance > Fee Collection")
    pdf.step("In the fee table, click the row's payment area or use the inline edit feature.")
    pdf.step("Enter: Amount Paid, select the receiving Account, Payment Method, and Date.")
    pdf.step("Click 'Save'. The student's status updates automatically (PAID, PARTIAL, UNPAID, ADVANCE).")

    pdf.section_title("Bulk Operations")
    pdf.step("Select multiple students using the checkboxes in the fee table.")
    pdf.step("The bulk action bar appears at the bottom with options to:")
    pdf.bullet("Set paid amount, account, and payment method for all selected records at once")
    pdf.bullet("Pay Full - One click to mark all selected students as fully paid (amount paid = total payable). "
               "Select an account, then click the green 'Pay Full' button. Each student's paid amount is set to "
               "their individual total (amount due + previous balance), saving time during month-end collection.")
    pdf.bullet("Delete all selected records (with confirmation)")
    pdf.step("Confirm the bulk action. All selected records update simultaneously.")

    pdf.section_title("Managing Discounts & Scholarships")
    pdf.nav_path("Sidebar > Finance > Discounts")
    pdf.body_text(
        "The Discounts page has three tabs for managing discount rules, scholarship programs, "
        "and viewing all student assignments across the school."
    )
    pdf.sub_section("Creating Discount Rules")
    pdf.step("Go to the 'Discounts' tab and click 'Add Discount'.")
    pdf.step("Define: Discount Name, Type (Percentage or Fixed Amount), Value.")
    pdf.step("Set 'Applies To': All Students, Grade Level, Specific Class, Individual Student, or Siblings.")
    pdf.step("Optionally set start/end dates, max uses, and whether the discount is stackable.")
    pdf.sub_section("Creating Scholarships")
    pdf.step("Go to the 'Scholarships' tab and click 'Add Scholarship'.")
    pdf.step("Define: Name, Type (Merit, Need, Sports, Staff Child, Other).")
    pdf.step("Set coverage: Full Fee Waiver, Percentage Off, or Fixed Amount Off.")
    pdf.sub_section("Assigning to Students")
    pdf.body_text(
        "Student assignments can be managed from two places: the Discounts page (Student Assignments tab) "
        "or the Fee Setup page (Student Discounts tab). The Fee Setup page is recommended because it shows "
        "base fees and effective fees alongside the discount assignments."
    )
    pdf.info_box("Tip", "Navigate to Finance > Fee Setup > Student Discounts tab for the most efficient workflow. "
                 "Select a class to see all students with their base fee, assigned discount, and effective fee in one view.")

    pdf.section_title("Recording Expenses")
    pdf.nav_path("Sidebar > Finance > Expenses")
    pdf.step("Click 'Add Expense'.")
    pdf.step("Enter: Description, Category, Amount, Date, Account (which account pays).")
    pdf.step("Save. The expense is recorded and the account balance is updated.")
    pdf.step("Use category filters to view expenses by type.")
    pdf.step("Edit or delete expenses as needed.")

    pdf.section_title("Online Payment Collection")
    pdf.nav_path("Sidebar > Finance > Payment Gateways")
    pdf.body_text(
        "The system supports online fee payments through JazzCash, Easypaisa, and Manual bank transfers. "
        "Parents can pay fees directly from their portal once gateways are configured."
    )
    pdf.step("Navigate to Finance > Payment Gateways.")
    pdf.step("Configure at least one gateway (JazzCash, Easypaisa, or Manual) with valid credentials.")
    pdf.step("Click 'Test Connection' to verify credentials are correct.")
    pdf.step("Toggle the gateway to 'Active' and set one as the default.")
    pdf.step("Parents will now see a 'Pay Now' button on unpaid fees in their portal.")
    pdf.step("When a parent pays online, the system automatically records the payment and updates the fee balance.")
    pdf.step("Payment status is tracked: Initiated, Pending, Successful, or Failed.")
    pdf.step("View all online payments in the Payment History tab on the Payment Gateways page.")

    pdf.info_box("Payment Security", "All payment transactions use cryptographic signatures "
                 "(HMAC-SHA256 for JazzCash, SHA-256 for Easypaisa) to prevent tampering. "
                 "Callback URLs are verified before updating payment status.")

    pdf.info_box("Financial Record Safety",
                 "When a student is deleted, all their financial records (fee payments, online payments, "
                 "fee structures, discounts) are preserved with 'Deleted Student' label. "
                 "Best practice: mark students as inactive instead of deleting them.")

    pdf.section_title("Inter-Account Transfers")
    pdf.step("On the Finance Dashboard, click 'Transfer'.")
    pdf.step("Select: Source Account, Destination Account, Amount, Description.")
    pdf.step("Click 'Transfer'. Both account balances update immediately.")

    pdf.section_title("Month Closing")
    pdf.nav_path("Sidebar > Settings > Accounts Tab > Close Month")
    pdf.step("At the end of each month, click 'Close Month' in Settings > Accounts.")
    pdf.step("This finalizes the month's transactions and carries forward balances.")
    pdf.step("Closed months cannot be edited (prevents accidental changes to past records).")

    # =========================================================================
    # CHAPTER 7: HR & STAFF MODULE
    # =========================================================================
    pdf.chapter_title("HR & Staff Management Module")

    pdf.body_text(
        "The HR module manages the complete employee lifecycle from hiring to payroll. "
        "It includes staff directory, departments, salary structures, payroll processing, "
        "leave management, attendance tracking, performance appraisals, and document management."
    )

    pdf.section_title("Setting Up Departments")
    pdf.nav_path("Sidebar > HR & Staff > Departments")
    pdf.step("Click 'Add Department'.")
    pdf.step("Enter: Department Name (e.g., 'Science', 'Administration', 'Sports').")
    pdf.step("Add designations within each department (e.g., 'Head of Department', 'Senior Teacher').")
    pdf.step("Save. Departments are used when adding staff members.")

    pdf.section_title("Adding Staff Members")
    pdf.nav_path("Sidebar > HR & Staff > Staff Directory > Add Staff")
    pdf.step("Click 'Add Staff Member'.")
    pdf.step("Fill in Personal Information: First Name, Last Name, Email, Phone, Gender, Date of Birth.")
    pdf.step("Fill in Employment Details: Department, Designation, Employee ID, Employment Type "
             "(Full-time/Part-time/Contract), Date of Joining.")
    pdf.step("Add Address and Emergency Contact information.")
    pdf.step("Save. The staff member appears in the directory.")

    pdf.section_title("Staff Directory")
    pdf.nav_path("Sidebar > HR & Staff > Staff Directory")
    pdf.body_text("The Staff Directory is the central hub for managing all staff information:")
    pdf.bullet("Search by name, email, or employee ID")
    pdf.bullet("Filter by department or employment status (Active, On Leave, Terminated)")
    pdf.bullet("Click on a staff member to view/edit their complete profile")
    pdf.bullet("Export directory as Excel or PDF")

    pdf.section_title("Salary Management")
    pdf.nav_path("Sidebar > HR & Staff > Salary Management")
    pdf.step("Define salary structures per designation.")
    pdf.step("Set components: Basic Pay, HRA, DA, Allowances, Deductions.")
    pdf.step("Assign salary structures to staff members.")
    pdf.step("Salary structures feed directly into payroll generation.")

    pdf.section_title("Payroll Processing")
    pdf.nav_path("Sidebar > HR & Staff > Payroll")
    pdf.step("Select the month and year for payroll.")
    pdf.step("Click 'Generate Payslips' to create payslips for all active staff.")
    pdf.step("Review generated payslips. Check amounts, deductions, and net pay.")
    pdf.step("Approve payslips individually or in bulk.")
    pdf.step("Mark approved payslips as 'Paid' once payment is disbursed.")
    pdf.step(
        "Click the 'Download PDF' button on any payslip to download a printable payslip document. "
        "The PDF includes the school logo (if configured in school settings), school name, address, "
        "contact details, employee information, earnings breakdown, deductions breakdown, net salary, "
        "and signature lines."
    )

    pdf.info_box(
        "School Logo on Payslips",
        "The payslip PDF automatically includes your school's logo at the top if one is configured. "
        "To set or update the logo, go to Settings > School Profile and enter the logo URL. "
        "If no logo is set, the payslip generates without it."
    )

    pdf.section_title("Leave Management")
    pdf.nav_path("Sidebar > HR & Staff > Leave Management")
    pdf.body_text("The leave system handles leave applications, approvals, and balance tracking:")
    pdf.step("Staff submit leave requests specifying: Leave Type, From Date, To Date, Reason.")
    pdf.step("HR Manager or Admin reviews the request.")
    pdf.step("Approve or reject the leave application with optional remarks.")
    pdf.step("Leave balances update automatically upon approval.")
    pdf.step("View leave history and balances for any staff member.")

    pdf.section_title("Staff Attendance")
    pdf.nav_path("Sidebar > HR & Staff > Staff Attendance")
    pdf.step("Select the date to mark attendance.")
    pdf.step("Mark each staff member as Present, Absent, or On Leave.")
    pdf.step("Save. Staff attendance records feed into payroll calculations.")

    pdf.section_title("Performance Appraisals")
    pdf.nav_path("Sidebar > HR & Staff > Performance Appraisals")
    pdf.step("Click 'Create Appraisal' and select the staff member.")
    pdf.step("Fill in performance criteria, ratings, and comments.")
    pdf.step("Submit the appraisal for review.")
    pdf.step("Appraisal history is maintained per staff member.")

    pdf.section_title("Staff Documents")
    pdf.nav_path("Sidebar > HR & Staff > Documents")
    pdf.step("Select a staff member.")
    pdf.step("Upload documents: ID proofs, certificates, contracts, etc.")
    pdf.step("Documents are stored securely and accessible from the staff profile.")

    pdf.section_title("Linking & Unlinking User Accounts")
    pdf.nav_path("Sidebar > HR & Staff > Staff Directory")
    pdf.body_text(
        "Staff members can be linked to existing user accounts so the same person's HR record "
        "and login credentials are connected. This is useful when a user account was created "
        "separately from the staff record."
    )
    pdf.step("Find the staff member in the directory. If they have no linked account, "
             "you will see a 'Link Account' button.")
    pdf.step("Click 'Link Account' to open the search modal.")
    pdf.step("Search for the user by name or username. Click on the correct user to link them.")
    pdf.step("Once linked, the staff member's account column shows the linked username and role.")
    pdf.step("To unlink, click the 'Unlink' button next to the linked username. "
             "This removes the association but does not delete either the staff record or the user account.")
    pdf.warning_box(
        "A user can only be linked to one staff member at a time. "
        "If the user is already linked to another staff record, you must unlink them first."
    )

    pdf.section_title("Letter Composer")
    pdf.nav_path("Sidebar > HR & Staff > Letter Composer")
    pdf.body_text(
        "The Letter Composer allows you to create official letters on your school's letterhead. "
        "It supports 7 built-in templates (Experience Certificate, Termination, Warning, "
        "Appreciation, Leave Approval, Salary Increment, Transfer) and fully custom letters."
    )
    pdf.step("Select a Quick Draft Template to start with a pre-built letter structure, or choose 'Custom Letter'.")
    pdf.step("Pick a recipient: select from School, Employee, or type a custom address. "
             "Selecting an employee auto-fills placeholders like name, department, and designation.")
    pdf.step("Edit the Subject and Body. Use the formatting toolbar: *bold*, _italic_, ~strikethrough~, "
             "bullet lists, and numbered lists.")
    pdf.step("Preview your letter in the right panel (live preview updates as you type).")
    pdf.step("Click 'Generate PDF' to download the letter as a PDF with your school's letterhead as background.")
    pdf.step("Letters are automatically saved to history. Load, edit, or delete past letters from the history table.")

    pdf.info_box(
        "AI Letter Drafting",
        "Click 'Draft with AI' to open the AI assistant panel. Describe the letter you need "
        "in plain language (e.g., 'Write a warning letter for late attendance') and the AI will "
        "generate a complete subject and body. Quick suggestion chips are provided for common letter types. "
        "If an employee is selected, their details are automatically included for context. "
        "Review and edit the AI-generated content before generating the PDF."
    )

    pdf.info_box(
        "School Letterhead",
        "Letters are generated with your school's letterhead as the PDF background. "
        "To configure the letterhead, go to Settings > School Profile and set the Letterhead URL "
        "(uploaded to Supabase Storage). If no letterhead is set, letters generate on a white background."
    )

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
        "Admissions uses the school's academic years (set up in Academics > Sessions). "
        "When converting enquiries to students, you select the target academic year and class. "
        "The system creates the student record and enrolls them in that session."
    )

    pdf.section_title("Creating Enquiries")
    pdf.nav_path("Sidebar > Admissions > Enquiries")
    pdf.step("Click 'New Enquiry'.")
    pdf.step("Fill in: Student Name, Parent Name, Phone, Email, Target Grade.")
    pdf.step("Set Source: Walk-in, Phone, Website, Referral, Social Media, Advertisement, Other.")
    pdf.step("Set Priority: High, Medium, Low.")
    pdf.step("Add initial notes and save.")

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
    pdf.step("View all enquiries in a searchable, filterable table.")
    pdf.step("Filter by: Status, Grade, Source.")
    pdf.step("The pipeline summary at the top shows counts for each stage (New, Confirmed, Converted, Cancelled).")
    pdf.step("Use the 'Edit' action to update enquiry details or 'Cancel' to mark as cancelled.")
    pdf.step("Move enquiries from New to Confirmed when admission is approved.")

    pdf.section_title("Followup Management")
    pdf.step("Open an enquiry's detail page.")
    pdf.step("Add followup notes and schedule next followup dates.")
    pdf.step("The dashboard shows today's and overdue followups for quick action.")

    pdf.section_title("Converting Enquiries to Students")
    pdf.body_text(
        "Confirmed enquiries can be batch-converted into student records. Each converted student "
        "gets a Student record and a StudentEnrollment record linking them to the chosen academic year."
    )
    pdf.step("Select one or more enquiries with 'Confirmed' status using the checkboxes.")
    pdf.step("Click the 'Convert to Students' button that appears.")
    pdf.step("In the modal, select the target Academic Year and Class.")
    pdf.step("Click 'Convert'. Roll numbers are auto-assigned sequentially within that session and class.")
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
    pdf.bullet("Pipeline Summary - Count of enquiries in each stage (New, Confirmed, Converted, Cancelled)")
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
    pdf.step("Enter: Route Name, Description, Start Location, End Location, Distance (km), "
             "Estimated Duration.")
    pdf.step("Save the route.")
    pdf.step("Click on the route to add Stops.")
    pdf.step("For each stop, enter: Stop Name, Address, Order, Pickup Time, Drop Time.")
    pdf.step("Save stops. They appear in the route's stop list in order.")

    pdf.section_title("Adding Vehicles")
    pdf.nav_path("Sidebar > Transport > Vehicles")
    pdf.step("Click 'Add Vehicle'.")
    pdf.step("Enter: Registration Number, Vehicle Type (Bus/Van/Mini-Bus), Seating Capacity.")
    pdf.step("Enter Driver Details: Driver Name, Contact Number.")
    pdf.step("Assign the vehicle to a route.")
    pdf.step("Save. The vehicle is now linked to the route.")

    pdf.section_title("Assigning Students to Routes")
    pdf.nav_path("Sidebar > Transport > Assignments")
    pdf.step("Click 'Assign Student'.")
    pdf.step("Select the student from the dropdown.")
    pdf.step("Select the route and pickup/drop stop.")
    pdf.step("Save. The student is now assigned to that bus route.")
    pdf.step("View all assignments in the list. Edit or remove as needed.")

    pdf.section_title("Transport Attendance")
    pdf.nav_path("Sidebar > Transport > Attendance")
    pdf.step("Select the date and route.")
    pdf.step("Mark each student as: Picked Up, Not Picked Up, Absent.")
    pdf.step("Save attendance for the morning pickup.")
    pdf.step("Repeat for afternoon drop if needed.")

    pdf.section_title("Transport Dashboard")
    pdf.nav_path("Sidebar > Transport > Dashboard")
    pdf.body_text("The Transport Dashboard shows:")
    pdf.bullet("Total Routes - Number of active routes")
    pdf.bullet("Total Vehicles - Fleet size")
    pdf.bullet("Students Using Transport - Total students assigned to routes")
    pdf.bullet("Today's Attendance - Today's pickup/drop statistics")

    # =========================================================================
    # CHAPTER 10: LIBRARY MODULE
    # =========================================================================
    pdf.chapter_title("Library Module")

    pdf.body_text(
        "The Library module provides a complete book management system including cataloging, "
        "issuing/returning books, and tracking overdue items."
    )

    pdf.section_title("Setting Up Book Categories")
    pdf.nav_path("Sidebar > Library > Catalog")
    pdf.step("On the Book Catalog page, click 'Manage Categories'.")
    pdf.step("Add categories: Fiction, Non-Fiction, Science, Mathematics, History, Reference, etc.")
    pdf.step("Categories help organize and filter the book catalog.")

    pdf.section_title("Adding Books to the Catalog")
    pdf.nav_path("Sidebar > Library > Catalog")
    pdf.step("Click 'Add Book'.")
    pdf.step("Enter: Title, Author, ISBN, Publisher, Category, Total Copies, Shelf Location.")
    pdf.step("Save. The book appears in the catalog.")
    pdf.step("Use the search bar to find books by title, author, or ISBN.")
    pdf.step("Filter by category to browse specific sections.")

    pdf.section_title("Issuing Books")
    pdf.nav_path("Sidebar > Library > Issue / Return")
    pdf.step("Click 'Issue Book'.")
    pdf.step("Select Borrower Type: Student or Staff.")
    pdf.step("Search and select the borrower (student name or staff name).")
    pdf.step("Search and select the book to issue.")
    pdf.step("Set the Due Date (typically 14 days from today).")
    pdf.step("Add optional notes and click 'Issue'.")
    pdf.step("The book's available copies count decreases by 1.")

    pdf.section_title("Returning Books")
    pdf.nav_path("Sidebar > Library > Issue / Return")
    pdf.step("Find the issued book in the list (search by student name or book title).")
    pdf.step("Click 'Return' next to the entry.")
    pdf.step("Confirm the return. The book's available copies increase by 1.")
    pdf.step("If the book is overdue, any applicable fine is recorded.")

    pdf.section_title("Tracking Overdue Books")
    pdf.nav_path("Sidebar > Library > Overdue Books")
    pdf.step("View all books that are past their due date.")
    pdf.step("See borrower details and number of days overdue.")
    pdf.step("Send reminders to borrowers.")
    pdf.step("Update due dates if an extension is granted.")

    pdf.section_title("Library Dashboard")
    pdf.nav_path("Sidebar > Library > Dashboard")
    pdf.body_text("The Library Dashboard displays:")
    pdf.bullet("Total Books - Total unique titles in the catalog")
    pdf.bullet("Total Copies - Sum of all book copies")
    pdf.bullet("Currently Issued - Books currently checked out")
    pdf.bullet("Overdue Count - Books past their due date")
    pdf.bullet("Categories - Number of book categories")
    pdf.bullet("Most Issued Books - Popular titles chart")

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
    pdf.nav_path("Sidebar > Academics > Curriculum")
    pdf.body_text(
        "The Curriculum page lets you organize textbooks into a Book > Chapter > Topic hierarchy "
        "for each class and subject. This structure powers syllabus progress tracking and lesson plan topic selection."
    )
    pdf.step("Select a Class and Subject from the filter dropdowns.")
    pdf.step("Click 'Add Book' to create a textbook entry. Enter title, author, publisher, edition, and language.")
    pdf.step("Click the book to view its chapters and topics in the tree view.")
    pdf.step("Add chapters and topics manually, or use 'Import TOC' for bulk import.")

    pdf.sub_section("Importing Table of Contents")
    pdf.body_text("The Import TOC feature supports two modes:")
    pdf.step("Type / Paste: Manually type or paste the table of contents text with indentation for chapter/topic structure.")
    pdf.step(
        "Upload Photo: Take or upload a photo of the book's printed TOC page. "
        "The system uses OCR (Google Vision) with language-aware text extraction."
    )
    pdf.step("After OCR extraction, review and edit the text before clicking 'Import' to create chapters and topics.")
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
    pdf.nav_path("Sidebar > Academics > LMS > Lesson Plans")
    pdf.step("Click 'Create Lesson Plan'.")
    pdf.step("Select: Class, Subject (from assigned subjects).")
    pdf.step("Enter: Title, Description, Learning Objectives.")
    pdf.step("Set: Lesson Date, Duration (in minutes).")
    pdf.step("Add: Materials Needed, Teaching Methods.")
    pdf.step("Save as 'Draft' or 'Publish' immediately.")
    pdf.step("Published lesson plans are visible to other teachers for reference.")

    pdf.section_title("Creating Assignments")
    pdf.nav_path("Sidebar > Academics > LMS > Assignments")
    pdf.step("Click 'Create Assignment'.")
    pdf.step("Select Class and Subject.")
    pdf.step("Enter: Title, Description, Instructions.")
    pdf.step("Set: Due Date, Maximum Marks.")
    pdf.step("Define submission criteria (file types, word count, etc.).")
    pdf.step("Save. The assignment appears in student portals immediately.")

    pdf.section_title("Reviewing Submissions")
    pdf.step("Click on an assignment to see student submissions.")
    pdf.step("For each submission, you can: View the submitted work, add comments, and assign a grade.")
    pdf.step("Use bulk grading to score multiple submissions quickly.")
    pdf.step("Grades feed into the student's academic performance record.")

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
    pdf.step("Unread notifications are highlighted with a blue dot. Click to mark as read.")
    pdf.step("Use 'Mark all read' (with confirmation) to clear all unread notifications at once.")
    pdf.step("Filter by event type (Absence, Fee Due, Exam, Transport Update, etc.) using the dropdown.")

    pdf.section_title("Creating Notification Templates (Admin)")
    pdf.nav_path("Sidebar > Notifications > Templates Tab")
    pdf.step("Switch to the 'Templates' tab.")
    pdf.step("Click 'Create Template'.")
    pdf.step("Enter: Template Name, Subject, Body (supports variables like {student_name}).")
    pdf.step("Save. Templates can be reused when sending notifications.")

    pdf.section_title("Sending Notifications (Admin)")
    pdf.nav_path("Sidebar > Notifications > Send Tab")
    pdf.step("Switch to the 'Send' tab.")
    pdf.step("Choose mode: 'Broadcast' to send to all users of a role, or 'Single' for one recipient.")
    pdf.step("In Broadcast mode, select a role group: All Parents, All Teachers, All Staff, Principals, HR Managers, Accountants, or All Students.")
    pdf.step("Optionally pick an existing template to pre-fill the message, or compose a custom message.")
    pdf.step("For SMS/WhatsApp channels, a character counter helps keep messages within limits (160/1600 chars).")
    pdf.step("Click 'Send'. The system shows how many notifications were sent, failed, or skipped.")

    pdf.section_title("Notification Analytics (Admin)")
    pdf.nav_path("Sidebar > Notifications > Analytics Tab")
    pdf.body_text("Track notification effectiveness with configurable date ranges (7 days, 30 days, 90 days, or all time):")
    pdf.bullet("Delivery Rate - How many notifications were successfully delivered")
    pdf.bullet("Read Rate - Percentage of notifications opened/read")
    pdf.bullet("Breakdown by channel (WhatsApp, SMS, In-App, Email, Push) and event type")

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
        "Channel toggles include WhatsApp, SMS, In-App, Email, and Push notifications."
    )
    pdf.info_box("Background Tasks", "Automated notifications, OCR retries, AI threshold tuning, "
                 "drift detection, and anomaly detection all run automatically on schedule. "
                 "No manual action required.")

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
    pdf.step("Select a recipient from the dropdown. Recipients are grouped by role (Teachers, Parents, Students, Staff).")
    pdf.step("For teacher-parent/student conversations, the student context is automatically set based on the recipient.")
    pdf.step("Optionally enter a subject line for the conversation.")
    pdf.step("Type your message and click 'Send'.")
    pdf.info_box("Thread Reuse", "If you already have an active conversation with the same person "
                 "(and same student context), your new message will be added to the existing thread "
                 "instead of creating a duplicate.")

    pdf.section_title("Replying to Messages")
    pdf.step("Click on any thread in the thread list to open the conversation.")
    pdf.step("All messages in the thread are displayed chronologically (oldest first).")
    pdf.step("Your messages appear on the right side, the other person's on the left.")
    pdf.step("Type your reply in the input box at the bottom and click 'Send' or press Enter.")
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
    pdf.step("Click on a child's name to see their overview page.")
    pdf.step("The overview shows: Profile photo, class, roll number, quick stats.")

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

    pdf.sub_section("Paying Fees Online")
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
                 "has configured payment gateways. If you don't see the Pay Now button, contact the school office.")

    pdf.sub_section("Timetable")
    pdf.nav_path("Parent Portal > Child > Timetable")
    pdf.step("View the child's class timetable.")
    pdf.step("See subjects, teachers, and period timings for each day.")

    pdf.sub_section("Exam Results")
    pdf.nav_path("Parent Portal > Child > Results")
    pdf.step("View exam marks and grades (once published by the school).")
    pdf.step("See subject-wise performance and GPA.")
    pdf.step("Download report cards as PDF.")

    pdf.section_title("Applying for Leave")
    pdf.nav_path("Parent Portal > Leave Application")
    pdf.step("Click 'Apply for Leave' in the sidebar.")
    pdf.step("Select the child, enter: From Date, To Date, Reason.")
    pdf.step("Submit the application. Track its status (Pending, Approved, Rejected).")

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
    pdf.step("View all assignments from your teachers.")
    pdf.step("See due dates and submission status.")
    pdf.step("Submit your work before the deadline.")
    pdf.step("View grades and teacher feedback after review.")

    pdf.section_title("My Fees")
    pdf.nav_path("Student Portal > Fees")
    pdf.step("View your fee balance and payment history.")
    pdf.step("See upcoming due dates.")

    pdf.section_title("My Results")
    pdf.nav_path("Student Portal > Results")
    pdf.step("View your exam marks and grades.")
    pdf.step("See subject-wise performance.")
    pdf.step("Download report cards as PDF.")

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
    pdf.step("Use the suggestion chips (e.g., 'Explain a concept', 'Help with homework') for quick prompts.")
    pdf.step("Click 'Clear History' to start a fresh conversation.")
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
        "students leaving and returning to the hostel."
    )

    pdf.section_title("Hostel Dashboard")
    pdf.nav_path("Sidebar > Hostel > Dashboard")
    pdf.body_text("The Hostel Dashboard provides a quick overview of all hostel operations:")
    pdf.bullet("Total hostels, rooms, and current occupancy")
    pdf.bullet("Occupancy rate (percentage of beds filled)")
    pdf.bullet("Active allocations count")
    pdf.bullet("Pending gate pass requests")
    pdf.bullet("Students currently out on gate passes")
    pdf.bullet("Available beds count")
    pdf.bullet("Quick action links to manage rooms, allocations, and gate passes")

    pdf.section_title("Managing Hostels & Rooms")
    pdf.nav_path("Sidebar > Hostel > Rooms")
    pdf.sub_section("Creating a Hostel")
    pdf.step("Navigate to Hostel > Rooms in the sidebar.")
    pdf.step("Switch to the 'Hostels' tab.")
    pdf.step("Click 'Add Hostel'.")
    pdf.step("Enter: Name, Hostel Type (Boys / Girls / Mixed), Capacity.")
    pdf.step("Optionally assign a Warden (from staff members).")
    pdf.step("Save. The hostel appears in the list.")

    pdf.sub_section("Creating Rooms")
    pdf.step("Switch to the 'Rooms' tab.")
    pdf.step("Click 'Add Room'.")
    pdf.step("Select the Hostel this room belongs to.")
    pdf.step("Enter: Room Number, Floor, Room Type (Single / Double / Dormitory), Capacity.")
    pdf.step("Save. The room shows current occupancy vs. capacity.")
    pdf.info_box("Room Availability", "Rooms are automatically marked as unavailable when they reach full capacity. "
                 "The system prevents over-allocation by checking capacity before each new allocation.")

    pdf.section_title("Student Allocations")
    pdf.nav_path("Sidebar > Hostel > Allocations")
    pdf.body_text(
        "Allocations assign students to specific hostel rooms for an academic year."
    )
    pdf.sub_section("Allocating a Student")
    pdf.step("Navigate to Hostel > Allocations.")
    pdf.step("Click 'Add Allocation'.")
    pdf.step("Select: Student, Room (from available rooms), Academic Year.")
    pdf.step("The system validates that the room has capacity and the student isn't already allocated.")
    pdf.step("Save. The student is now assigned to the room.")
    pdf.sub_section("Vacating a Student")
    pdf.step("Find the active allocation in the list.")
    pdf.step("Click the 'Vacate' button.")
    pdf.step("The allocation is marked as inactive, and the room's occupancy count decreases.")
    pdf.warning_box("Each student can only have one active hostel allocation per academic year. "
                    "Vacate the current allocation before assigning to a new room.")

    pdf.section_title("Gate Passes")
    pdf.nav_path("Sidebar > Hostel > Gate Passes")
    pdf.body_text(
        "Gate passes track students leaving and returning to the hostel. "
        "They follow a workflow: Request > Approve/Reject > Checkout > Return."
    )
    pdf.sub_section("Creating a Gate Pass")
    pdf.step("Click 'New Gate Pass'.")
    pdf.step("Select: Student, Pass Type (Day Out / Weekend / Holiday / Emergency).")
    pdf.step("Enter: Departure Date, Expected Return Date/Time, Destination, Reason.")
    pdf.step("Submit. The pass is created with 'Pending' status.")
    pdf.sub_section("Approving / Rejecting Gate Passes")
    pdf.step("Review pending gate passes in the list.")
    pdf.step("Click 'Approve' to authorize the student's departure.")
    pdf.step("Click 'Reject' with a reason to deny the request.")
    pdf.sub_section("Checkout & Return")
    pdf.step("When the student physically leaves, click 'Checkout' to record departure time.")
    pdf.step("When the student returns, click 'Return' to record the actual return time.")
    pdf.simple_table(
        ["Status", "Meaning", "Next Action"],
        [
            ["Pending", "Pass requested, awaiting approval", "Approve or Reject"],
            ["Approved", "Pass approved, student may leave", "Checkout when departing"],
            ["Rejected", "Pass denied by admin", "No further action"],
            ["Checked Out", "Student has left the hostel", "Return when student comes back"],
            ["Returned", "Student has returned to hostel", "Complete - no action needed"],
            ["Cancelled", "Pass was cancelled", "No further action"],
        ],
        [35, 75, 80]
    )

    # =========================================================================
    # CHAPTER 16: SETTINGS & CONFIGURATION
    # =========================================================================
    pdf.chapter_title("Settings & Configuration")

    pdf.body_text(
        "The Settings page allows School Admins to configure system behavior. "
        "Settings are divided into multiple tabs."
    )

    pdf.section_title("Attendance Mark Mappings")
    pdf.nav_path("Sidebar > Settings > Mappings Tab")
    pdf.step("View the current mark-to-status mappings (e.g., P = Present, A = Absent).")
    pdf.step("Click 'Add Mapping' to add a new custom symbol.")
    pdf.step("Enter the symbol and select the status it maps to.")
    pdf.step("Use 'AI Suggestions' to get recommendations for common symbols.")
    pdf.step("Set a Default Status for unrecognized marks captured by AI.")

    pdf.section_title("Register Configuration")
    pdf.nav_path("Sidebar > Settings > Register Config Tab")
    pdf.body_text("Configure how the AI reads attendance registers:")
    pdf.bullet("Date Header Row - Which row contains the dates")
    pdf.bullet("Student Name Column - Which column has student names")
    pdf.bullet("Roll Number Column - Which column has roll numbers")
    pdf.bullet("Data Start Row/Column - Where the attendance marks begin")
    pdf.bullet("Orientation - Whether students are in rows or columns")

    pdf.section_title("Examination Settings")
    pdf.nav_path("Sidebar > Settings > School Profile > Examination Settings")
    pdf.body_text(
        "Toggle between Simple Average and Weighted Average for report card calculations. "
        "When Weighted Average is enabled, each exam type's contribution is scaled by its weight "
        "(configured in Exam Types). See Chapter 5 (Examinations) for details."
    )

    pdf.section_title("Finance Accounts Management")
    pdf.body_text("See Chapter 6 (Finance Module) > Setting Up Finance Accounts for detailed instructions.")

    pdf.section_title("Payment Gateway Configuration")
    pdf.nav_path("Sidebar > Finance > Payment Gateways")
    pdf.body_text(
        "Configure online payment gateways to allow parents to pay fees directly from the Parent Portal. "
        "The system supports JazzCash, Easypaisa, and Manual (bank transfer) payment methods."
    )
    pdf.step("Navigate to Finance > Payment Gateways in the sidebar.")
    pdf.step("You will see gateway cards for each supported provider (JazzCash, Easypaisa, Stripe, Razorpay, Manual).")
    pdf.step("Click on a gateway card to configure it. Enter the required credentials.")

    pdf.sub_section("JazzCash Configuration")
    pdf.step("Enter: Merchant ID (provided by JazzCash, e.g., MC12345).")
    pdf.step("Enter: Password (JazzCash merchant password).")
    pdf.step("Enter: Integrity Salt (used for HMAC-SHA256 signing of payment requests).")
    pdf.step("Select Environment: Sandbox (for testing) or Production (for live payments).")
    pdf.step("Return URL is auto-filled by the system.")

    pdf.sub_section("Easypaisa Configuration")
    pdf.step("Enter: Store ID (provided by Easypaisa, e.g., 12345).")
    pdf.step("Enter: Merchant Hash Key (used for hash verification).")
    pdf.step("Select Environment: Sandbox or Production.")

    pdf.sub_section("Manual/Bank Transfer Configuration")
    pdf.step("Enter: Bank Name, Account Title, Account Number, IBAN (optional), Branch.")
    pdf.step("Add Payment Instructions for parents (e.g., 'Deposit at any HBL branch').")
    pdf.step("Parents will see these bank details when choosing the Manual payment option.")

    pdf.sub_section("Gateway Management")
    pdf.step("Click 'Test Connection' on a gateway card to verify your credentials are valid.")
    pdf.step("Toggle a gateway on/off using the active/inactive toggle button.")
    pdf.step("Click 'Set as Default' to make a gateway the pre-selected option for parents.")
    pdf.step("Only active gateways are shown to parents on the fee payment page.")

    pdf.info_box("Sensitive Data", "Gateway credentials (passwords, salts, hash keys) are stored securely "
                 "and masked in the UI (only the first 4 characters are visible). They are never exposed in API responses.")

    # =========================================================================
    # CHAPTER 17: USER MANAGEMENT
    # =========================================================================
    pdf.chapter_title("User Management")

    pdf.body_text(
        "KoderEduAI uses a hierarchical role system for user management. "
        "School Admins and Principals can create and manage users within their schools."
    )

    pdf.section_title("User Roles & Hierarchy")
    pdf.body_text("The system has the following roles, listed from highest to lowest privilege:")
    pdf.simple_table(
        ["Role", "Can Create", "Access Level"],
        [
            ["School Admin", "Principal, HR Manager, Accountant, Teacher, Staff", "Full school access"],
            ["Principal", "HR Manager, Accountant, Teacher, Staff", "Full school access"],
            ["HR Manager", "- (no user creation)", "HR module full access"],
            ["Accountant", "- (no user creation)", "Finance module access"],
            ["Teacher", "- (no user creation)", "Academics & LMS access"],
            ["Staff", "- (no user creation)", "Basic read-only access"],
            ["Parent", "- (self-registered via invite)", "Child data only"],
            ["Student", "- (self-registered via invite)", "Own data only"],
        ],
        [40, 80, 60],
    )

    pdf.section_title("Managing Users (School Admin & Principal)")
    pdf.nav_path("Sidebar > Settings > Users Tab")
    pdf.body_text(
        "School Admins and Principals can create, edit, and deactivate user accounts "
        "for their school from the Users tab in Settings."
    )
    pdf.step("Navigate to Settings and click the 'Users' tab.")
    pdf.step("Click 'Add User' to open the user creation form.")
    pdf.step("Fill in Username (required), Email, Password, and select a Role from the dropdown.")
    pdf.step("The role dropdown only shows roles you are allowed to create based on your role.")
    pdf.step("Click 'Create User' to save. A school membership is automatically created.")
    pdf.step("To edit a user, click 'Edit' in the actions column. You can change name, email, role, and phone.")
    pdf.step("To deactivate a user, click 'Deactivate'. The user will no longer be able to log in.")
    pdf.step("To reactivate, click 'Activate' on an inactive user.")

    pdf.info_box("Role Restrictions",
                 "You can only edit or deactivate users whose role you are allowed to create. "
                 "For example, a Principal cannot deactivate a School Admin.")

    pdf.section_title("Creating Student User Accounts")
    pdf.nav_path("Sidebar > Students > Add Student")
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
    pdf.nav_path("Sidebar > Students")
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
        "HR Manager, Accountant) to determine system access level."
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
        "See Chapter 7 (HR & Staff > Linking & Unlinking User Accounts) for full details."
    )

    pdf.warning_box("Passwords cannot be recovered. If a user forgets their password, "
                    "a School Admin must reset it from the Users tab.")


    # =========================================================================
    # CHAPTER: AI INTELLIGENCE FEATURES
    # =========================================================================
    pdf.chapter_title("AI Intelligence Features")

    pdf.body_text(
        "KoderEduAI includes a suite of AI-powered intelligence features that operate across "
        "modules to improve accuracy, surface insights, and automate routine analysis. These "
        "features learn from your school's data patterns and become more effective over time."
    )

    pdf.section_title("Auto-Adaptive Thresholds")
    pdf.nav_path("Sidebar > Attendance > Capture & Review > Accuracy Dashboard")
    pdf.body_text(
        "Each school can customize AI thresholds for name matching and confidence scoring. "
        "Toggle 'Auto-tune thresholds' to let the system adjust weekly based on correction patterns. "
        "Requires at least 50 processed uploads before auto-tuning becomes effective."
    )

    pdf.section_title("Pipeline Fallback & Voting")
    pdf.body_text(
        "If the primary OCR provider (Google Vision) fails, the system tries alternatives automatically. "
        "Enable 'Multi-pipeline voting' for critical uploads where multiple providers cross-validate results."
    )
    pdf.simple_table(
        ["Provider", "Speed", "Best For"],
        [
            ["Google Vision", "Fast", "Most register types (recommended primary)"],
            ["Groq Vision", "Fast", "Good alternative with LLM reasoning"],
            ["Tesseract", "Medium", "Fallback when cloud services unavailable"],
        ],
        [50, 30, 110]
    )

    pdf.section_title("Accuracy Drift & Anomaly Detection")
    pdf.body_text(
        "The system monitors AI accuracy daily and alerts administrators when performance degrades "
        "(drift > 10 percentage points from 30-day baseline). It also detects unusual attendance "
        "patterns nightly: bulk class absences (>60%), student streaks (3+ consecutive days absent), "
        "and unusual school-wide absence (>30%)."
    )
    pdf.step("View drift alerts on the Accuracy Dashboard; review recent uploads for new register formats.")
    pdf.step("Navigate to Attendance > Anomalies to view, filter, and resolve detected anomalies.")

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
    pdf.nav_path("Sidebar > Academics > Examinations > Results")
    pdf.body_text(
        "Generate personalized comments for each student's exam performance based on marks, grades, "
        "and attendance. Click 'Generate AI Comments' on an exam's results page. Comments appear "
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

    pdf.section_title("Attendance Tips")
    pdf.bullet("OCR: Take clear, well-lit photos of flat registers; use the crop tool; always review before approving")
    pdf.bullet("Face: Enroll all students first; use clear portraits (quality > 70%); good lighting for group photos")
    pdf.bullet("Face: Avoid backlighting; review yellow-flagged matches; re-enroll after major appearance changes")

    pdf.section_title("Finance Tips")
    pdf.bullet("Set up accounts before the academic year; close months regularly")
    pdf.bullet("Use discounts/scholarships feature instead of manual fee adjustments")
    pdf.bullet("Use 'Pay Full' bulk action for quick month-end collection")
    pdf.bullet("Download PDF reports monthly from the Finance Dashboard for record-keeping")

    pdf.section_title("Operations Checklist")
    pdf.body_text("Recommended routine tasks by frequency:")
    pdf.simple_table(
        ["Frequency", "Tasks"],
        [
            ["Daily", "Mark attendance (OCR/Face), review AI results, record fee payments, "
                      "mark staff & transport attendance, issue/return books, check notifications"],
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
    output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "KoderEduAI_User_Guide.pdf")
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
            "title": "KoderEduAI",
            "subtitle": "School Administration Guide",
            "version": "3.1 - Session Class Standardization",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "totalChapters": len(pdf.json_chapters),
            "modules": pdf.json_modules
        },
        "chapters": pdf.json_chapters
    }

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
