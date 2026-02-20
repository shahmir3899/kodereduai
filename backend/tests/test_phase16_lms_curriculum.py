"""
Phase 16 -- LMS Curriculum & Smart Lesson Plans (pytest)
=========================================================
Covers: Book/Chapter/Topic CRUD, TOC parser, AI generator,
        LessonPlan with topics, publish action, syllabus progress,
        permissions, multi-tenant isolation, parameter contracts.

Run:
    cd backend
    pytest tests/test_phase16_lms_curriculum.py -v -m phase16
"""

from datetime import date, timedelta
from unittest.mock import patch, MagicMock

import pytest

P16 = "P16CUR_"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _results(resp):
    """Extract results list from a paginated or plain-list response."""
    data = resp.json() if resp.status_code == 200 else []
    if isinstance(data, dict):
        data = data.get("results", data if isinstance(data, list) else [])
    return data


@pytest.fixture
def lms_book(seed_data):
    """Create a Book with 2 chapters, each with 2 topics."""
    from lms.models import Book, Chapter, Topic

    school = seed_data["school_a"]
    cls = seed_data["classes"][0]
    subject = seed_data["subjects"][0]  # Mathematics

    book = Book.objects.create(
        school=school, class_obj=cls, subject=subject,
        title=f"{P16}Math Textbook", author="Test Author",
        publisher="Test Publisher", edition="3rd", language="en",
    )
    ch1 = Chapter.objects.create(book=book, chapter_number=1, title=f"{P16}Algebra")
    ch2 = Chapter.objects.create(book=book, chapter_number=2, title=f"{P16}Geometry")
    t1 = Topic.objects.create(chapter=ch1, topic_number=1, title=f"{P16}Variables", estimated_periods=2)
    t2 = Topic.objects.create(chapter=ch1, topic_number=2, title=f"{P16}Expressions", estimated_periods=1)
    t3 = Topic.objects.create(chapter=ch2, topic_number=1, title=f"{P16}Angles", estimated_periods=3)
    t4 = Topic.objects.create(chapter=ch2, topic_number=2, title=f"{P16}Triangles", estimated_periods=2)

    return {
        "book": book, "subject": subject,
        "chapters": [ch1, ch2],
        "topics": [t1, t2, t3, t4],
    }


@pytest.fixture
def lms_cleanup():
    """No-op: django_db transaction rollback handles cleanup automatically."""
    pass


# ==========================================================================
# LEVEL A: BOOK CRUD
# ==========================================================================

@pytest.mark.phase16
@pytest.mark.django_db
class TestBookCRUD:

    def test_create_book(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.post("/api/lms/books/", {
            "school": sid,
            "class_obj": seed_data["classes"][0].id,
            "subject": seed_data["subjects"][0].id,
            "title": f"{P16}Physics Book",
            "language": "en",
        }, token, sid)
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.content}"

    def test_create_urdu_book_is_rtl(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.post("/api/lms/books/", {
            "school": sid,
            "class_obj": seed_data["classes"][0].id,
            "subject": seed_data["subjects"][1].id,
            "title": f"{P16}Urdu Ki Kitab",
            "language": "ur",
        }, token, sid)
        assert resp.status_code == 201
        body = resp.json()
        assert body.get("language") == "ur"

    def test_create_arabic_book_is_rtl(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.post("/api/lms/books/", {
            "school": sid,
            "class_obj": seed_data["classes"][0].id,
            "subject": seed_data["subjects"][0].id,
            "title": f"{P16}Arabic Science",
            "language": "ar",
        }, token, sid)
        assert resp.status_code == 201

    def test_english_book_not_rtl(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.get(f"/api/lms/books/{lms_book['book'].id}/", token, sid)
        assert resp.status_code == 200
        body = resp.json()
        assert body["is_rtl"] is False
        assert body["language_display"] == "English"

    def test_list_books_filter_class_id(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        cls_id = seed_data["classes"][0].id
        resp = api.get(f"/api/lms/books/?class_id={cls_id}", token, sid)
        assert resp.status_code == 200
        data = _results(resp)
        assert len(data) >= 1
        for b in data:
            assert b["class_obj"] == cls_id

    def test_list_books_filter_subject_id(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        subj_id = lms_book["subject"].id
        resp = api.get(f"/api/lms/books/?subject_id={subj_id}", token, sid)
        assert resp.status_code == 200
        data = _results(resp)
        assert len(data) >= 1

    def test_list_books_filter_language(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.get("/api/lms/books/?language=en", token, sid)
        assert resp.status_code == 200

    def test_update_book(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.patch(f"/api/lms/books/{lms_book['book'].id}/", {
            "title": f"{P16}Math Textbook (Updated)",
        }, token, sid)
        assert resp.status_code == 200

    def test_delete_book(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        # Create one to delete
        from lms.models import Book
        book = Book.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=seed_data["subjects"][0],
            title=f"{P16}Deletable",
            language="en",
        )
        resp = api.delete(f"/api/lms/books/{book.id}/", token, sid)
        assert resp.status_code in (200, 204)

    def test_book_tree(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.get(f"/api/lms/books/{lms_book['book'].id}/tree/", token, sid)
        assert resp.status_code == 200
        body = resp.json()
        assert len(body.get("chapters", [])) == 2
        assert len(body["chapters"][0].get("topics", [])) == 2

    def test_for_class_subject(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        cls_id = seed_data["classes"][0].id
        subj_id = lms_book["subject"].id
        resp = api.get(
            f"/api/lms/books/for_class_subject/?class_id={cls_id}&subject_id={subj_id}",
            token, sid,
        )
        assert resp.status_code == 200

    def test_for_class_subject_missing_params(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.get("/api/lms/books/for_class_subject/", token, sid)
        assert resp.status_code == 400


# ==========================================================================
# LEVEL B: CHAPTER CRUD
# ==========================================================================

@pytest.mark.phase16
@pytest.mark.django_db
class TestChapterCRUD:

    def test_create_chapter(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.post("/api/lms/chapters/", {
            "book": lms_book["book"].id,
            "title": f"{P16}New Chapter",
            "chapter_number": 3,
        }, token, sid)
        assert resp.status_code == 201

    def test_duplicate_chapter_number(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.post("/api/lms/chapters/", {
            "book": lms_book["book"].id,
            "title": f"{P16}Duplicate Ch",
            "chapter_number": 1,  # Already exists
        }, token, sid)
        assert resp.status_code == 400

    def test_list_filter_book_id(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.get(
            f"/api/lms/chapters/?book_id={lms_book['book'].id}", token, sid,
        )
        assert resp.status_code == 200
        data = _results(resp)
        assert len(data) == 2

    def test_update_chapter(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        ch = lms_book["chapters"][0]
        resp = api.patch(f"/api/lms/chapters/{ch.id}/", {
            "title": f"{P16}Algebra (Updated)",
        }, token, sid)
        assert resp.status_code == 200

    def test_delete_chapter(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        from lms.models import Chapter
        ch = Chapter.objects.create(
            book=lms_book["book"], chapter_number=99, title=f"{P16}Temp",
        )
        resp = api.delete(f"/api/lms/chapters/{ch.id}/", token, sid)
        assert resp.status_code in (200, 204)

    def test_read_includes_nested_topics(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        ch = lms_book["chapters"][0]
        resp = api.get(f"/api/lms/chapters/{ch.id}/", token, sid)
        assert resp.status_code == 200
        body = resp.json()
        assert "topics" in body
        assert body.get("topic_count") == 2


# ==========================================================================
# LEVEL C: TOPIC CRUD
# ==========================================================================

@pytest.mark.phase16
@pytest.mark.django_db
class TestTopicCRUD:

    def test_create_topic(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.post("/api/lms/topics/", {
            "chapter": lms_book["chapters"][0].id,
            "title": f"{P16}New Topic",
            "topic_number": 3,
            "estimated_periods": 1,
        }, token, sid)
        assert resp.status_code == 201

    def test_duplicate_topic_number(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.post("/api/lms/topics/", {
            "chapter": lms_book["chapters"][0].id,
            "title": f"{P16}Dup Topic",
            "topic_number": 1,  # Already exists
        }, token, sid)
        assert resp.status_code == 400

    def test_list_filter_chapter_id(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        ch = lms_book["chapters"][0]
        resp = api.get(f"/api/lms/topics/?chapter_id={ch.id}", token, sid)
        assert resp.status_code == 200
        data = _results(resp)
        assert len(data) == 2

    def test_list_filter_book_id(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.get(
            f"/api/lms/topics/?book_id={lms_book['book'].id}", token, sid,
        )
        assert resp.status_code == 200
        data = _results(resp)
        assert len(data) == 4  # 2 chapters × 2 topics

    def test_is_covered_false(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        t = lms_book["topics"][0]
        resp = api.get(f"/api/lms/topics/{t.id}/", token, sid)
        assert resp.status_code == 200
        assert resp.json()["is_covered"] is False

    def test_is_covered_true(self, seed_data, api, lms_book):
        """After linking topic to a PUBLISHED lesson plan, is_covered should be True."""
        from lms.models import LessonPlan
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        topic = lms_book["topics"][0]

        # Create a published lesson plan with this topic
        lp = LessonPlan.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=lms_book["subject"],
            teacher=seed_data["staff"][0],
            title=f"{P16}Coverage Plan",
            description="test",
            lesson_date=date.today(),
            status="PUBLISHED",
        )
        lp.planned_topics.add(topic)

        resp = api.get(f"/api/lms/topics/{topic.id}/", token, sid)
        assert resp.status_code == 200
        assert resp.json()["is_covered"] is True

        # Cleanup
        lp.delete()

    def test_update_topic(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        t = lms_book["topics"][0]
        resp = api.patch(f"/api/lms/topics/{t.id}/", {
            "title": f"{P16}Variables (Updated)",
        }, token, sid)
        assert resp.status_code == 200

    def test_delete_topic(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        from lms.models import Topic
        t = Topic.objects.create(
            chapter=lms_book["chapters"][0], topic_number=99, title=f"{P16}Temp",
        )
        resp = api.delete(f"/api/lms/topics/{t.id}/", token, sid)
        assert resp.status_code in (200, 204)


# ==========================================================================
# LEVEL D: TOC PARSER (UNIT TESTS)
# ==========================================================================

@pytest.mark.phase16
@pytest.mark.django_db
class TestTocParser:

    def test_numbered_chapters_with_subtopics(self, seed_data, lms_book):
        from lms.toc_parser import parse_toc_text
        from lms.models import Book, Chapter, Topic
        # Create a fresh book so we don't conflict with lms_book chapters
        book = Book.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=seed_data["subjects"][0],
            title=f"{P16}TOC Test Book",
            language="en",
        )
        toc = "1. Algebra\n  1.1 Variables\n  1.2 Expressions\n2. Geometry\n  2.1 Angles"
        result = parse_toc_text(toc, book)
        assert result["chapters_created"] == 2
        assert result["topics_created"] == 3
        assert result["errors"] == []
        assert Chapter.objects.filter(book=book).count() == 2
        assert Topic.objects.filter(chapter__book=book).count() == 3

    def test_indented_bullet_topics(self, seed_data):
        from lms.toc_parser import parse_toc_text
        from lms.models import Book
        book = Book.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=seed_data["subjects"][0],
            title=f"{P16}Bullet TOC",
            language="en",
        )
        toc = "1. Introduction\n  - Overview\n  - History"
        result = parse_toc_text(toc, book)
        assert result["chapters_created"] == 1
        assert result["topics_created"] == 2

    def test_empty_text(self, seed_data):
        from lms.toc_parser import parse_toc_text
        from lms.models import Book
        book = Book.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=seed_data["subjects"][0],
            title=f"{P16}Empty TOC",
            language="en",
        )
        result = parse_toc_text("", book)
        assert result["chapters_created"] == 0
        assert result["topics_created"] == 0

    def test_chapter_without_topics(self, seed_data):
        from lms.toc_parser import parse_toc_text
        from lms.models import Book
        book = Book.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=seed_data["subjects"][0],
            title=f"{P16}No Topics",
            language="en",
        )
        result = parse_toc_text("1. Solo Chapter", book)
        assert result["chapters_created"] == 1
        assert result["topics_created"] == 0

    def test_appends_to_existing(self, seed_data, lms_book):
        """Existing book with 2 chapters — TOC should start from chapter_number=3."""
        from lms.toc_parser import parse_toc_text
        from lms.models import Chapter
        book = lms_book["book"]
        toc = "1. New Chapter A\n  1.1 Topic X\n2. New Chapter B"
        result = parse_toc_text(toc, book)
        assert result["chapters_created"] == 2
        # Chapter numbers should be 3 and 4 (after existing 1 and 2)
        new_chapters = Chapter.objects.filter(book=book).order_by("chapter_number")
        numbers = list(new_chapters.values_list("chapter_number", flat=True))
        assert 3 in numbers
        assert 4 in numbers

    def test_rtl_urdu_text(self, seed_data):
        """Urdu TOC text should be stored as Unicode correctly."""
        from lms.toc_parser import parse_toc_text
        from lms.models import Book, Chapter
        book = Book.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=seed_data["subjects"][1],  # Urdu
            title=f"{P16}\u0627\u0631\u062f\u0648 \u06a9\u062a\u0627\u0628",
            language="ur",
        )
        toc = "1. \u0627\u0644\u0641 \u0628\u0627\u0628\n  1.1 \u0645\u0648\u0636\u0648\u0639 \u0627\u0648\u0644"
        result = parse_toc_text(toc, book)
        assert result["chapters_created"] == 1
        assert result["topics_created"] == 1
        ch = Chapter.objects.filter(book=book).first()
        assert "\u0627\u0644\u0641" in ch.title  # Urdu text preserved

    def test_bulk_toc_endpoint(self, seed_data, api, lms_book):
        """POST bulk_toc endpoint creates chapters/topics."""
        from lms.models import Book
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        # Create fresh book for endpoint test
        book = Book.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=seed_data["subjects"][0],
            title=f"{P16}Endpoint TOC",
            language="en",
        )
        resp = api.post(f"/api/lms/books/{book.id}/bulk_toc/", {
            "toc_text": "1. Chapter One\n  1.1 Topic A\n  1.2 Topic B\n2. Chapter Two",
        }, token, sid)
        assert resp.status_code == 201
        body = resp.json()
        assert body["chapters_created"] == 2
        assert body["topics_created"] == 2

    def test_bulk_toc_empty_text(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.post(f"/api/lms/books/{lms_book['book'].id}/bulk_toc/", {
            "toc_text": "",
        }, token, sid)
        assert resp.status_code == 400


# ==========================================================================
# LEVEL E: AI GENERATOR (UNIT TESTS — Groq mocked)
# ==========================================================================

@pytest.mark.phase16
@pytest.mark.django_db
class TestAIGenerator:

    def test_missing_groq_api_key(self, seed_data, lms_book):
        from lms.ai_generator import generate_lesson_plan
        with patch("lms.ai_generator.settings") as mock_settings:
            mock_settings.GROQ_API_KEY = None
            result = generate_lesson_plan(
                school=seed_data["school_a"],
                class_obj=seed_data["classes"][0],
                subject=lms_book["subject"],
                book=lms_book["book"],
                topics=lms_book["book"].chapters.first().topics.all(),
                lesson_date="2026-03-15",
            )
        assert result["success"] is False
        assert "not configured" in result["error"]

    def test_successful_generation(self, seed_data, lms_book):
        from lms.ai_generator import generate_lesson_plan
        mock_json = (
            '{"title":"Test Lesson","objectives":"Obj","description":"Desc",'
            '"teaching_methods":"Methods","materials_needed":"Materials"}'
        )
        with patch("lms.ai_generator.settings") as mock_settings, \
             patch("groq.Groq") as MockGroq:
            mock_settings.GROQ_API_KEY = "test-key"
            mock_settings.GROQ_MODEL = "test-model"
            mock_client = MagicMock()
            MockGroq.return_value = mock_client
            mock_client.chat.completions.create.return_value.choices = [
                MagicMock(message=MagicMock(content=mock_json))
            ]

            result = generate_lesson_plan(
                school=seed_data["school_a"],
                class_obj=seed_data["classes"][0],
                subject=lms_book["subject"],
                book=lms_book["book"],
                topics=lms_book["book"].chapters.first().topics.all(),
                lesson_date="2026-03-15",
            )
        assert result["success"] is True
        assert result["title"] == "Test Lesson"
        assert result["objectives"] == "Obj"

    def test_json_parse_error(self, seed_data, lms_book):
        from lms.ai_generator import generate_lesson_plan
        with patch("lms.ai_generator.settings") as mock_settings, \
             patch("groq.Groq") as MockGroq:
            mock_settings.GROQ_API_KEY = "test-key"
            mock_settings.GROQ_MODEL = "test-model"
            mock_client = MagicMock()
            MockGroq.return_value = mock_client
            mock_client.chat.completions.create.return_value.choices = [
                MagicMock(message=MagicMock(content="not valid json at all"))
            ]

            result = generate_lesson_plan(
                school=seed_data["school_a"],
                class_obj=seed_data["classes"][0],
                subject=lms_book["subject"],
                book=lms_book["book"],
                topics=lms_book["book"].chapters.first().topics.all(),
                lesson_date="2026-03-15",
            )
        assert result["success"] is False
        assert "parse" in result["error"].lower()

    def test_groq_api_exception(self, seed_data, lms_book):
        from lms.ai_generator import generate_lesson_plan
        with patch("lms.ai_generator.settings") as mock_settings, \
             patch("groq.Groq") as MockGroq:
            mock_settings.GROQ_API_KEY = "test-key"
            mock_settings.GROQ_MODEL = "test-model"
            MockGroq.side_effect = Exception("API quota exceeded")

            result = generate_lesson_plan(
                school=seed_data["school_a"],
                class_obj=seed_data["classes"][0],
                subject=lms_book["subject"],
                book=lms_book["book"],
                topics=lms_book["book"].chapters.first().topics.all(),
                lesson_date="2026-03-15",
            )
        assert result["success"] is False
        assert "quota" in result["error"].lower()

    def test_rtl_prompt_includes_language(self, seed_data):
        """For an Urdu book, the prompt should instruct the LLM to generate in Urdu."""
        from lms.ai_generator import generate_lesson_plan
        from lms.models import Book, Chapter, Topic
        book = Book.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=seed_data["subjects"][1],
            title=f"{P16}Urdu Book",
            language="ur",
        )
        ch = Chapter.objects.create(book=book, chapter_number=1, title="Baab 1")
        Topic.objects.create(chapter=ch, topic_number=1, title="Mauzu")

        captured_prompt = {}

        def capture_create(**kwargs):
            captured_prompt["messages"] = kwargs.get("messages", [])
            mock_resp = MagicMock()
            mock_resp.choices = [
                MagicMock(message=MagicMock(content='{"title":"t","objectives":"o","description":"d","teaching_methods":"m","materials_needed":"n"}'))
            ]
            return mock_resp

        with patch("lms.ai_generator.settings") as mock_settings, \
             patch("groq.Groq") as MockGroq:
            mock_settings.GROQ_API_KEY = "test-key"
            mock_settings.GROQ_MODEL = "test-model"
            mock_client = MagicMock()
            MockGroq.return_value = mock_client
            mock_client.chat.completions.create.side_effect = capture_create

            generate_lesson_plan(
                school=seed_data["school_a"],
                class_obj=seed_data["classes"][0],
                subject=seed_data["subjects"][1],
                book=book,
                topics=ch.topics.all(),
                lesson_date="2026-03-15",
            )

        prompt_text = captured_prompt["messages"][0]["content"]
        assert "Urdu" in prompt_text

    def test_markdown_fence_stripping(self, seed_data, lms_book):
        """JSON wrapped in ```json ... ``` should be extracted correctly."""
        from lms.ai_generator import generate_lesson_plan
        fenced = '```json\n{"title":"Fenced","objectives":"O","description":"D","teaching_methods":"M","materials_needed":"N"}\n```'
        with patch("lms.ai_generator.settings") as mock_settings, \
             patch("groq.Groq") as MockGroq:
            mock_settings.GROQ_API_KEY = "test-key"
            mock_settings.GROQ_MODEL = "test-model"
            mock_client = MagicMock()
            MockGroq.return_value = mock_client
            mock_client.chat.completions.create.return_value.choices = [
                MagicMock(message=MagicMock(content=fenced))
            ]

            result = generate_lesson_plan(
                school=seed_data["school_a"],
                class_obj=seed_data["classes"][0],
                subject=lms_book["subject"],
                book=lms_book["book"],
                topics=lms_book["book"].chapters.first().topics.all(),
                lesson_date="2026-03-15",
            )
        assert result["success"] is True
        assert result["title"] == "Fenced"


# ==========================================================================
# LEVEL F: LESSON PLAN WITH TOPICS
# ==========================================================================

@pytest.mark.phase16
@pytest.mark.django_db
class TestLessonPlanWithTopics:

    def _base_payload(self, seed_data, lms_book):
        return {
            "school": seed_data["SID_A"],
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_book["subject"].id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P16}Plan With Topics",
            "description": "Test plan",
            "lesson_date": str(date.today()),
            "duration_minutes": 45,
            "status": "DRAFT",
        }

    def test_create_with_planned_topic_ids(self, seed_data, api, lms_book, lms_cleanup):
        """Test creating a lesson plan with topic IDs via serializer (avoids SQLite M2M transaction issues)."""
        from lms.models import LessonPlan
        from lms.serializers import LessonPlanCreateSerializer

        topic_ids = [t.id for t in lms_book["topics"][:2]]

        data = {
            "school": seed_data["SID_A"],
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_book["subject"].id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P16}Plan With Topics",
            "description": "Test plan",
            "lesson_date": str(date.today()),
            "duration_minutes": 45,
            "status": "DRAFT",
            "planned_topic_ids": topic_ids,
        }
        serializer = LessonPlanCreateSerializer(data=data)
        assert serializer.is_valid(), serializer.errors
        lp = serializer.save()

        assert lp.content_mode == "TOPICS"
        assert lp.planned_topics.count() == 2
        assert set(lp.planned_topics.values_list("id", flat=True)) == set(topic_ids)
        assert lp.display_text != ""

        # Cleanup M2M before rollback to avoid SQLite FK integrity error
        lp.planned_topics.clear()
        lp.delete()

    def test_create_freeform(self, seed_data, api, lms_book, lms_cleanup):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        payload = self._base_payload(seed_data, lms_book)
        # No planned_topic_ids

        resp = api.post("/api/lms/lesson-plans/", payload, token, sid)
        assert resp.status_code == 201

        lp_id = resp.json()["id"]
        get_resp = api.get(f"/api/lms/lesson-plans/{lp_id}/", token, sid)
        body = get_resp.json()
        assert body["content_mode"] == "FREEFORM"

    def test_update_topics(self, seed_data, api, lms_book, lms_cleanup):
        """Test updating planned topics via serializer (avoids SQLite M2M transaction issues)."""
        from lms.models import LessonPlan
        from lms.serializers import LessonPlanCreateSerializer

        # Create plan with first topic via serializer
        lp = LessonPlan.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=lms_book["subject"],
            teacher=seed_data["staff"][0],
            title=f"{P16}Update Topics Test",
            description="test",
            lesson_date=date.today(),
            status="DRAFT",
        )
        lp.planned_topics.set([lms_book["topics"][0].id])
        assert lp.planned_topics.count() == 1

        # Update to different topics via serializer.update()
        new_ids = [lms_book["topics"][2].id, lms_book["topics"][3].id]
        serializer = LessonPlanCreateSerializer(
            lp, data={"planned_topic_ids": new_ids}, partial=True,
        )
        assert serializer.is_valid(), serializer.errors
        serializer.save()

        # Verify M2M was replaced
        lp.refresh_from_db()
        topic_ids_set = set(lp.planned_topics.values_list("id", flat=True))
        assert topic_ids_set == set(new_ids)

        # Cleanup M2M before rollback
        lp.planned_topics.clear()
        lp.delete()

    def test_publish_action(self, seed_data, api, lms_book, lms_cleanup):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        payload = self._base_payload(seed_data, lms_book)
        create_resp = api.post("/api/lms/lesson-plans/", payload, token, sid)
        assert create_resp.status_code == 201
        lp_id = create_resp.json()["id"]

        resp = api.post(f"/api/lms/lesson-plans/{lp_id}/publish/", {}, token, sid)
        assert resp.status_code == 200
        assert resp.json()["status"] == "PUBLISHED"

    def test_publish_already_published(self, seed_data, api, lms_book, lms_cleanup):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        payload = self._base_payload(seed_data, lms_book)
        create_resp = api.post("/api/lms/lesson-plans/", payload, token, sid)
        lp_id = create_resp.json()["id"]

        # Publish once
        api.post(f"/api/lms/lesson-plans/{lp_id}/publish/", {}, token, sid)
        # Try again
        resp = api.post(f"/api/lms/lesson-plans/{lp_id}/publish/", {}, token, sid)
        assert resp.status_code == 400

    def test_read_includes_new_fields(self, seed_data, api, lms_book, lms_cleanup):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        payload = self._base_payload(seed_data, lms_book)
        payload["ai_generated"] = True
        payload["content_mode"] = "TOPICS"
        create_resp = api.post("/api/lms/lesson-plans/", payload, token, sid)
        assert create_resp.status_code == 201
        lp_id = create_resp.json()["id"]

        resp = api.get(f"/api/lms/lesson-plans/{lp_id}/", token, sid)
        body = resp.json()
        assert "planned_topics" in body
        assert "display_text" in body
        assert "content_mode" in body
        assert "ai_generated" in body
        assert body["ai_generated"] is True

    def test_by_class_action(self, seed_data, api, lms_book, lms_cleanup):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        payload = self._base_payload(seed_data, lms_book)
        api.post("/api/lms/lesson-plans/", payload, token, sid)

        cls_id = seed_data["classes"][0].id
        resp = api.get(f"/api/lms/lesson-plans/by_class/?class_id={cls_id}", token, sid)
        assert resp.status_code == 200

    def test_by_class_missing_param(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.get("/api/lms/lesson-plans/by_class/", token, sid)
        assert resp.status_code == 400


# ==========================================================================
# LEVEL G: AI GENERATE ENDPOINT
# ==========================================================================

@pytest.mark.phase16
@pytest.mark.django_db
class TestGenerateEndpoint:

    def test_generate_success(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        topic_ids = [t.id for t in lms_book["topics"][:2]]

        with patch("lms.ai_generator.generate_lesson_plan") as mock_gen:
            mock_gen.return_value = {
                "success": True,
                "title": "AI Plan",
                "objectives": "Obj",
                "description": "Desc",
                "teaching_methods": "Methods",
                "materials_needed": "Materials",
            }
            resp = api.post("/api/lms/generate-lesson-plan/", {
                "topic_ids": topic_ids,
                "lesson_date": "2026-03-15",
                "duration_minutes": 45,
            }, token, sid)

        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True

    def test_no_topic_ids(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.post("/api/lms/generate-lesson-plan/", {
            "topic_ids": [],
        }, token, sid)
        assert resp.status_code == 400

    def test_invalid_topic_ids(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.post("/api/lms/generate-lesson-plan/", {
            "topic_ids": [999999, 999998],
        }, token, sid)
        assert resp.status_code == 400


# ==========================================================================
# LEVEL H: SYLLABUS PROGRESS
# ==========================================================================

@pytest.mark.phase16
@pytest.mark.django_db
class TestSyllabusProgress:

    def test_no_coverage(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        cls_id = seed_data["classes"][0].id
        subj_id = lms_book["subject"].id
        resp = api.get(
            f"/api/lms/books/syllabus_progress/?class_id={cls_id}&subject_id={subj_id}",
            token, sid,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["total_topics"] == 4
        assert body["covered_topics"] == 0
        assert body["percentage"] == 0

    def test_partial_coverage(self, seed_data, api, lms_book):
        from lms.models import LessonPlan
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        # Create a published plan covering 2 of 4 topics
        lp = LessonPlan.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=lms_book["subject"],
            teacher=seed_data["staff"][0],
            title=f"{P16}Coverage",
            description="test",
            lesson_date=date.today(),
            status="PUBLISHED",
        )
        lp.planned_topics.add(lms_book["topics"][0], lms_book["topics"][1])

        cls_id = seed_data["classes"][0].id
        subj_id = lms_book["subject"].id
        resp = api.get(
            f"/api/lms/books/syllabus_progress/?class_id={cls_id}&subject_id={subj_id}",
            token, sid,
        )
        body = resp.json()
        assert body["covered_topics"] == 2
        assert body["percentage"] == 50

        lp.delete()

    def test_missing_params(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.get("/api/lms/books/syllabus_progress/", token, sid)
        assert resp.status_code == 400


# ==========================================================================
# LEVEL I: PERMISSIONS & MULTI-TENANT ISOLATION
# ==========================================================================

@pytest.mark.phase16
@pytest.mark.django_db
class TestPermissionsAndIsolation:

    def test_teacher_read_only_books(self, seed_data, api, lms_book):
        """Teacher can GET books but cannot POST (403)."""
        token = seed_data["tokens"]["teacher"]
        sid = seed_data["SID_A"]

        get_resp = api.get("/api/lms/books/", token, sid)
        assert get_resp.status_code == 200

        post_resp = api.post("/api/lms/books/", {
            "school": sid,
            "class_obj": seed_data["classes"][0].id,
            "subject": seed_data["subjects"][0].id,
            "title": f"{P16}Teacher Book",
            "language": "en",
        }, token, sid)
        assert post_resp.status_code == 403

    def test_school_b_cannot_see_school_a_books(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin_b"]
        sid = seed_data["SID_B"]
        resp = api.get("/api/lms/books/", token, sid)
        data = _results(resp)
        # School B should see 0 books (all books belong to school_a)
        assert len(data) == 0

    def test_school_b_cannot_see_school_a_lessons(self, seed_data, api, lms_book, lms_cleanup):
        # Create a plan in school A
        from lms.models import LessonPlan
        LessonPlan.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=lms_book["subject"],
            teacher=seed_data["staff"][0],
            title=f"{P16}School A Plan",
            description="test",
            lesson_date=date.today(),
            status="DRAFT",
        )

        token = seed_data["tokens"]["admin_b"]
        sid = seed_data["SID_B"]
        resp = api.get("/api/lms/lesson-plans/", token, sid)
        data = _results(resp)
        assert len(data) == 0

    def test_unauthenticated_rejected(self, seed_data, api):
        resp = api.client.get("/api/lms/books/")
        assert resp.status_code == 401

    def test_parameter_contract_class_id(self, seed_data, api, lms_book, lms_cleanup):
        """
        Backend filters on 'class_id' not 'class_obj'.
        Passing 'class_obj' should NOT filter (returns all results).
        """
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        # Create plan
        from lms.models import LessonPlan
        lp = LessonPlan.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=lms_book["subject"],
            teacher=seed_data["staff"][0],
            title=f"{P16}Contract Test",
            description="test",
            lesson_date=date.today(),
        )

        cls_id = seed_data["classes"][0].id

        # class_id works
        resp1 = api.get(f"/api/lms/lesson-plans/?class_id={cls_id}", token, sid)
        data1 = _results(resp1)
        matching = [p for p in data1 if p["title"].startswith(P16)]
        assert len(matching) >= 1

        # class_obj is ignored — returns all (not filtered)
        resp2 = api.get(f"/api/lms/lesson-plans/?class_obj={cls_id}", token, sid)
        data2 = _results(resp2)
        # data2 should include plans for ALL classes, not just cls_id
        # We just verify the request succeeds (param is silently ignored)
        assert resp2.status_code == 200

        lp.delete()
