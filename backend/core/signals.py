"""
Cache invalidation groups for core/schools read endpoints that aggregate across
apps (leadership insights, SuperAdmin platform/demo stats). Registered from
CoreConfig.ready so every model is loaded. bulk_create()/queryset.update()
don't fire signals; the endpoints' TTLs cover those paths.
"""
from core.cache_utils import invalidate_group_on_change


def register():
    from academic_sessions.models import AcademicYear, SessionClass, StudentEnrollment
    from attendance.models import AttendanceUpload
    from brochure.models import DemoRequest
    from core.models import LoginEvent
    from examinations.models import Question
    from hr.models import StaffMember
    from lms.models import Book, LessonPlan, Topic
    from schools.models import School
    from students.models import Class as SchoolClass, Student
    from users.models import User

    invalidate_group_on_change(
        'leadership_insights',
        School, AcademicYear, SessionClass, StudentEnrollment, Student, SchoolClass,
        StaffMember, Book, Topic, LessonPlan, Question,
    )
    invalidate_group_on_change('platform_stats', School, Student, User, AttendanceUpload)
    invalidate_group_on_change('demo_insights', DemoRequest, LoginEvent)
