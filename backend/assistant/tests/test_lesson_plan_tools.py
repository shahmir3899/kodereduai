"""Lesson plans, books and diary through the assistant: reads, the plan-from-chapters flow,
single drafts, deletes and diary entries. The model is mocked; writes go through the real LMS API."""
from datetime import date
from unittest.mock import patch

import pytest

from assistant import engine, registry
from assistant.models import AgentAction, AgentConversation
from assistant.skills import lms_common as lc

pytestmark = pytest.mark.django_db

D0, D1 = '2026-12-01', '2026-12-10'     # Tue..Thu; Sundays are off; with Saturdays skipped = 8 school days


@pytest.fixture(autouse=True)
def _all_agents_offered():
    with patch('assistant.router.pick_agents', lambda by_agent, message, recent=(): list(by_agent)):
        yield


@pytest.fixture
def lms(seed_data):
    from academic_sessions.models import SessionClass
    from academics.models import ClassSubject, Subject
    from lms.models import Book, Chapter, Topic

    school, ay, klass = seed_data['school_a'], seed_data['academic_year'], seed_data['classes'][0]
    school.enabled_modules = {**(school.enabled_modules or {}), 'lms': True, 'academics': True}
    school.save(update_fields=['enabled_modules'])
    org = school.organization
    org.allowed_modules = {**(org.allowed_modules or {}), 'lms': True, 'academics': True}
    org.save(update_fields=['allowed_modules'])

    sec = {}
    for letter in 'AB':
        sec[letter] = SessionClass.objects.create(school=school, academic_year=ay, class_obj=klass,
                                                  display_name='Class 4', section=letter, grade_level=4)
    english = Subject.objects.create(school=school, name='English', code='ENG')
    maths = Subject.objects.create(school=school, name='Maths', code='MTH')
    ali, sara = seed_data['staff'][0], seed_data['staff'][1]          # Ali teaches English, Sara teaches Maths
    for sc in sec.values():
        ClassSubject.objects.create(school=school, academic_year=ay, session_class=sc, class_obj=klass, subject=english, teacher=ali)
    ClassSubject.objects.create(school=school, academic_year=ay, session_class=sec['A'], class_obj=klass, subject=maths, teacher=sara)

    book = Book.objects.create(school=school, class_obj=klass, subject=english, title='English Course Book')
    chapters = {n: Chapter.objects.create(book=book, chapter_number=n, title=f'Unit {n}') for n in range(1, 5)}
    topics = {}
    for ch, titles, pages in [(3, ['Nouns', 'Verbs', 'Adjectives'], [(10, 12), (13, 14), (15, 20)]),
                              (4, ['Poem', 'Story'], [(21, 22), (23, 24)])]:
        for i, (t, (a, b)) in enumerate(zip(titles, pages), start=1):
            topics[t] = Topic.objects.create(chapter=chapters[ch], topic_number=i, title=t, page_start=a, page_end=b)
    return {'sec': sec, 'english': english, 'maths': maths, 'ali': ali, 'sara': sara, 'book': book,
            'chapters': chapters, 'topics': topics, 'klass': klass}


def _ctx(user, role=None, conv=None):
    return registry.ToolContext(user=user, school_id=user.school_id, role=role or user.role, conversation=conv)


def _teacher_ctx(lms, who='ali'):
    return _ctx(lms[who].user)


def _admin_ctx(seed):
    return _ctx(seed['users']['admin'])


def _run(ctx, tool, **args):
    conv = AgentConversation.objects.create(school_id=ctx.school_id, user=ctx.user)
    ctx.conversation = conv
    return registry.execute(ctx, tool, args)


def _card(out):
    return AgentAction.objects.get(pk=out['proposal']['action_id'])


def _base(**extra):
    return {'class_name': 'Class 4', 'section': 'A', 'subject_name': 'English', 'date_from': D0, 'date_to': D1,
            'skip_saturday': True, **extra}


# ── the maths ────────────────────────────────────────────────────────────────

class TestDistribute:
    def test_two_chapters_eight_days_is_four_each(self):
        assert [len(x) for x in _blocks(lc.distribute(2, 8))] == [4, 4]

    def test_three_over_eight_gives_extra_to_earlier(self):
        assert [len(x) for x in _blocks(lc.distribute(3, 8))] == [3, 3, 2]

    def test_more_units_than_days_slices(self):
        assert lc.distribute(5, 3) == [[0, 1], [2, 3], [4]]

    def test_every_unit_used_once_in_order(self):
        flat_ = [i for day in lc.distribute(7, 4) for i in day]
        assert flat_ == list(range(7))

    def test_weighted_gives_longer_units_more_days(self):
        plan = lc.distribute_weighted([1, 1, 6], 8)
        assert [len(x) for x in _blocks(plan)] == [1, 1, 6][:0] or sum(len(x) for x in _blocks(plan)) == 8
        sizes = [len(x) for x in _blocks(plan)]
        assert sizes[2] > sizes[0] and sum(sizes) == 8 and min(sizes) >= 1

    def test_empty(self):
        assert lc.distribute(0, 5) == [] and lc.distribute(3, 0) == []


def _blocks(plan):
    """Group consecutive days by the unit taught (single-unit days)."""
    out, last = [], None
    for day in plan:
        if day == last:
            out[-1].append(day)
        else:
            out.append([day])
        last = day
    return out


# ── planning from a book ─────────────────────────────────────────────────────

class TestPlanFromBook:
    def test_two_chapters_split_four_days_each(self, seed_data, lms):
        out = _run(_teacher_ctx(lms), 'plan_lessons_from_book', **_base(chapters=[3, 4]))
        card = _card(out)
        rows = card.preview['rows']
        assert len(rows) == 8 and card.preview['assumptions']['spread_by'] == 'chapter'
        assert [r['content'] for r in rows[:4]] == ['Ch 3: Unit 3'] * 4
        assert [r['content'] for r in rows[4:]] == ['Ch 4: Unit 4'] * 4
        assert {r['weekday'] for r in rows} == {'Tue', 'Wed', 'Thu', 'Fri', 'Mon'}      # no Sunday, no Saturday
        assert all(r['status'] == 'DRAFT' for r in rows)

    def test_nothing_is_saved_by_proposing(self, seed_data, lms):
        from lms.models import LessonPlan
        _run(_teacher_ctx(lms), 'plan_lessons_from_book', **_base(chapters=[3, 4]))
        assert LessonPlan.objects.count() == 0

    def test_uneven_chapters_extra_day_goes_to_earlier(self, seed_data, lms):
        card = _card(_run(_teacher_ctx(lms), 'plan_lessons_from_book', **_base(chapters=[1, 3, 4])))
        sizes = [sum(1 for r in card.preview['rows'] if r['content'] == c) for c in ('Ch 1: Unit 1', 'Ch 3: Unit 3', 'Ch 4: Unit 4')]
        assert sizes == [3, 3, 2]

    def test_chapter_without_topics_uses_a_custom_label(self, seed_data, lms):
        card = _card(_run(_teacher_ctx(lms), 'plan_lessons_from_book', **_base(chapters=[1, 3])))
        assert card.payload['rows'][0]['custom_topics'] == ['Chapter 1: Unit 1'] and card.payload['rows'][0]['topic_ids'] == []

    def test_topic_level_spreads_topics_over_days(self, seed_data, lms):
        card = _card(_run(_teacher_ctx(lms), 'plan_lessons_from_book', **_base(chapters=[3, 4], unit='topic')))
        order = []
        for r in card.preview['rows']:
            if not order or order[-1] != r['content']:
                order.append(r['content'])
        assert [o.split(' ', 1)[1] for o in order] == ['Nouns', 'Verbs', 'Adjectives', 'Poem', 'Story']
        assert any('over several days' in w for w in card.preview['warnings'])

    def test_more_topics_than_days_puts_several_on_one_day(self, seed_data, lms):
        card = _card(_run(_teacher_ctx(lms), 'plan_lessons_from_book', **{**_base(chapters=[3, 4], unit='topic'),
                                                                          'date_from': '2026-12-01', 'date_to': '2026-12-02'}))
        assert len(card.preview['rows']) == 2
        assert ' + ' in card.preview['rows'][0]['content']
        assert any('same day' in w for w in card.preview['warnings'])

    def test_page_range_weights_days_by_pages(self, seed_data, lms):
        card = _card(_run(_teacher_ctx(lms), 'plan_lessons_from_book', **_base(page_from=10, page_to=24)))
        counts = {}
        for r in card.preview['rows']:
            counts[r['content']] = counts.get(r['content'], 0) + 1
        adjectives = next(v for k, v in counts.items() if 'Adjectives' in k)
        poem = next(v for k, v in counts.items() if 'Poem' in k)
        assert adjectives > poem and sum(counts.values()) == 8

    def test_book_without_page_numbers_asks(self, seed_data, lms):
        from lms.models import Topic
        Topic.objects.update(page_start=None, page_end=None)
        out = _run(_teacher_ctx(lms), 'plan_lessons_from_book', **_base(page_from=10, page_to=24))
        assert 'no page numbers' in out['error'] and 'Ask the user' not in out['error'] or 'name chapters' in out['error']

    def test_unknown_chapter_lists_available(self, seed_data, lms):
        out = _run(_teacher_ctx(lms), 'plan_lessons_from_book', **_base(chapters=[9]))
        assert 'not found' in out['error'] and '1, 2, 3, 4' in out['error']

    def test_no_chapters_given_asks_which(self, seed_data, lms):
        out = _run(_teacher_ctx(lms), 'plan_lessons_from_book', **_base())
        assert 'Which chapters' in out['error']

    def test_book_without_structure_asks_the_user(self, seed_data, lms):
        from lms.models import Chapter
        Chapter.objects.all().delete()
        out = _run(_teacher_ctx(lms), 'plan_lessons_from_book', **_base(chapters=[3]))
        assert 'no chapters saved' in out['error']

    def test_custom_units_work_without_a_book(self, seed_data, lms):
        from lms.models import Book
        Book.objects.all().delete()
        card = _card(_run(_teacher_ctx(lms), 'plan_lessons_from_book', **_base(custom_units=['Letters', 'Words'])))
        assert [r['content'] for r in card.preview['rows']].count('Letters') == 4

    def test_no_book_at_all_asks(self, seed_data, lms):
        from lms.models import Book
        Book.objects.all().delete()
        assert 'No book is saved' in _run(_teacher_ctx(lms), 'plan_lessons_from_book', **_base(chapters=[3]))['error']

    def test_several_books_ask_which(self, seed_data, lms):
        from lms.models import Book
        Book.objects.create(school=seed_data['school_a'], class_obj=lms['klass'], subject=lms['english'], title='Workbook')
        out = _run(_teacher_ctx(lms), 'plan_lessons_from_book', **_base(chapters=[3]))
        assert 'Several books' in out['error'] and 'Workbook' in out['error']

    def test_two_sections_without_instruction_asks(self, seed_data, lms):
        out = _run(_teacher_ctx(lms), 'plan_lessons_from_book', **{**_base(chapters=[3, 4]), 'section': None})
        assert 'several sections' in out['error'] and 'Ask the user' in out['error']

    def test_all_sections_plans_each_section(self, seed_data, lms):
        card = _card(_run(_teacher_ctx(lms), 'plan_lessons_from_book', **{**_base(chapters=[3, 4]), 'section': None, 'all_sections': True}))
        assert len(card.preview['rows']) == 16 and {r['section'] for r in card.preview['rows']} == {'Class 4 A', 'Class 4 B'}

    def test_teacher_cannot_plan_a_subject_they_do_not_teach(self, seed_data, lms):
        out = _run(_teacher_ctx(lms, 'sara'), 'plan_lessons_from_book', **_base(chapters=[3]))
        assert 'is not assigned to you' in out['error']

    def test_admin_uses_the_assigned_teacher(self, seed_data, lms):
        card = _card(_run(_admin_ctx(seed_data), 'plan_lessons_from_book', **_base(chapters=[3, 4])))
        assert card.payload['rows'][0]['teacher'] == lms['ali'].id

    def test_existing_plan_is_skipped_by_default(self, seed_data, lms):
        from lms.models import LessonPlan
        LessonPlan.objects.create(school=seed_data['school_a'], class_obj=lms['klass'], session_class=lms['sec']['A'],
                                  subject=lms['english'], teacher=lms['ali'], title='old', lesson_date=date(2026, 12, 2))
        card = _card(_run(_teacher_ctx(lms), 'plan_lessons_from_book', **_base(chapters=[3, 4])))
        assert len(card.preview['rows']) == 7 and card.preview['skipped'][0]['date'] == '2026-12-02'
        added = _card(_run(_teacher_ctx(lms), 'plan_lessons_from_book', **_base(chapters=[3, 4], on_conflict='add')))
        assert len(added.preview['rows']) == 8

    def test_missing_dates_ask(self, seed_data, lms):
        out = _run(_teacher_ctx(lms), 'plan_lessons_from_book', class_name='Class 4', subject_name='English', chapters=[3])
        assert 'Which dates' in out['error']

    def test_range_without_school_days_is_an_error(self, seed_data, lms):
        out = _run(_teacher_ctx(lms), 'plan_lessons_from_book', **{**_base(chapters=[3]), 'date_from': '2026-12-06', 'date_to': '2026-12-06'})
        assert 'no school days' in out['error']

    def test_approve_creates_draft_plans_through_the_lms_api(self, seed_data, lms):
        from lms.models import LessonPlan
        ctx = _teacher_ctx(lms)
        card = _card(_run(ctx, 'plan_lessons_from_book', **_base(chapters=[3, 4])))
        done = engine.approve(card.id, ctx.user, ctx.school_id)
        assert done.status == 'executed' and done.result['created'] == 8 and done.result['failed'] == 0
        plans = LessonPlan.objects.order_by('lesson_date')
        assert plans.count() == 8 and {p.status for p in plans} == {'DRAFT'}
        first, last = plans[0], plans[7]
        assert first.teacher_id == lms['ali'].id and first.session_class_id == lms['sec']['A'].id
        assert {t.title for t in first.planned_topics.all()} == {'Nouns', 'Verbs', 'Adjectives'}
        assert {t.title for t in last.planned_topics.all()} == {'Poem', 'Story'}
        assert first.academic_year_id is not None and not first.ai_generated

    def test_approving_after_someone_else_added_a_plan_asks_again(self, seed_data, lms):
        from lms.models import LessonPlan
        ctx = _teacher_ctx(lms)
        card = _card(_run(ctx, 'plan_lessons_from_book', **_base(chapters=[3, 4])))
        LessonPlan.objects.create(school=seed_data['school_a'], class_obj=lms['klass'], session_class=lms['sec']['A'],
                                  subject=lms['english'], teacher=lms['ali'], title='new', lesson_date=date(2026, 12, 3))
        with pytest.raises(engine.ActionError) as exc:
            engine.approve(card.id, ctx.user, ctx.school_id)
        assert exc.value.code == 'changed' and len(exc.value.extra['action']['preview']['rows']) == 7
        assert LessonPlan.objects.count() == 1

    def test_edit_swap_remove_and_retitle(self, seed_data, lms):
        ctx = _teacher_ctx(lms)
        card = _card(_run(ctx, 'plan_lessons_from_book', **_base(chapters=[3, 4])))
        keys = [r['key'] for r in card.preview['rows']]
        edited = engine.edit(card.id, ctx.user, ctx.school_id, {'swap': [[keys[0], keys[7]]], 'remove_keys': [keys[1]],
                                                                  'titles': {keys[2]: 'Revision day'}})
        rows = {r['key']: r for r in edited.preview['rows']}
        assert len(rows) == 7 and rows[keys[0]]['content'] == 'Ch 4: Unit 4' and rows[keys[7]]['content'] == 'Ch 3: Unit 3'
        assert rows[keys[2]]['title'] == 'Revision day'

    @pytest.mark.parametrize('edits', [{'remove_keys': ['nope']}, {'swap': [['a', 'b']]}, {'titles': {'x': 'y'}},
                                       {'on_conflict': 'replace'}, {'texts': {'1:2026-12-01': {'bogus': 'x'}}}])
    def test_bad_edits_are_rejected(self, seed_data, lms, edits):
        ctx = _teacher_ctx(lms)
        card = _card(_run(ctx, 'plan_lessons_from_book', **_base(chapters=[3, 4])))
        with pytest.raises(engine.ActionError):
            engine.edit(card.id, ctx.user, ctx.school_id, edits)

    def test_students_parents_and_accountants_do_not_get_the_tool(self, seed_data, lms):
        for uname in ('accountant', 'manager', 'staff'):
            assert 'plan_lessons_from_book' not in {t.name for t in registry.tools_for(_ctx(seed_data['users'][uname]))}
        assert 'plan_lessons_from_book' in {t.name for t in registry.tools_for(_teacher_ctx(lms))}


# ── single AI draft ──────────────────────────────────────────────────────────

class TestSingleDraft:
    ARGS = dict(class_name='Class 4', section='A', subject_name='English', lesson_date='2026-12-02', title='Introduction to nouns',
                objectives='Name people, places and things', description='Warm-up, board work, pair activity', teaching_methods='Pair work')

    def test_card_marks_it_as_an_ai_draft_and_approve_saves_it(self, seed_data, lms):
        from lms.models import LessonPlan
        ctx = _teacher_ctx(lms)
        card = _card(_run(ctx, 'create_lesson_plan', **self.ARGS))
        assert card.preview['assumptions']['written_by'].startswith('AI draft')
        engine.approve(card.id, ctx.user, ctx.school_id)
        plan = LessonPlan.objects.get()
        assert plan.ai_generated and plan.status == 'DRAFT' and plan.objectives == self.ARGS['objectives']

    def test_text_can_be_edited_before_approving(self, seed_data, lms):
        from lms.models import LessonPlan
        ctx = _teacher_ctx(lms)
        card = _card(_run(ctx, 'create_lesson_plan', **self.ARGS))
        key = card.preview['rows'][0]['key']
        engine.edit(card.id, ctx.user, ctx.school_id, {'texts': {key: {'objectives': 'Use nouns in sentences'}}})
        engine.approve(card.id, ctx.user, ctx.school_id)
        assert LessonPlan.objects.get().objectives == 'Use nouns in sentences'

    def test_missing_parts_ask(self, seed_data, lms):
        out = _run(_teacher_ctx(lms), 'create_lesson_plan', class_name='Class 4', subject_name='English')
        assert 'Ask the user' in out['error']

    def test_two_sections_need_a_choice(self, seed_data, lms):
        out = _run(_teacher_ctx(lms), 'create_lesson_plan', **{**self.ARGS, 'section': None})
        assert 'several sections' in out['error']


# ── delete ───────────────────────────────────────────────────────────────────

class TestDelete:
    def _plans(self, seed_data, lms):
        from lms.models import LessonPlan
        mk = lambda teacher, d, status: LessonPlan.objects.create(  # noqa: E731
            school=seed_data['school_a'], class_obj=lms['klass'], session_class=lms['sec']['A'], subject=lms['english'],
            teacher=teacher, title=f'p{d}', lesson_date=date(2026, 12, d), status=status)
        return [mk(lms['ali'], 2, 'DRAFT'), mk(lms['ali'], 3, 'PUBLISHED'), mk(lms['sara'], 4, 'DRAFT')]

    def test_delete_needs_ids_or_dates(self, seed_data, lms):
        assert 'Ask the user' in _run(_teacher_ctx(lms), 'delete_lesson_plans')['error']

    def test_teacher_deletes_only_their_own_after_approval(self, seed_data, lms):
        from lms.models import LessonPlan
        mine1, mine2, other = self._plans(seed_data, lms)
        ctx = _teacher_ctx(lms)
        card = _card(_run(ctx, 'delete_lesson_plans', ids=[mine1.id, mine2.id, other.id]))
        assert card.preview['totals']['count'] == 2 and any('PUBLISHED' in w for w in card.preview['warnings'])
        assert LessonPlan.objects.count() == 3                                        # nothing deleted yet
        done = engine.approve(card.id, ctx.user, ctx.school_id)
        assert done.status == 'executed' and done.result['deleted'] == 2
        assert list(LessonPlan.objects.values_list('id', flat=True)) == [other.id]

    def test_someone_elses_plans_alone_is_nothing_to_delete(self, seed_data, lms):
        _, _, other = self._plans(seed_data, lms)
        assert 'Nothing to delete' in _run(_teacher_ctx(lms), 'delete_lesson_plans', ids=[other.id])['error']

    def test_admin_deletes_by_date_range_and_teacher(self, seed_data, lms):
        from lms.models import LessonPlan
        self._plans(seed_data, lms)
        admin = _admin_ctx(seed_data)
        card = _card(_run(admin, 'delete_lesson_plans', teacher_name='Sara', date_from='2026-12-01', date_to='2026-12-31'))
        assert card.preview['totals']['count'] == 1
        engine.approve(card.id, admin.user, admin.school_id)
        assert LessonPlan.objects.count() == 2

    def test_remove_a_row_from_the_card(self, seed_data, lms):
        mine1, mine2, _ = self._plans(seed_data, lms)
        ctx = _teacher_ctx(lms)
        card = _card(_run(ctx, 'delete_lesson_plans', ids=[mine1.id, mine2.id]))
        edited = engine.edit(card.id, ctx.user, ctx.school_id, {'remove_ids': [mine2.id]})
        assert [r['id'] for r in edited.preview['rows']] == [mine1.id]


# ── diary ────────────────────────────────────────────────────────────────────

class TestDiary:
    ARGS = dict(class_name='Class 4', subject_name='English', text='Learn spellings of page 12. Write each 3 times.')

    def test_two_sections_one_card_then_published_entries(self, seed_data, lms):
        from lms.models import Assignment
        ctx = _teacher_ctx(lms)
        card = _card(_run(ctx, 'create_class_diary', **self.ARGS, sections=['A', 'B']))
        assert card.preview['totals']['count'] == 2 and Assignment.objects.count() == 0
        done = engine.approve(card.id, ctx.user, ctx.school_id)
        assert done.status == 'executed' and done.result['created'] == 2
        rows = Assignment.objects.all()
        assert {a.assignment_type for a in rows} == {'DIARY'} and {a.status for a in rows} == {'PUBLISHED'}
        assert not any(a.requires_submission for a in rows) and rows[0].teacher_id == lms['ali'].id

    def test_homework_with_due_date_and_draft_edit(self, seed_data, lms):
        from lms.models import Assignment
        ctx = _teacher_ctx(lms)
        card = _card(_run(ctx, 'create_class_diary', **self.ARGS, section='A', entry_type='HOMEWORK', due_date='2026-12-05'))
        edited = engine.edit(card.id, ctx.user, ctx.school_id, {'status': 'DRAFT'})
        assert edited.preview['rows'][0]['status'] == 'DRAFT'
        engine.approve(card.id, ctx.user, ctx.school_id)
        a = Assignment.objects.get()
        assert a.assignment_type == 'HOMEWORK' and a.status == 'DRAFT' and a.due_date.date() == date(2026, 12, 5)

    def test_several_sections_need_instruction(self, seed_data, lms):
        assert 'several sections' in _run(_teacher_ctx(lms), 'create_class_diary', **self.ARGS)['error']

    def test_empty_text_asks(self, seed_data, lms):
        out = _run(_teacher_ctx(lms), 'create_class_diary', class_name='Class 4', subject_name='English', text='  ')
        assert 'Ask the user' in out['error']

    def test_teacher_cannot_write_diary_for_a_subject_they_do_not_teach(self, seed_data, lms):
        out = _run(_teacher_ctx(lms), 'create_class_diary', class_name='Class 4', subject_name='Maths', text='x', section='A')
        assert 'not assigned to you' in out['error']

    def test_read_back_with_list_assignments(self, seed_data, lms):
        ctx = _teacher_ctx(lms)
        card = _card(_run(ctx, 'create_class_diary', **self.ARGS, section='A'))
        engine.approve(card.id, ctx.user, ctx.school_id)
        out = _run(ctx, 'list_assignments', class_name='Class 4', assignment_type='DIARY')
        assert out['data']['count'] == 1 and 'spellings' in out['data']['entries'][0]['text']


# ── reads ────────────────────────────────────────────────────────────────────

class TestReads:
    def _plans(self, seed_data, lms):
        from lms.models import LessonPlan
        for i, (teacher, status) in enumerate([(lms['sara'], 'DRAFT'), (lms['sara'], 'DRAFT'), (lms['sara'], 'PUBLISHED'), (lms['ali'], 'DRAFT')]):
            LessonPlan.objects.create(school=seed_data['school_a'], class_obj=lms['klass'], session_class=lms['sec']['A'], subject=lms['english'],
                                      teacher=teacher, title=f'p{i}', lesson_date=date(2026, 12, 1 + i), status=status)

    def test_period_is_required_and_the_model_is_told_to_ask(self, seed_data, lms):
        out = _run(_admin_ctx(seed_data), 'count_lesson_plans', teacher_name='Miss Sara')
        assert 'Which period' in out['error']

    def test_counts_drafts_for_a_teacher_by_spoken_name(self, seed_data, lms):
        self._plans(seed_data, lms)
        out = _run(_admin_ctx(seed_data), 'count_lesson_plans', teacher_name='Miss Sara', status='DRAFT', date_from='2026-12-01', date_to='2026-12-31')
        assert out['data']['total'] == 2 and out['data']['by_status'] == {'DRAFT': 2, 'PUBLISHED': 0}
        assert 'Sara' in out['data']['teacher']

    def test_all_time_counts_everything_split_by_status(self, seed_data, lms):
        self._plans(seed_data, lms)
        out = _run(_admin_ctx(seed_data), 'count_lesson_plans', teacher_name='Sara', all_time=True)
        assert out['data']['by_status'] == {'DRAFT': 2, 'PUBLISHED': 1}

    def test_whole_school_when_no_teacher_named(self, seed_data, lms):
        self._plans(seed_data, lms)
        out = _run(_admin_ctx(seed_data), 'count_lesson_plans', all_time=True)
        assert out['data']['total'] == 4 and out['data']['teacher'] == 'all teachers'

    def test_unknown_teacher_and_ambiguous_teacher(self, seed_data, lms):
        assert 'No teacher matching' in _run(_admin_ctx(seed_data), 'count_lesson_plans', teacher_name='Zubair', all_time=True)['error']
        out = _run(_admin_ctx(seed_data), 'count_lesson_plans', teacher_name='PYTEST', all_time=True)      # prefix shared by all three
        assert 'Ask the user which one' in out['error']

    def test_a_teacher_only_ever_sees_their_own(self, seed_data, lms):
        self._plans(seed_data, lms)
        mine = _run(_teacher_ctx(lms, 'sara'), 'count_lesson_plans', all_time=True)
        assert mine['data']['total'] == 3
        other = _run(_teacher_ctx(lms, 'sara'), 'count_lesson_plans', teacher_name='Ali', all_time=True)
        assert 'only work with your own' in other['error']

    def test_list_returns_rows(self, seed_data, lms):
        self._plans(seed_data, lms)
        out = _run(_admin_ctx(seed_data), 'list_lesson_plans', teacher_name='Ali', all_time=True)
        assert out['data']['count'] == 1 and out['data']['plans'][0]['subject'] == 'English'

    def test_book_outline_reports_structure_and_topics(self, seed_data, lms):
        out = _run(_teacher_ctx(lms), 'get_book_outline', class_name='Class 4', subject_name='English', chapter_numbers=[3])
        book = out['data']['books'][0]
        assert book['chapter_count'] == 4 and book['topic_count'] == 5 and book['has_page_numbers']
        assert [t['title'] for t in book['topics']] == ['Nouns', 'Verbs', 'Adjectives']

    def test_find_teacher_is_admin_only(self, seed_data, lms):
        assert _run(_admin_ctx(seed_data), 'find_teacher', query='Sara')['data']['count'] == 1
        assert 'permission' in _run(_teacher_ctx(lms), 'find_teacher', query='Sara')['error']

    def test_class_matching_forms(self, seed_data, lms):
        ctx = _admin_ctx(seed_data)
        for text, expected in [('Class 4', 2), ('4', 2), ('4A', 1), ('class 4 b', 1), ('Class 5', 0)]:
            assert len(lc.find_sections(ctx, text)) == expected, text
