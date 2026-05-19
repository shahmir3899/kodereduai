from datetime import date

import pytest
from rest_framework.test import APIClient

from examinations.models import ExamPaper, PaperQuestion, Question
from lms.models import (
    Book,
    Chapter,
    ContentBlock,
    CurriculumStandard,
    LearningObjective,
    LessonPlan,
    LessonPlanObjective,
    StandardObjective,
    Topic,
    TopicStandardAlignment,
)


@pytest.fixture
def school(seed_data):
    return seed_data['school_a']


@pytest.fixture
def user(seed_data):
    return seed_data['users']['admin']


@pytest.fixture
def class_obj(seed_data):
    return seed_data['classes'][0]


@pytest.fixture
def subject(seed_data):
    return seed_data['subjects'][0]


@pytest.fixture
def auth_client(seed_data, user):
    client = APIClient()
    client.force_authenticate(user=user)
    client.credentials(HTTP_X_SCHOOL_ID=str(seed_data['SID_A']))
    return client


@pytest.fixture
def book(school, class_obj, subject):
    return Book.objects.create(
        school=school,
        class_obj=class_obj,
        subject=subject,
        title='Phase 3 Book',
        language='en',
    )


@pytest.fixture
def chapter(book):
    return Chapter.objects.create(
        book=book,
        title='Phase 3 Chapter',
        chapter_number=1,
    )


@pytest.fixture
def topic(chapter):
    return Topic.objects.create(
        chapter=chapter,
        title='Phase 3 Topic',
        topic_number=1,
    )


@pytest.fixture
def learning_objective(topic):
    return LearningObjective.objects.create(
        topic=topic,
        statement='Students can explain photosynthesis.',
        bloom_level='understand',
    )


@pytest.fixture
def learning_objectives(topic):
    return [
        LearningObjective.objects.create(
            topic=topic,
            statement='Students can identify chlorophyll.',
            bloom_level='remember',
        ),
        LearningObjective.objects.create(
            topic=topic,
            statement='Students can compare photosynthesis and respiration.',
            bloom_level='analyze',
        ),
    ]


@pytest.fixture
def lesson_plan(seed_data, school, class_obj, subject, topic):
    teacher = seed_data['staff'][0]
    plan = LessonPlan.objects.create(
        school=school,
        academic_year=seed_data['academic_year'],
        class_obj=class_obj,
        subject=subject,
        teacher=teacher,
        title='Phase 3 Lesson Plan',
        description='Plan for phase 3 objective tests',
        lesson_date=date.today(),
        duration_minutes=40,
        status=LessonPlan.Status.DRAFT,
    )
    plan.planned_topics.add(topic)
    return plan


@pytest.fixture
def lesson_plan_with_objectives(lesson_plan, learning_objectives):
    for objective in learning_objectives:
        LessonPlanObjective.objects.get_or_create(
            lesson_plan=lesson_plan,
            objective=objective,
        )
    return lesson_plan


@pytest.fixture
def curriculum_standard():
    return CurriculumStandard.objects.create(
        name='SNC 2021',
        country='Pakistan',
        board='Federal Board',
    )


@pytest.fixture
def standard_objective(curriculum_standard, subject, class_obj):
    return StandardObjective.objects.create(
        standard=curriculum_standard,
        subject=subject,
        grade=class_obj,
        code='Bio-9-3.2.1',
        statement='Students can explain cell division.',
    )


@pytest.fixture
def topic_with_standards(topic, standard_objective):
    TopicStandardAlignment.objects.create(
        topic=topic,
        objective=standard_objective,
    )
    return topic


@pytest.fixture
def question(school, subject, user, topic):
    q = Question.objects.create(
        school=school,
        subject=subject,
        question_text='What is photosynthesis?',
        question_type='SHORT',
        difficulty_level='MEDIUM',
        marks=2,
        created_by=user,
    )
    q.tested_topics.add(topic)
    return q


@pytest.fixture
def exam_paper(school, class_obj, subject, user):
    return ExamPaper.objects.create(
        school=school,
        class_obj=class_obj,
        subject=subject,
        paper_title='Phase 3 Paper',
        instructions='Answer all questions.',
        total_marks=20,
        duration_minutes=30,
        generated_by=user,
    )


@pytest.fixture
def exam_paper_with_questions(exam_paper, school, subject, user, topic):
    q1 = Question.objects.create(
        school=school,
        subject=subject,
        question_text='Question 1',
        question_type='SHORT',
        difficulty_level='MEDIUM',
        marks=2,
        created_by=user,
    )
    q1.tested_topics.add(topic)

    q2 = Question.objects.create(
        school=school,
        subject=subject,
        question_text='Question 2',
        question_type='MCQ',
        difficulty_level='EASY',
        marks=1,
        option_a='A',
        option_b='B',
        option_c='C',
        option_d='D',
        correct_answer='A',
        created_by=user,
    )
    q2.tested_topics.add(topic)

    PaperQuestion.objects.create(exam_paper=exam_paper, question=q1, question_order=1)
    PaperQuestion.objects.create(exam_paper=exam_paper, question=q2, question_order=2)
    return exam_paper


@pytest.fixture
def content_block(topic):
    return ContentBlock.objects.create(
        topic=topic,
        block_type='text',
        content_text='Original content block text',
        sequence_order=1,
    )


@pytest.fixture
def content_block_with_revisions(content_block):
    content_block.content_text = 'Revision one'
    content_block.save()
    content_block.content_text = 'Revision two'
    content_block.save()
    return content_block
