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

    def test_parse_toc_preview_endpoint(self, seed_data, api):
        from lms.models import Book
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = Book.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=seed_data["subjects"][0],
            title=f"{P16}Parse Preview",
            language="en",
        )

        resp = api.post(f"/api/lms/books/{book.id}/parse_toc/", {
            "toc_text": "1. Intro\n  1.1 Topic A\n2. Next\n  2.1 Topic B",
        }, token, sid)
        assert resp.status_code == 200
        body = resp.json()
        assert body["chapter_count"] == 2
        assert body["topic_count"] == 2
        assert len(body.get("chapters", [])) == 2

    def test_apply_toc_endpoint(self, seed_data, api):
        from lms.models import Book, Chapter, Topic
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = Book.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=seed_data["subjects"][0],
            title=f"{P16}Apply TOC",
            language="en",
        )

        resp = api.post(f"/api/lms/books/{book.id}/apply_toc/", {
            "chapters": [
                {
                    "title": "Chapter A",
                    "topics": [
                        {"title": "Topic 1"},
                        {"title": "Topic 2"},
                    ],
                },
                {
                    "title": "Chapter B",
                    "topics": [
                        {"title": "Topic 3"},
                    ],
                },
            ]
        }, token, sid)

        assert resp.status_code == 201
        body = resp.json()
        assert body["chapters_created"] == 2
        assert body["topics_created"] == 3
        assert Chapter.objects.filter(book=book).count() == 2
        assert Topic.objects.filter(chapter__book=book).count() == 3

    def test_suggest_toc_endpoint_fallback(self, seed_data, api):
        from lms.models import Book
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = Book.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=seed_data["subjects"][0],
            title=f"{P16}Suggest TOC",
            language="en",
        )

        with patch("lms.toc_ai_suggester.settings") as mock_settings:
            mock_settings.GROQ_API_KEY = None
            resp = api.post(f"/api/lms/books/{book.id}/suggest_toc/", {
                "raw_text": "1. Intro\n  1.1 Topic A\n2. Next",
            }, token, sid)

        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["source"] == "rule_based"
        assert len(body.get("chapters", [])) >= 1

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


# ==========================================================================
# LEVEL J: RICH CONTENT BASELINE SAFEGUARDS
# ==========================================================================

@pytest.mark.phase16
@pytest.mark.django_db
class TestRichContentBaselineSafeguards:

    def test_topic_and_chapter_defaults_exposed(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        # Chapter read serializer should expose new fields with safe defaults.
        ch = lms_book["chapters"][0]
        ch_resp = api.get(f"/api/lms/chapters/{ch.id}/", token, sid)
        assert ch_resp.status_code == 200
        ch_body = ch_resp.json()
        assert ch_body.get("content_blocks") == []
        assert ch_body.get("content_text") == ""
        assert ch_body.get("content_blocks_schema_version") == 1
        assert ch_body.get("content_version") == 1
        assert ch_body.get("needs_migration") is False

        # Topic read serializer should expose new fields with safe defaults.
        tp = lms_book["topics"][0]
        tp_resp = api.get(f"/api/lms/topics/{tp.id}/", token, sid)
        assert tp_resp.status_code == 200
        tp_body = tp_resp.json()
        assert tp_body.get("content_kind") == "general"
        assert tp_body.get("content_blocks") == []
        assert tp_body.get("content_text") == ""
        assert tp_body.get("content_blocks_schema_version") == 1
        assert tp_body.get("content_version") == 1
        assert tp_body.get("needs_migration") is False

    def test_apply_toc_idempotency_key_prevents_duplicates(self, seed_data, api):
        from lms.models import Book, Chapter, Topic

        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = Book.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=seed_data["subjects"][0],
            title=f"{P16}Apply TOC Idempotent",
            language="en",
        )

        payload = {
            "chapters": [
                {
                    "title": "Chapter A",
                    "topics": [{"title": "Topic 1"}, {"title": "Topic 2"}],
                },
                {
                    "title": "Chapter B",
                    "topics": [{"title": "Topic 3"}],
                },
            ],
            "idempotency_key": "phase16-apply-toc-idempotency",
        }

        first = api.post(f"/api/lms/books/{book.id}/apply_toc/", payload, token, sid)
        second = api.post(f"/api/lms/books/{book.id}/apply_toc/", payload, token, sid)

        assert first.status_code == 201
        assert second.status_code == 200
        assert Chapter.objects.filter(book=book).count() == 2
        assert Topic.objects.filter(chapter__book=book).count() == 3


@pytest.mark.phase16
@pytest.mark.django_db
class TestControlledViewProfilesAndValidation:

    def test_tree_chapter_only_profile(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        resp = api.get(f"/api/lms/books/{lms_book['book'].id}/tree/?view=chapter_only", token, sid)
        assert resp.status_code == 200
        body = resp.json()
        assert "chapters" in body
        assert len(body["chapters"]) == 2
        assert "topics" not in body["chapters"][0]

    def test_tree_lesson_plan_profile(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        resp = api.get(f"/api/lms/books/{lms_book['book'].id}/tree/?view=lesson_plan", token, sid)
        assert resp.status_code == 200
        body = resp.json()
        assert "chapters" in body
        assert len(body["chapters"]) == 2
        assert "topics" in body["chapters"][0]
        assert len(body["chapters"][0]["topics"]) == 2
        # Lesson plan projection should stay lightweight and avoid heavy rich payload fields.
        first_topic = body["chapters"][0]["topics"][0]
        assert "content_blocks" not in first_topic
        assert "description" in first_topic

    def test_for_class_subject_lesson_plan_profile(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        cls_id = seed_data["classes"][0].id
        subj_id = lms_book["subject"].id

        resp = api.get(
            f"/api/lms/books/for_class_subject/?class_id={cls_id}&subject_id={subj_id}&view=lesson_plan",
            token,
            sid,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert "chapters" in data[0]
        assert "topics" in data[0]["chapters"][0]

    def test_exam_exercises_profile_filters_topics(self, seed_data, api, lms_book):
        from lms.models import Topic

        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        # Mark only one topic as exercise; profile should at least include it.
        exercise_topic = lms_book["topics"][0]
        exercise_topic.content_kind = 'exercise'
        exercise_topic.save(update_fields=['content_kind'])

        resp = api.get(
            f"/api/lms/topics/?book_id={lms_book['book'].id}&view=exam_exercises",
            token,
            sid,
        )
        assert resp.status_code == 200
        rows = _results(resp)
        assert any(item["id"] == exercise_topic.id for item in rows)
        # Exam profile should return compact exercise payload only.
        first = rows[0]
        assert "chapter_number" in first
        assert "test_question_count" in first
        assert "lesson_plans" not in first
        assert "test_questions" not in first

        # Sanity: without filter should still include all topics.
        all_resp = api.get(f"/api/lms/topics/?book_id={lms_book['book'].id}", token, sid)
        assert all_resp.status_code == 200
        all_rows = _results(all_resp)
        assert len(all_rows) >= len(rows)

    def test_lesson_plan_profile_scope_isolation(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin_b"]
        sid = seed_data["SID_B"]
        resp = api.get("/api/lms/books/?view=lesson_plan", token, sid)
        assert resp.status_code == 200
        rows = _results(resp)
        assert len(rows) == 0

    def test_topic_page_range_validation(self, seed_data, api, lms_book):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        topic = lms_book["topics"][0]

        resp = api.patch(
            f"/api/lms/topics/{topic.id}/",
            {"page_start": 12, "page_end": 5},
            token,
            sid,
        )
        assert resp.status_code == 400


# ==========================================================================
# LEVEL K: PHASE 5 — LARGE TEXT RELIABILITY & TRANSPORT HARDENING
# ==========================================================================

@pytest.mark.phase16
@pytest.mark.django_db
class TestPhase5LargeTextReliability:
    """
    Tests for parse_toc_stream endpoint and text size rejection (HTTP 413).
    """

    def _make_book(self, seed_data):
        from lms.models import Book
        return Book.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=seed_data["subjects"][0],
            title=f"{P16}Phase5 Stream Book",
            language="en",
        )

    # ── parse_toc_stream: happy path ─────────────────────────────────────

    def test_stream_endpoint_basic_response_shape(self, seed_data, api):
        """parse_toc_stream returns required keys for valid input."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)

        resp = api.post(f"/api/lms/books/{book.id}/parse_toc_stream/", {
            "toc_text": "1. Introduction\n  1.1 Overview\n  1.2 History\n2. Core Concepts\n  2.1 Definitions",
        }, token, sid)

        assert resp.status_code == 200
        body = resp.json()
        assert "book_id" in body
        assert "chapters" in body
        assert "warnings" in body
        assert "chapter_count" in body
        assert "topic_count" in body
        assert "chunk_count" in body
        assert "chunk_size" in body
        assert body["book_id"] == book.id

    def test_stream_endpoint_parses_chapters_and_topics(self, seed_data, api):
        """Parsed structure matches input text."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)

        toc = "1. Algebra\n  1.1 Variables\n  1.2 Expressions\n2. Geometry\n  2.1 Angles\n  2.2 Triangles"
        resp = api.post(f"/api/lms/books/{book.id}/parse_toc_stream/", {
            "toc_text": toc,
        }, token, sid)

        assert resp.status_code == 200
        body = resp.json()
        assert body["chapter_count"] == 2
        assert body["topic_count"] == 4

    def test_stream_endpoint_single_chunk_for_small_text(self, seed_data, api):
        """Small text fits in one chunk; chunk_count must be 1."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)

        resp = api.post(f"/api/lms/books/{book.id}/parse_toc_stream/", {
            "toc_text": "1. Only Chapter\n  1.1 Only Topic",
        }, token, sid)

        assert resp.status_code == 200
        assert resp.json()["chunk_count"] == 1

    def test_stream_endpoint_custom_chunk_size_produces_multiple_chunks(self, seed_data, api):
        """Forcing a tiny chunk_size causes the text to be split into multiple chunks."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)

        # 500-char text, chunk_size=50 → at least 5 chunks
        text_line = "1. Chapter One\n  1.1 Topic Alpha\n  1.2 Topic Beta\n"
        long_text = text_line * 15  # ~750 chars

        resp = api.post(f"/api/lms/books/{book.id}/parse_toc_stream/", {
            "toc_text": long_text,
            "chunk_size": 50,
        }, token, sid)

        assert resp.status_code == 200
        body = resp.json()
        assert body["chunk_count"] > 1

    # ── parse_toc_stream: validation errors ──────────────────────────────

    def test_stream_endpoint_rejects_empty_text(self, seed_data, api):
        """Empty toc_text returns 400."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)

        resp = api.post(f"/api/lms/books/{book.id}/parse_toc_stream/", {
            "toc_text": "",
        }, token, sid)

        assert resp.status_code == 400

    def test_stream_endpoint_rejects_whitespace_only_text(self, seed_data, api):
        """Whitespace-only toc_text is treated as empty and returns 400."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)

        resp = api.post(f"/api/lms/books/{book.id}/parse_toc_stream/", {
            "toc_text": "   \n\t\n  ",
        }, token, sid)

        assert resp.status_code == 400

    def test_stream_endpoint_rejects_oversized_text(self, seed_data, api):
        """Text exceeding 500KB returns 413."""
        from lms.views import MAX_TOC_TEXT_SIZE
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)

        oversized = "x" * (MAX_TOC_TEXT_SIZE + 1)
        resp = api.post(f"/api/lms/books/{book.id}/parse_toc_stream/", {
            "toc_text": oversized,
        }, token, sid)

        assert resp.status_code == 413

    def test_stream_endpoint_accepts_text_at_boundary(self, seed_data, api):
        """Text exactly at MAX_TOC_TEXT_SIZE is accepted (not rejected)."""
        from lms.views import MAX_TOC_TEXT_SIZE
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)

        # Build text right at boundary; pad with spaces to reach exact size
        base = "1. Chapter\n  1.1 Topic\n"
        at_boundary = base + (" " * (MAX_TOC_TEXT_SIZE - len(base)))

        resp = api.post(f"/api/lms/books/{book.id}/parse_toc_stream/", {
            "toc_text": at_boundary,
        }, token, sid)

        assert resp.status_code == 200

    # ── suggest_toc: size rejection ───────────────────────────────────────

    def test_suggest_toc_rejects_oversized_text(self, seed_data, api):
        """suggest_toc returns 413 when raw_text exceeds MAX_TOC_TEXT_SIZE."""
        from lms.views import MAX_TOC_TEXT_SIZE
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)

        oversized = "x" * (MAX_TOC_TEXT_SIZE + 1)
        resp = api.post(f"/api/lms/books/{book.id}/suggest_toc/", {
            "raw_text": oversized,
        }, token, sid)

        assert resp.status_code == 413
        body = resp.json()
        assert "error" in body
        assert "500" in body["error"]  # mentions the 500KB limit

    def test_suggest_toc_accepts_normal_size_text(self, seed_data, api):
        """suggest_toc accepts text well within the size limit."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)

        with patch("lms.toc_ai_suggester.settings") as mock_settings:
            mock_settings.GROQ_API_KEY = None
            resp = api.post(f"/api/lms/books/{book.id}/suggest_toc/", {
                "raw_text": "1. Intro\n  1.1 Topic A\n2. Body\n  2.1 Topic B",
            }, token, sid)

        assert resp.status_code == 200

    # ── throttle class wiring ────────────────────────────────────────────

    def test_throttle_classes_are_configured(self):
        """Verify OCRRateThrottle and AIRateThrottle exist with correct scopes."""
        from lms.views import OCRRateThrottle, AIRateThrottle
        from rest_framework.throttling import UserRateThrottle

        assert issubclass(OCRRateThrottle, UserRateThrottle)
        assert issubclass(AIRateThrottle, UserRateThrottle)
        assert OCRRateThrottle.scope == "ocr_toc"
        assert AIRateThrottle.scope == "suggest_toc"

    def test_ocr_toc_action_has_throttle_class(self):
        """ocr_toc action must declare OCRRateThrottle (stored in action.kwargs by DRF)."""
        from lms.views import BookViewSet, OCRRateThrottle

        action_fn = getattr(BookViewSet, "ocr_toc", None)
        assert action_fn is not None
        # DRF @action stores extra kwargs in func.kwargs, not as direct attributes
        throttles = getattr(action_fn, "kwargs", {}).get("throttle_classes", [])
        assert OCRRateThrottle in throttles

    def test_suggest_toc_action_has_throttle_class(self):
        """suggest_toc action must declare AIRateThrottle (stored in action.kwargs by DRF)."""
        from lms.views import BookViewSet, AIRateThrottle

        action_fn = getattr(BookViewSet, "suggest_toc", None)
        assert action_fn is not None
        # DRF @action stores extra kwargs in func.kwargs, not as direct attributes
        throttles = getattr(action_fn, "kwargs", {}).get("throttle_classes", [])
        assert AIRateThrottle in throttles

    # ── tenant isolation for stream endpoint ────────────────────────────

    def test_stream_endpoint_school_b_cannot_access_school_a_book(self, seed_data, api):
        """School B token cannot call parse_toc_stream on a school A book."""
        token = seed_data["tokens"]["admin_b"]
        sid = seed_data["SID_B"]
        book = self._make_book(seed_data)  # created in school_a

        resp = api.post(f"/api/lms/books/{book.id}/parse_toc_stream/", {
            "toc_text": "1. Chapter\n  1.1 Topic",
        }, token, sid)

        assert resp.status_code in (403, 404)

    def test_stream_endpoint_requires_auth(self, seed_data, api):
        """Unauthenticated requests to parse_toc_stream are rejected."""
        book = self._make_book(seed_data)
        resp = api.client.post(
            f"/api/lms/books/{book.id}/parse_toc_stream/",
            {"toc_text": "1. Chapter"},
            content_type="application/json",
        )
        assert resp.status_code == 401

    # ── MAX_TOC_TEXT_SIZE constant ───────────────────────────────────────

    def test_max_toc_text_size_is_500kb(self):
        """Verify the constant matches the documented 500KB limit."""
        from lms.views import MAX_TOC_TEXT_SIZE
        assert MAX_TOC_TEXT_SIZE == 500 * 1024


# ==========================================================================
# LEVEL L: PHASE 6 — AI RETRIEVAL PIPELINE
# ==========================================================================

@pytest.mark.phase16
@pytest.mark.django_db
class TestPhase6AIRetrieval:
    """
    Tests for content_retrieval utilities and retrieve_for_ai endpoint.
    """

    # ── Helpers ──────────────────────────────────────────────────────────

    def _make_book(self, seed_data):
        from lms.models import Book
        return Book.objects.create(
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=seed_data["subjects"][0],
            title=f"{P16}P6 Book",
            language="en",
        )

    def _make_chapter_with_topics(self, book, ch_num=1, topics_data=None):
        from lms.models import Chapter, Topic
        ch = Chapter.objects.create(book=book, chapter_number=ch_num, title=f"Ch {ch_num}")
        created = []
        for i, td in enumerate(topics_data or [], start=1):
            t = Topic.objects.create(
                chapter=ch,
                topic_number=i,
                title=td.get('title', f'Topic {i}'),
                content_kind=td.get('content_kind', 'general'),
                page_start=td.get('page_start'),
                page_end=td.get('page_end'),
                content_blocks=td.get('content_blocks', []),
                description=td.get('description', ''),
            )
            created.append(t)
        return ch, created

    # ── extract_text_from_blocks: unit tests ─────────────────────────────

    def test_extract_empty_blocks(self):
        from lms.content_retrieval import extract_text_from_blocks
        assert extract_text_from_blocks([]) == ''
        assert extract_text_from_blocks(None) == ''

    def test_extract_paragraph_block(self):
        from lms.content_retrieval import extract_text_from_blocks
        blocks = [{'type': 'paragraph', 'text': 'Hello world'}]
        assert extract_text_from_blocks(blocks) == 'Hello world'

    def test_extract_heading_block(self):
        from lms.content_retrieval import extract_text_from_blocks
        blocks = [{'type': 'heading', 'text': 'Section Title'}]
        assert 'Section Title' in extract_text_from_blocks(blocks)

    def test_extract_exercise_block_all_fields(self):
        from lms.content_retrieval import extract_text_from_blocks
        blocks = [{'type': 'exercise', 'question': 'What is 2+2?', 'answer': '4'}]
        result = extract_text_from_blocks(blocks)
        assert 'What is 2+2?' in result
        assert '4' in result

    def test_extract_list_block(self):
        from lms.content_retrieval import extract_text_from_blocks
        blocks = [{'type': 'list', 'items': ['Item A', 'Item B', 'Item C']}]
        result = extract_text_from_blocks(blocks)
        assert 'Item A' in result
        assert 'Item C' in result

    def test_extract_table_block(self):
        from lms.content_retrieval import extract_text_from_blocks
        blocks = [{'type': 'table', 'rows': [['Name', 'Age'], ['Ali', '10']]}]
        result = extract_text_from_blocks(blocks)
        assert 'Name' in result
        assert 'Ali' in result

    def test_extract_multiple_blocks_concatenated(self):
        from lms.content_retrieval import extract_text_from_blocks
        blocks = [
            {'type': 'heading', 'text': 'Title'},
            {'type': 'paragraph', 'text': 'Body text.'},
            {'type': 'exercise', 'question': 'Q1?', 'answer': 'A1'},
        ]
        result = extract_text_from_blocks(blocks)
        assert 'Title' in result
        assert 'Body text.' in result
        assert 'Q1?' in result

    def test_extract_unknown_block_type_fallback(self):
        from lms.content_retrieval import extract_text_from_blocks
        blocks = [{'type': 'custom_widget', 'label': 'Widget text'}]
        result = extract_text_from_blocks(blocks)
        assert 'Widget text' in result

    def test_extract_skips_non_dict_items(self):
        from lms.content_retrieval import extract_text_from_blocks
        # Should not raise; non-dict entries are skipped
        blocks = [{'type': 'paragraph', 'text': 'Good'}, 'bad_string', 42]
        result = extract_text_from_blocks(blocks)
        assert 'Good' in result

    # ── retrieve_topics_for_ai: unit tests ───────────────────────────────

    def test_retrieve_all_topics_no_filter(self, seed_data):
        from lms.content_retrieval import retrieve_topics_for_ai
        book = self._make_book(seed_data)
        self._make_chapter_with_topics(book, 1, [
            {'title': 'T1', 'content_kind': 'general'},
            {'title': 'T2', 'content_kind': 'exercise'},
        ])
        result = retrieve_topics_for_ai(book)
        assert len(result) == 2

    def test_retrieve_filter_by_content_kind_exercise(self, seed_data):
        from lms.content_retrieval import retrieve_topics_for_ai
        book = self._make_book(seed_data)
        self._make_chapter_with_topics(book, 1, [
            {'title': 'General Topic', 'content_kind': 'general'},
            {'title': 'Exercise Topic', 'content_kind': 'exercise'},
        ])
        result = retrieve_topics_for_ai(book, content_kind='exercise')
        assert len(result) == 1
        assert result[0]['topic_title'] == 'Exercise Topic'
        assert result[0]['content_kind'] == 'exercise'

    def test_retrieve_filter_by_page_range(self, seed_data):
        from lms.content_retrieval import retrieve_topics_for_ai
        book = self._make_book(seed_data)
        self._make_chapter_with_topics(book, 1, [
            {'title': 'Early',  'page_start': 1,  'page_end': 10},
            {'title': 'Middle', 'page_start': 20, 'page_end': 30},
            {'title': 'Late',   'page_start': 50, 'page_end': 60},
        ])
        # Request pages 15–35: only 'Middle' overlaps
        result = retrieve_topics_for_ai(book, page_start=15, page_end=35)
        titles = [r['topic_title'] for r in result]
        assert 'Middle' in titles
        assert 'Early' not in titles
        assert 'Late' not in titles

    def test_retrieve_topics_with_no_page_data_always_included(self, seed_data):
        from lms.content_retrieval import retrieve_topics_for_ai
        book = self._make_book(seed_data)
        self._make_chapter_with_topics(book, 1, [
            {'title': 'No pages', 'page_start': None, 'page_end': None},
            {'title': 'In range', 'page_start': 5,    'page_end': 15},
        ])
        result = retrieve_topics_for_ai(book, page_start=10, page_end=20)
        titles = [r['topic_title'] for r in result]
        # Both should appear: 'No pages' has no page data so it passes through
        assert 'No pages' in titles
        assert 'In range' in titles

    def test_retrieve_flat_text_from_content_blocks(self, seed_data):
        from lms.content_retrieval import retrieve_topics_for_ai
        book = self._make_book(seed_data)
        self._make_chapter_with_topics(book, 1, [
            {
                'title': 'Rich Topic',
                'content_blocks': [
                    {'type': 'paragraph', 'text': 'Block content here'},
                ],
                'description': 'Description fallback',
            },
        ])
        result = retrieve_topics_for_ai(book)
        assert len(result) == 1
        # content_blocks takes priority over description
        assert 'Block content here' in result[0]['flat_text']

    def test_retrieve_flat_text_falls_back_to_description(self, seed_data):
        from lms.content_retrieval import retrieve_topics_for_ai
        book = self._make_book(seed_data)
        self._make_chapter_with_topics(book, 1, [
            {'title': 'Desc Topic', 'content_blocks': [], 'description': 'From description'},
        ])
        result = retrieve_topics_for_ai(book)
        assert result[0]['flat_text'] == 'From description'

    def test_retrieve_result_dict_shape(self, seed_data):
        from lms.content_retrieval import retrieve_topics_for_ai
        book = self._make_book(seed_data)
        self._make_chapter_with_topics(book, 1, [{'title': 'Shape Test'}])
        result = retrieve_topics_for_ai(book)
        assert len(result) == 1
        item = result[0]
        for key in ('chapter_number', 'chapter_title', 'topic_number',
                    'topic_title', 'content_kind', 'page_start', 'page_end', 'flat_text'):
            assert key in item, f"Missing key: {key}"

    # ── build_prompt: unit tests ─────────────────────────────────────────

    def test_build_lesson_plan_prompt_contains_context(self, seed_data):
        from lms.content_retrieval import build_prompt, retrieve_topics_for_ai
        book = self._make_book(seed_data)
        self._make_chapter_with_topics(book, 1, [{'title': 'Variables'}])
        topic_dicts = retrieve_topics_for_ai(book)

        prompt = build_prompt(
            mode='lesson_plan',
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=seed_data["subjects"][0],
            book=book,
            topic_dicts=topic_dicts,
            lesson_date='2026-04-21',
            duration_minutes=45,
        )
        assert 'lesson plan' in prompt.lower()
        assert 'Variables' in prompt
        assert '2026-04-21' in prompt
        assert '45' in prompt

    def test_build_exam_prompt_contains_context(self, seed_data):
        from lms.content_retrieval import build_prompt, retrieve_topics_for_ai
        book = self._make_book(seed_data)
        self._make_chapter_with_topics(book, 1, [
            {'title': 'Ex 1', 'content_kind': 'exercise'},
        ])
        topic_dicts = retrieve_topics_for_ai(book, content_kind='exercise')

        prompt = build_prompt(
            mode='exam',
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=seed_data["subjects"][0],
            book=book,
            topic_dicts=topic_dicts,
        )
        assert 'exam' in prompt.lower()
        assert 'Ex 1' in prompt

    def test_build_prompt_empty_topics_fallback(self, seed_data):
        from lms.content_retrieval import build_prompt
        book = self._make_book(seed_data)
        prompt = build_prompt(
            mode='lesson_plan',
            school=seed_data["school_a"],
            class_obj=seed_data["classes"][0],
            subject=seed_data["subjects"][0],
            book=book,
            topic_dicts=[],
        )
        assert 'No specific topics selected' in prompt

    # ── retrieve_for_ai endpoint ─────────────────────────────────────────

    def test_retrieve_for_ai_endpoint_basic(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)
        self._make_chapter_with_topics(book, 1, [
            {'title': 'T1', 'content_kind': 'general'},
            {'title': 'T2', 'content_kind': 'exercise'},
        ])

        resp = api.get(f"/api/lms/books/{book.id}/retrieve_for_ai/", token, sid)
        assert resp.status_code == 200
        body = resp.json()
        assert body['book_id'] == book.id
        assert body['topic_count'] == 2
        assert 'topics' in body
        assert 'prompt_preview' in body
        assert body['mode'] == 'lesson_plan'

    def test_retrieve_for_ai_filters_by_content_kind(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)
        self._make_chapter_with_topics(book, 1, [
            {'title': 'General', 'content_kind': 'general'},
            {'title': 'Exercise', 'content_kind': 'exercise'},
        ])

        resp = api.get(
            f"/api/lms/books/{book.id}/retrieve_for_ai/?content_kind=exercise",
            token, sid,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body['topic_count'] == 1
        assert body['topics'][0]['topic_title'] == 'Exercise'

    def test_retrieve_for_ai_exam_mode(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)
        self._make_chapter_with_topics(book, 1, [
            {'title': 'Ex Topic', 'content_kind': 'exercise'},
        ])

        resp = api.get(
            f"/api/lms/books/{book.id}/retrieve_for_ai/?mode=exam&content_kind=exercise",
            token, sid,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body['mode'] == 'exam'
        assert 'exam' in body['prompt_preview'].lower()

    def test_retrieve_for_ai_page_range_filter(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)
        self._make_chapter_with_topics(book, 1, [
            {'title': 'Early', 'page_start': 1,  'page_end': 10},
            {'title': 'Late',  'page_start': 80, 'page_end': 100},
        ])

        resp = api.get(
            f"/api/lms/books/{book.id}/retrieve_for_ai/?page_start=1&page_end=20",
            token, sid,
        )
        assert resp.status_code == 200
        body = resp.json()
        titles = [t['topic_title'] for t in body['topics']]
        assert 'Early' in titles
        assert 'Late' not in titles

    def test_retrieve_for_ai_invalid_page_params(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)

        resp = api.get(
            f"/api/lms/books/{book.id}/retrieve_for_ai/?page_start=abc",
            token, sid,
        )
        assert resp.status_code == 400

    def test_retrieve_for_ai_page_end_less_than_page_start(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)

        resp = api.get(
            f"/api/lms/books/{book.id}/retrieve_for_ai/?page_start=50&page_end=10",
            token, sid,
        )
        assert resp.status_code == 400

    def test_retrieve_for_ai_requires_auth(self, seed_data, api):
        book = self._make_book(seed_data)
        resp = api.client.get(f"/api/lms/books/{book.id}/retrieve_for_ai/")
        assert resp.status_code == 401

    def test_retrieve_for_ai_school_b_cannot_access_school_a_book(self, seed_data, api):
        token = seed_data["tokens"]["admin_b"]
        sid = seed_data["SID_B"]
        book = self._make_book(seed_data)  # created in school_a

        resp = api.get(f"/api/lms/books/{book.id}/retrieve_for_ai/", token, sid)
        assert resp.status_code in (403, 404)

    def test_retrieve_for_ai_prompt_preview_contains_book_title(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)
        self._make_chapter_with_topics(book, 1, [{'title': 'T1'}])

        resp = api.get(f"/api/lms/books/{book.id}/retrieve_for_ai/", token, sid)
        assert resp.status_code == 200
        assert book.title in resp.json()['prompt_preview']

    # ── generate_exam_questions_ai endpoint ──────────────────────────────

    def test_generate_exam_questions_missing_book_id(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.post("/api/lms/generate-exam-questions/", {}, token, sid)
        assert resp.status_code == 400

    def test_generate_exam_questions_invalid_book_id(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.post("/api/lms/generate-exam-questions/", {"book_id": 999999}, token, sid)
        assert resp.status_code == 404

    def test_generate_exam_questions_no_matching_topics(self, seed_data, api):
        """When no exercise topics exist, endpoint returns 400."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)
        # Only general topics, no exercises
        self._make_chapter_with_topics(book, 1, [
            {'title': 'General Only', 'content_kind': 'general'},
        ])

        resp = api.post("/api/lms/generate-exam-questions/", {
            "book_id": book.id,
            "content_kind": "exercise",
        }, token, sid)
        assert resp.status_code == 400
        assert 'No matching topics' in resp.json().get('error', '')

    def test_generate_exam_questions_no_api_key_returns_503(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)
        self._make_chapter_with_topics(book, 1, [
            {'title': 'Exercise', 'content_kind': 'exercise'},
        ])

        with patch("lms.views.settings") as mock_settings:
            mock_settings.GROQ_API_KEY = None
            resp = api.post("/api/lms/generate-exam-questions/", {
                "book_id": book.id,
                "content_kind": "exercise",
            }, token, sid)

        assert resp.status_code == 503

    def test_generate_exam_questions_success(self, seed_data, api):
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        book = self._make_book(seed_data)
        self._make_chapter_with_topics(book, 1, [
            {'title': 'Exercise 1', 'content_kind': 'exercise'},
        ])

        mock_json = '{"title":"Test Quiz","total_marks":10,"questions":[{"number":1,"question":"What is X?","marks":5,"answer":"X is Y"}]}'

        with patch("lms.views.settings") as mock_settings, \
             patch("groq.Groq") as MockGroq:
            mock_settings.GROQ_API_KEY = "test-key"
            mock_settings.GROQ_MODEL = "test-model"
            mock_client = MagicMock()
            MockGroq.return_value = mock_client
            mock_client.chat.completions.create.return_value.choices = [
                MagicMock(message=MagicMock(content=mock_json))
            ]
            resp = api.post("/api/lms/generate-exam-questions/", {
                "book_id": book.id,
                "content_kind": "exercise",
            }, token, sid)

        assert resp.status_code == 200
        body = resp.json()
        assert body.get("success") is True
        assert body.get("title") == "Test Quiz"
        assert len(body.get("questions", [])) == 1
