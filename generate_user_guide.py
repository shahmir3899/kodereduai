"""
KoderEduAI - Comprehensive User Guide PDF Generator
Generates a professional PDF user guide covering all modules and workflows.
"""

from fpdf import FPDF
import os

class UserGuidePDF(FPDF):
    def __init__(self):
        super().__init__()
        self.set_auto_page_break(auto=True, margin=20)
        self.chapter_num = 0
        self.section_num = 0
        self.step_counter = 0
        self.toc_entries = []

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
        self.cell(0, 8, "Version 2.0", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(40)
        self.set_font("Helvetica", "", 10)
        self.cell(0, 6, "Modules Covered:", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(3)
        modules = [
            "Dashboard | Classes & Students | Attendance (AI-Powered)",
            "Academics & Examinations | Finance & Online Payments",
            "HR & Staff Management | Admissions CRM | Transport",
            "Library | Hostel Management | LMS | Notifications",
            "Parent & Student Portals | AI Study Helper"
        ]
        self.set_font("Helvetica", "I", 9)
        for m in modules:
            self.cell(0, 6, m, align="C", new_x="LMARGIN", new_y="NEXT")

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

    def sub_section(self, title):
        if self.get_y() > 250:
            self.add_page()
        self.ln(2)
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(60, 60, 60)
        self.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")
        self.ln(2)

    def body_text(self, text):
        self.set_font("Helvetica", "", 10)
        self.set_text_color(50, 50, 50)
        self.multi_cell(0, 6, text)
        self.ln(3)

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

    def nav_path(self, path):
        """Show navigation breadcrumb"""
        if self.get_y() > 260:
            self.add_page()
        self.set_font("Helvetica", "I", 9)
        self.set_text_color(100, 100, 100)
        self.cell(0, 6, f"Navigate to:  {path}", new_x="LMARGIN", new_y="NEXT")
        self.ln(2)

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
            ["School Admin", "Full School", "Full access to school settings, data, and configuration"],
            ["Principal", "School-wide", "View and manage school operations"],
            ["Teacher", "Assigned Classes", "Attendance, marks entry, lesson plans"],
            ["HR Manager", "HR Module", "Staff management, payroll, leave"],
            ["Staff", "Limited", "Basic access, notifications"],
            ["Parent", "Parent Portal", "View child's attendance, fees, results"],
            ["Student", "Student Portal", "View own attendance, timetable, assignments"],
        ],
        [30, 35, 125]
    )

    pdf.section_title("Logging In")
    pdf.step("Open the application URL in your web browser.")
    pdf.step("Enter your username/email and password on the Login page.")
    pdf.step("Click 'Sign In' to access your dashboard.")
    pdf.step("If you manage multiple schools, use the School Switcher (top bar) to select the active school.")
    pdf.info_box("First-Time Setup", "Your school and admin account will be pre-configured by the platform team. "
                 "Once you receive your School Admin credentials, log in and follow the Initial Setup steps in Chapter 2.")

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
    pdf.bullet("Attendance - Capture, Review, Register")
    pdf.bullet("Academics - Subjects, Timetable, Sessions, Examinations, LMS")
    pdf.bullet("Finance - Dashboard, Fee Collection, Expenses, Reports")
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
    pdf.step("Click 'Add Class'.")
    pdf.step("Enter: Class Name (e.g., 'Class 5-A'), Section (e.g., 'A'), Grade Level (e.g., 'Grade 5').")
    pdf.step("Save the class. Repeat for all classes and sections.")
    pdf.step("Classes are displayed grouped by grade level. Use the 'Grid' toggle for an alternate view.")
    pdf.info_box("Tip", "Create all sections for a grade. For example: Class 5-A, Class 5-B, Class 5-C. "
                 "The grade level grouping will organize them automatically.")

    pdf.section_title("Step 3: Add Students")
    pdf.nav_path("Sidebar > Management > Students")
    pdf.step("Navigate to 'Students' in the sidebar.")
    pdf.step("To add one student: Click 'Add Student' and fill in Name, Roll Number, Class, "
             "Parent Name, Parent Phone, Admission Number.")
    pdf.step("To bulk import: Click 'Import from Excel', download the template, fill it in, and upload.")
    pdf.step("Students will appear in the list. Use the class filter to view students by class.")
    pdf.step("You can export the student list as PDF, PNG, or Excel using the export buttons.")

    pdf.warning_box("Students must be assigned to a class. Make sure classes are created (Step 2) before adding students.")

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

    # =========================================================================
    # CHAPTER 3: ATTENDANCE MODULE
    # =========================================================================
    pdf.chapter_title("Attendance Module (AI-Powered)")

    pdf.body_text(
        "The Attendance module uses AI-powered OCR to capture attendance from handwritten registers. "
        "Teachers upload photos of attendance registers, and the AI extracts student names and marks. "
        "The system supports review and approval workflows."
    )

    pdf.section_title("Capturing Attendance")
    pdf.nav_path("Sidebar > Attendance > Capture & Review > Upload Tab")
    pdf.step("Navigate to the Attendance section and click 'Capture & Review'.")
    pdf.step("You will see three tabs: Upload, Review, and Approve. Select the 'Upload' tab.")
    pdf.step("Select the Class from the dropdown and pick the Date.")
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
    # CHAPTER 4: ACADEMICS MODULE
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
    pdf.body_text("Academic sessions define the school calendar and are critical for exams, promotions, and reports.")

    pdf.sub_section("Managing Academic Years")
    pdf.step("In the 'Years' tab, view all academic years.")
    pdf.step("Click 'Add Academic Year' to create a new one (Name, Start Date, End Date).")
    pdf.step("Click 'Set as Current' on the year you want to make active.")
    pdf.step("The year summary shows: number of terms, exams created, students enrolled.")

    pdf.sub_section("Managing Terms")
    pdf.step("Switch to the 'Terms' tab.")
    pdf.step("Filter by Academic Year if needed.")
    pdf.step("Click 'Add Term' and fill in: Name, Type (Term/Semester/Quarter), Order, Dates.")
    pdf.step("Terms define when exams happen and how report cards are structured.")

    pdf.section_title("Student Promotion")
    pdf.nav_path("Sidebar > Academics > Promotion")
    pdf.step("Select the source academic year and source class.")
    pdf.step("Select the target academic year and target class.")
    pdf.step("Review the list of students eligible for promotion.")
    pdf.step("Select students to promote (or select all).")
    pdf.step("Click 'Promote' to move them to the new class/year.")

    pdf.warning_box("Promotion is a bulk operation. Ensure the target academic year and classes exist before promoting.")

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
    pdf.step("Click 'Publish Results' to make them visible to students and parents.")

    pdf.section_title("Step 6: Generate Report Cards")
    pdf.nav_path("Sidebar > Academics > Examinations > Report Cards")
    pdf.step("Select the Academic Year, Term, and Class.")
    pdf.step("Choose individual student or entire class.")
    pdf.step("Preview the report card with all exam results, grades, and GPA.")
    pdf.step("Click 'Download PDF' to generate a printable report card.")
    pdf.step("Report cards can also be shared with parents through the Parent Portal.")

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
        "The Finance Dashboard provides a real-time overview of your school's financial health:"
    )
    pdf.bullet("Account Balances - Current balance of each cash, bank, and person account")
    pdf.bullet("Fee Collection Summary - Total collected this month, pending amounts")
    pdf.bullet("Expense Breakdown - Expenses categorized by type")
    pdf.bullet("Recent Transfers - Latest inter-account transfers")
    pdf.bullet("Monthly Trends - Charts showing income vs. expense trends")

    pdf.section_title("Generating Fee Structures")
    pdf.nav_path("Sidebar > Finance > Fee Collection")
    pdf.step("Navigate to Fee Collection.")
    pdf.step("Click 'Generate Fee Structure' button.")
    pdf.step("Select the class(es) to generate fees for.")
    pdf.step("Define fee components: Tuition, Transport, Library, Lab, etc.")
    pdf.step("Set the amount for each component.")
    pdf.step("Choose frequency: Monthly, Quarterly, Annually.")
    pdf.step("Click 'Generate' - fee records are created for all students in selected classes.")

    pdf.section_title("Collecting Fees (Recording Payments)")
    pdf.nav_path("Sidebar > Finance > Fee Collection")
    pdf.step("View the fee collection table showing all students and their payment status.")
    pdf.step("Use the search bar to find a student, or filter by class and payment status.")
    pdf.step("Click on a student's row to open the payment modal.")
    pdf.step("Enter: Amount Paid, Payment Method (Cash/Bank/Cheque/Online), Date, Account to credit.")
    pdf.step("Click 'Record Payment'. The student's balance updates immediately.")
    pdf.step("For bulk collection, select multiple students and use 'Bulk Collect'.")

    pdf.section_title("Managing Discounts & Scholarships")
    pdf.nav_path("Sidebar > Finance > Discounts & Scholarships")
    pdf.step("Click 'Add Discount Rule'.")
    pdf.step("Define: Discount Name, Type (Percentage or Fixed Amount), Value.")
    pdf.step("Set eligibility criteria if applicable.")
    pdf.step("Apply discounts to individual students or in bulk.")
    pdf.step("Discounts automatically adjust the student's fee balance.")

    pdf.section_title("Recording Expenses")
    pdf.nav_path("Sidebar > Finance > Expenses")
    pdf.step("Click 'Add Expense'.")
    pdf.step("Enter: Description, Category, Amount, Date, Account (which account pays).")
    pdf.step("Save. The expense is recorded and the account balance is updated.")
    pdf.step("Use category filters to view expenses by type.")
    pdf.step("Edit or delete expenses as needed.")

    pdf.section_title("Financial Reports")
    pdf.nav_path("Sidebar > Finance > Reports")
    pdf.body_text("Generate comprehensive financial reports:")
    pdf.bullet("Profit & Loss Statement - Revenue vs. expenses breakdown")
    pdf.bullet("Cash Flow Analysis - Money in vs. money out over time")
    pdf.bullet("Fee Collection Report - Class-wise and student-wise collection status")
    pdf.bullet("Expense Report - Category-wise expense breakdown")

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

    # =========================================================================
    # CHAPTER 8: ADMISSIONS CRM
    # =========================================================================
    pdf.chapter_title("Admissions CRM Module")

    pdf.body_text(
        "The Admissions CRM manages the complete student enrollment pipeline from initial enquiry "
        "to final enrollment. It tracks leads, followups, and conversion rates."
    )

    pdf.section_title("Admission Sessions")
    pdf.nav_path("Sidebar > Admissions > Sessions")
    pdf.step("Click 'Add Admission Session' to define an admission window.")
    pdf.step("Enter: Session Name, Start Date, End Date, Intake Capacity per grade.")
    pdf.step("Active sessions determine which grades accept new admissions.")

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
            ["NEW", "Initial enquiry received"],
            ["CONTACTED", "First contact made with parent"],
            ["VISIT_SCHEDULED", "School visit appointment set"],
            ["VISIT_DONE", "Parent/student visited the school"],
            ["FORM_SUBMITTED", "Application form submitted"],
            ["TEST_SCHEDULED", "Entrance test scheduled"],
            ["TEST_DONE", "Entrance test completed"],
            ["OFFERED", "Admission offer extended"],
            ["ACCEPTED", "Parent accepted the offer"],
            ["ENROLLED", "Student officially enrolled"],
        ],
        [50, 140]
    )

    pdf.section_title("Managing Enquiries")
    pdf.sub_section("List View")
    pdf.step("View all enquiries in a searchable, filterable table.")
    pdf.step("Filter by: Stage, Grade, Source, Priority.")
    pdf.step("Click an enquiry to view full details and update its status.")

    pdf.sub_section("Kanban View")
    pdf.step("Switch to Kanban view for a visual pipeline.")
    pdf.step("Drag and drop enquiries between stages.")
    pdf.step("Get a quick overview of where all leads are in the pipeline.")

    pdf.section_title("Followup Management")
    pdf.step("Open an enquiry's detail page.")
    pdf.step("Add followup notes and schedule next followup dates.")
    pdf.step("The dashboard shows today's and overdue followups for quick action.")

    pdf.section_title("Converting Enquiry to Student")
    pdf.step("When an enquiry reaches the 'ENROLLED' stage, click 'Convert to Student'.")
    pdf.step("The system creates a student record from the enquiry data.")
    pdf.step("The student is automatically assigned to the target class.")

    pdf.section_title("Admission Dashboard")
    pdf.nav_path("Sidebar > Admissions > Dashboard")
    pdf.body_text("The dashboard provides analytics:")
    pdf.bullet("Pipeline Funnel Chart - Visual breakdown by stage")
    pdf.bullet("Conversion Rate - Percentage of enquiries that become enrollments")
    pdf.bullet("Source Analysis - Which channels bring the most enquiries")
    pdf.bullet("Today's Followups - Enquiries needing attention today")
    pdf.bullet("Overdue Followups - Past-due followup reminders")

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
        "The LMS module helps teachers create lesson plans, assign homework/projects, "
        "and track student submissions. It integrates with the Academics module."
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
    pdf.step("Click the Notification Bell icon in the top bar for quick view.")
    pdf.step("Or navigate to 'Notifications' in the sidebar for the full Inbox.")
    pdf.step("Unread notifications are highlighted. Click to mark as read.")

    pdf.section_title("Creating Notification Templates (Admin)")
    pdf.nav_path("Sidebar > Notifications > Templates Tab")
    pdf.step("Switch to the 'Templates' tab.")
    pdf.step("Click 'Create Template'.")
    pdf.step("Enter: Template Name, Subject, Body (supports variables like {student_name}).")
    pdf.step("Save. Templates can be reused when sending notifications.")

    pdf.section_title("Sending Notifications (Admin)")
    pdf.nav_path("Sidebar > Notifications > Send Tab")
    pdf.step("Switch to the 'Send' tab.")
    pdf.step("Choose recipients: All Students, All Parents, All Staff, Specific Class, or Individual.")
    pdf.step("Select a template or compose a custom message.")
    pdf.step("Preview the notification.")
    pdf.step("Click 'Send'. Notifications are delivered to all selected recipients.")

    pdf.section_title("Notification Analytics (Admin)")
    pdf.nav_path("Sidebar > Notifications > Analytics Tab")
    pdf.body_text("Track notification effectiveness:")
    pdf.bullet("Delivery Rate - How many notifications were successfully delivered")
    pdf.bullet("Read Rate - Percentage of notifications opened/read")
    pdf.bullet("Breakdown by type and recipient group")

    pdf.section_title("Automated Notifications (Scheduled)")
    pdf.body_text(
        "The system automatically sends scheduled notifications without manual intervention. "
        "These are powered by Celery Beat, a background task scheduler."
    )
    pdf.simple_table(
        ["Notification", "Schedule", "Recipients"],
        [
            ["Fee Reminders", "5th of every month at 9 AM", "Parents with pending fees"],
            ["Overdue Fee Alerts", "Every Monday at 10 AM", "Parents with overdue fees"],
            ["Daily Absence Summary", "Every day at 5 PM", "School administrators"],
            ["Failed Notification Retry", "Every 5 minutes", "System (auto-retries failed sends)"],
            ["Old Upload Cleanup", "Every Sunday at 2 AM", "System (deletes uploads > 90 days)"],
            ["Failed OCR Retry", "Every 6 hours", "System (retries failed OCR jobs)"],
        ],
        [55, 60, 75]
    )
    pdf.info_box("No Action Required", "Automated notifications run on their own once the system is deployed. "
                 "School administrators do not need to trigger them manually. They can be monitored in the "
                 "Notification Analytics tab.")

    # =========================================================================
    # CHAPTER 13: PARENT PORTAL
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
    pdf.nav_path("Parent Portal > Messages")
    pdf.body_text("Parents can send and receive messages from the school administration.")

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
    # CHAPTER 16: MODULE DEPENDENCIES (QUICK REFERENCE)
    # =========================================================================
    pdf.chapter_title("Module Dependencies - Quick Reference")

    pdf.body_text(
        "This chapter provides a quick reference for how modules depend on each other. "
        "Understanding these dependencies helps you set up and use the system efficiently."
    )

    pdf.section_title("Dependency Map")
    pdf.simple_table(
        ["Module / Feature", "Depends On", "Must Be Set Up First"],
        [
            ["Students", "Classes", "Create classes before adding students"],
            ["Attendance", "Classes, Students", "Need classes with students enrolled"],
            ["Subjects", "Classes (for assignment)", "Create classes first"],
            ["Timetable", "Subjects assigned to classes", "Assign subjects to classes"],
            ["Exam Types", "None", "Can be created independently"],
            ["Exams", "Academic Year, Terms, Classes", "Set up sessions and classes"],
            ["Marks Entry", "Exams, Subject Assignments", "Create exam and assign subjects"],
            ["Results", "Marks entered", "Enter all marks for the exam"],
            ["Report Cards", "Results published", "Publish exam results first"],
            ["Grade Scale", "None", "Create before entering marks"],
            ["Fee Structures", "Classes, Students", "Need students in classes"],
            ["Fee Collection", "Fee Structures, Accounts", "Generate fees, set up accounts"],
            ["Expenses", "Finance Accounts", "Create accounts first"],
            ["Payroll", "Staff, Salary Structures", "Add staff and define salaries"],
            ["Leave Mgmt", "Staff Members", "Add staff first"],
            ["Admissions", "Admission Sessions", "Create admission session"],
            ["Transport Assign.", "Routes, Vehicles, Students", "Set up routes and vehicles"],
            ["Library Issues", "Books in Catalog, Students", "Add books and students"],
            ["Hostel Allocation", "Hostels, Rooms, Students", "Create hostels and rooms first"],
            ["Gate Passes", "Hostel Allocations", "Allocate students to rooms first"],
            ["LMS Lessons", "Subjects assigned to classes", "Assign subjects first"],
            ["Assignments", "Classes, Subjects", "Create classes and subjects"],
            ["Notifications", "Users exist", "Create user accounts"],
            ["Promotion", "Academic Years, Classes", "Need source and target setup"],
        ],
        [40, 55, 95]
    )

    pdf.section_title("Recommended Setup Order (Complete)")
    pdf.body_text("Follow this complete order when setting up your school:")
    pdf.step("Create Academic Year and Terms")
    pdf.step("Create Classes (all grades and sections)")
    pdf.step("Add Students (individual or bulk import)")
    pdf.step("Create Subjects")
    pdf.step("Assign Subjects to Classes with Teachers")
    pdf.step("Create Timetable for each class")
    pdf.step("Define Grade Scale")
    pdf.step("Set up Finance Accounts (Cash, Bank)")
    pdf.step("Generate Fee Structures")
    pdf.step("Create HR Departments and Designations")
    pdf.step("Add Staff Members")
    pdf.step("Define Salary Structures")
    pdf.step("Set up Transport Routes and Vehicles")
    pdf.step("Set up Library Categories and Books")
    pdf.step("Set up Hostels and Rooms (if using Hostel module)")
    pdf.step("Configure Attendance Settings (Mappings)")
    pdf.step("Create Notification Templates")
    pdf.step("Set up Admission Sessions (if using Admissions CRM)")
    pdf.info_box("After Setup", "Once the initial setup is complete, daily operations include: "
                 "capturing attendance, collecting fees, recording expenses, entering marks, "
                 "managing transport attendance, issuing library books, and processing admissions.")

    # =========================================================================
    # CHAPTER 18: DAILY OPERATIONS WORKFLOW
    # =========================================================================
    pdf.chapter_title("Daily Operations Workflow")

    pdf.body_text(
        "Once the system is fully set up, here is a guide to the typical daily, weekly, "
        "monthly, and term-based operations."
    )

    pdf.section_title("Daily Tasks")
    pdf.simple_table(
        ["Task", "Who", "Module", "Navigation"],
        [
            ["Mark student attendance", "Teacher", "Attendance", "Attendance > Upload"],
            ["Review AI-captured attendance", "Admin", "Attendance", "Attendance > Review"],
            ["Record fee payments", "Admin/Staff", "Finance", "Finance > Fees"],
            ["Mark staff attendance", "HR", "HR", "HR > Attendance"],
            ["Mark transport attendance", "Transport", "Transport", "Transport > Attendance"],
            ["Issue/Return library books", "Librarian", "Library", "Library > Issues"],
            ["Review gate pass requests", "Hostel Warden", "Hostel", "Hostel > Gate Passes"],
            ["Check notifications", "All", "Notifications", "Bell icon / Inbox"],
            ["Follow up on admissions", "Admin", "Admissions", "Admissions > Enquiries"],
        ],
        [45, 30, 35, 80]
    )

    pdf.section_title("Weekly Tasks")
    pdf.bullet("Review attendance analytics and identify students with low attendance")
    pdf.bullet("Check overdue library books and send reminders")
    pdf.bullet("Review hostel occupancy and pending gate passes")
    pdf.bullet("Review and update admission pipeline")
    pdf.bullet("Process leave applications")

    pdf.section_title("Monthly Tasks")
    pdf.bullet("Generate and process staff payroll")
    pdf.bullet("Close financial month in Settings")
    pdf.bullet("Review financial reports (P&L, cash flow)")
    pdf.bullet("Generate fee reminders for unpaid balances")
    pdf.bullet("Review staff performance (if applicable)")

    pdf.section_title("Term / Semester Tasks")
    pdf.bullet("Create exams for the term")
    pdf.bullet("Enter marks after exams are conducted")
    pdf.bullet("Publish results")
    pdf.bullet("Generate and distribute report cards")
    pdf.bullet("Conduct student promotions (end of year)")
    pdf.bullet("Set up the new academic year and terms")

    # =========================================================================
    # APPENDIX: KEYBOARD SHORTCUTS & TIPS
    # =========================================================================
    pdf.chapter_title("Tips & Best Practices")

    pdf.section_title("Data Entry Tips")
    pdf.bullet("Use bulk import (Excel) for students when starting with a large number of records")
    pdf.bullet("Use the search and filter features to quickly find records in any list")
    pdf.bullet("Export data regularly as backups (Excel, PDF)")

    pdf.section_title("Attendance Tips")
    pdf.bullet("Take clear, well-lit photos of attendance registers for best AI OCR results")
    pdf.bullet("Ensure the register is flat and not crumpled when photographing")
    pdf.bullet("Use the crop tool to focus on the data area only")
    pdf.bullet("Always review AI-extracted data before approving")

    pdf.section_title("Finance Tips")
    pdf.bullet("Set up accounts before the start of the academic year")
    pdf.bullet("Close months regularly to maintain accurate records")
    pdf.bullet("Use discounts/scholarships feature instead of manual fee adjustments")
    pdf.bullet("Generate financial reports monthly for oversight")

    pdf.section_title("Security Tips")
    pdf.bullet("Use strong, unique passwords for each user account")
    pdf.bullet("Log out when leaving the computer unattended")
    pdf.bullet("Only School Admins should manage modules and user permissions")
    pdf.bullet("Regularly review user access and deactivate unused accounts")

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


if __name__ == "__main__":
    build_guide()
