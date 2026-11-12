"""Operations through the assistant: library, hostel, inventory, transport. Reads and writes go through the real viewsets as the signed-in user."""
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from assistant import engine, registry
from assistant.models import AgentAction, AgentConversation

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _all_agents_offered():
    with patch('assistant.router.pick_agents', lambda by_agent, message, recent=(): list(by_agent)):
        yield


@pytest.fixture
def ops(seed_data, seed_sections):
    from datetime import date
    school, year = seed_data['school_a'], seed_data['academic_year']
    mods = {m: True for m in ('students', 'library', 'hostel', 'inventory', 'transport', 'hr')}
    school.enabled_modules = {**(school.enabled_modules or {}), **mods}
    school.save(update_fields=['enabled_modules'])
    org = school.organization
    org.allowed_modules = {**(org.allowed_modules or {}), **mods}
    org.save(update_fields=['allowed_modules'])
    year.is_current = True
    year.start_date, year.end_date = date(2020, 1, 1), date(2099, 12, 31)
    year.save()
    return {'school': school, 'year': year, 'a': seed_sections['a_students'][0], 'b': seed_sections['a_students'][1], 'staff': seed_data['staff'][0]}


def _run(seed, tool, uname='admin', **args):
    user = seed['users'][uname]
    ctx = registry.ToolContext(user=user, school_id=seed['SID_A'], role=user.role)
    ctx.conversation = AgentConversation.objects.create(school_id=ctx.school_id, user=ctx.user)
    return registry.execute(ctx, tool, args)


def _card(out):
    assert 'proposal' in out, out
    return AgentAction.objects.get(pk=out['proposal']['action_id'])


def _approve(card, seed, uname='admin'):
    return engine.approve(card.id, seed['users'][uname], seed['SID_A'])


# ── library ──────────────────────────────────────────────────────────────────

@pytest.fixture
def lib(ops):
    from library.models import Book
    return {'gul': Book.objects.create(school=ops['school'], title='Gulistan', author='Saadi', total_copies=2, available_copies=2),
            'one': Book.objects.create(school=ops['school'], title='Bostan', author='Saadi', total_copies=1, available_copies=1)}


class TestLibrary:
    def test_search_and_availability(self, seed_data, ops, lib):
        out = _run(seed_data, 'search_books', search='gulis')['data']
        assert out['books'][0]['title'] == 'Gulistan' and out['books'][0]['available'] == 2

    def test_issue_saves_nothing_until_approved_then_takes_a_copy(self, seed_data, ops, lib):
        from library.models import BookIssue
        card = _card(_run(seed_data, 'issue_book', book_title='Gulistan', student_id=ops['a'].id))
        assert not BookIssue.objects.exists()
        _approve(card, seed_data)
        lib['gul'].refresh_from_db()
        i = BookIssue.objects.get()
        assert lib['gul'].available_copies == 1 and i.student_id == ops['a'].id and i.status == 'ISSUED'

    def test_same_borrower_cannot_take_a_second_copy(self, seed_data, ops, lib):
        _approve(_card(_run(seed_data, 'issue_book', book_title='Gulistan', student_id=ops['a'].id)), seed_data)
        assert 'error' in _run(seed_data, 'issue_book', book_title='Gulistan', student_id=ops['a'].id)

    def test_no_copy_left_is_refused(self, seed_data, ops, lib):
        _approve(_card(_run(seed_data, 'issue_book', book_title='Bostan', student_id=ops['a'].id)), seed_data)
        assert 'error' in _run(seed_data, 'issue_book', book_title='Bostan', student_id=ops['b'].id)

    def test_past_due_date_refused_and_borrower_required(self, seed_data, ops, lib):
        past = (timezone.localdate() - timedelta(days=1)).isoformat()
        assert 'error' in _run(seed_data, 'issue_book', book_title='Gulistan', student_id=ops['a'].id, due_date=past)
        assert 'error' in _run(seed_data, 'issue_book', book_title='Gulistan')

    def test_return_shows_the_fine_and_gives_the_copy_back(self, seed_data, ops, lib):
        from library.models import BookIssue
        _approve(_card(_run(seed_data, 'issue_book', book_title='Gulistan', student_id=ops['a'].id)), seed_data)
        BookIssue.objects.update(due_date=timezone.localdate() - timedelta(days=3), status='OVERDUE')
        assert _run(seed_data, 'list_overdue_books')['data']['count'] == 1
        card = _card(_run(seed_data, 'return_book', student_id=ops['a'].id))
        assert card.preview['rows'][0]['days_late'] == 3 and card.preview['rows'][0]['fine'] > 0
        _approve(card, seed_data)
        lib['gul'].refresh_from_db()
        i = BookIssue.objects.get()
        assert i.status == 'RETURNED' and i.fine_amount > 0 and lib['gul'].available_copies == 2

    def test_returning_nothing_is_refused(self, seed_data, ops, lib):
        assert 'error' in _run(seed_data, 'return_book', student_id=ops['a'].id)

    def test_teacher_has_no_library_tools(self, seed_data, ops, lib):
        assert 'error' in _run(seed_data, 'search_books', 'teacher')
        assert 'error' in _run(seed_data, 'issue_book', 'teacher', book_title='Gulistan', student_id=ops['a'].id)


# ── hostel ───────────────────────────────────────────────────────────────────

@pytest.fixture
def hostel(ops):
    from hostel.models import GatePass, Hostel, HostelAllocation, Room
    h = Hostel.objects.create(school=ops['school'], name='Iqbal House', hostel_type='BOYS', capacity=10)
    room = Room.objects.create(hostel=h, room_number='101', capacity=2)
    alloc = HostelAllocation.objects.create(school=ops['school'], student=ops['a'], room=room, academic_year=ops['year'])
    now = timezone.now()
    gp = GatePass.objects.create(school=ops['school'], student=ops['a'], allocation=alloc, pass_type='DAY', reason='Doctor', going_to='Home',
                                 departure_date=now + timedelta(hours=2), expected_return=now + timedelta(hours=8))
    return {'room': room, 'alloc': alloc, 'gp': gp}


class TestHostel:
    def test_summary_and_rooms(self, seed_data, ops, hostel):
        assert _run(seed_data, 'get_hostel_summary')['data']['pending_gate_passes'] == 1
        rooms = _run(seed_data, 'list_rooms', only_with_free_beds=True)['data']['rooms']
        assert rooms[0]['free_beds'] == 1

    def test_student_hostel(self, seed_data, ops, hostel):
        out = _run(seed_data, 'get_student_hostel', student_id=ops['a'].id)['data']
        assert out['allocations'][0]['room'] == '101'

    def test_pending_passes_listed(self, seed_data, ops, hostel):
        assert _run(seed_data, 'list_gate_passes', status='PENDING')['data']['count'] == 1

    def test_approve_pass(self, seed_data, ops, hostel):
        card = _card(_run(seed_data, 'decide_gate_pass', decision='APPROVE', student_id=ops['a'].id, remarks='OK'))
        hostel['gp'].refresh_from_db()
        assert hostel['gp'].status == 'PENDING'
        _approve(card, seed_data)
        hostel['gp'].refresh_from_db()
        assert hostel['gp'].status == 'APPROVED' and hostel['gp'].approved_by_id == seed_data['users']['admin'].id

    def test_reject_all_pending(self, seed_data, ops, hostel):
        _approve(_card(_run(seed_data, 'decide_gate_pass', 'principal', decision='REJECT', all_pending=True)), seed_data, 'principal')
        hostel['gp'].refresh_from_db()
        assert hostel['gp'].status == 'REJECTED'

    def test_already_decided_is_a_conflict(self, seed_data, ops, hostel):
        card = _card(_run(seed_data, 'decide_gate_pass', decision='APPROVE', all_pending=True))
        hostel['gp'].status = 'REJECTED'; hostel['gp'].save()
        with pytest.raises(engine.ActionError):
            _approve(card, seed_data)

    def test_no_checkout_or_return_tool(self, seed_data, ops, hostel):
        names = {t.name for t in registry.all_tools() if t.sub_agent == 'operations'}
        assert not [n for n in names if 'checkout' in n or 'vacate' in n]

    def test_teacher_refused(self, seed_data, ops, hostel):
        assert 'error' in _run(seed_data, 'list_gate_passes', 'teacher')


# ── inventory ────────────────────────────────────────────────────────────────

@pytest.fixture
def inv(ops):
    from inventory.models import InventoryCategory, InventoryItem, Vendor
    cat = InventoryCategory.objects.create(school=ops['school'], name='Furniture')
    chair = InventoryItem.objects.create(school=ops['school'], category=cat, name='Chair', current_stock=10, minimum_stock=3, unit_price=500)
    chalk = InventoryItem.objects.create(school=ops['school'], category=cat, name='Chalk box', current_stock=4, minimum_stock=5, unit_price=100)
    ven = Vendor.objects.create(school=ops['school'], name='Ahmad Traders')
    return {'chair': chair, 'chalk': chalk, 'vendor': ven}


class TestInventory:
    def test_stock_and_low_stock(self, seed_data, ops, inv):
        assert _run(seed_data, 'get_inventory_stock', search='chair')['data']['items'][0]['stock'] == 10
        assert [i['name'] for i in _run(seed_data, 'get_low_stock_items')['data']['items']] == ['Chalk box']

    def test_stock_in_updates_stock_only_after_approval(self, seed_data, ops, inv):
        card = _card(_run(seed_data, 'record_stock_in', vendor_name='ahmad', reference='B-77',
                          lines=[{'item_name': 'Chair', 'quantity': 20}, {'item_name': 'Chalk box', 'quantity': 5, 'unit_price': 90}]))
        inv['chair'].refresh_from_db()
        assert inv['chair'].current_stock == 10 and card.preview['rows'][0]['after'] == 30
        _approve(card, seed_data)
        inv['chair'].refresh_from_db(); inv['chalk'].refresh_from_db()
        assert (inv['chair'].current_stock, inv['chalk'].current_stock) == (30, 9)
        assert inv['chair'].transactions.get().vendor_id == inv['vendor'].id

    def test_stock_out_and_below_zero_refused(self, seed_data, ops, inv):
        _approve(_card(_run(seed_data, 'record_stock_out', lines=[{'item_name': 'Chair', 'quantity': 4}])), seed_data)
        inv['chair'].refresh_from_db()
        assert inv['chair'].current_stock == 6
        assert 'error' in _run(seed_data, 'record_stock_out', lines=[{'item_name': 'Chair', 'quantity': 99}])

    def test_remove_a_line_on_the_card(self, seed_data, ops, inv):
        card = _card(_run(seed_data, 'record_stock_in', lines=[{'item_name': 'Chair', 'quantity': 2}, {'item_name': 'Chalk box', 'quantity': 2}]))
        engine.edit(card.id, seed_data['users']['admin'], seed_data['SID_A'], {'remove_keys': ['l0']})
        _approve(card, seed_data)
        inv['chair'].refresh_from_db(); inv['chalk'].refresh_from_db()
        assert (inv['chair'].current_stock, inv['chalk'].current_stock) == (10, 6)

    def test_edit_quantity_on_the_card(self, seed_data, ops, inv):
        card = _card(_run(seed_data, 'record_stock_in', lines=[{'item_name': 'Chair', 'quantity': 2}]))
        engine.edit(card.id, seed_data['users']['admin'], seed_data['SID_A'], {'amounts': {'l0': 7}})
        _approve(card, seed_data)
        inv['chair'].refresh_from_db()
        assert inv['chair'].current_stock == 17

    def test_bad_input_asks(self, seed_data, ops, inv):
        assert 'error' in _run(seed_data, 'record_stock_in', lines=[{'item_name': 'Chair', 'quantity': 1.5}])
        assert 'error' in _run(seed_data, 'record_stock_in', lines=[{'item_name': 'Desk', 'quantity': 1}])
        assert 'error' in _run(seed_data, 'record_stock_in', lines=[{'item_name': 'Chair', 'quantity': 1, 'type': 'ISSUE'}])
        assert 'error' in _run(seed_data, 'record_stock_in', vendor_name='nobody', lines=[{'item_name': 'Chair', 'quantity': 1}])

    def test_finance_manager_and_teacher_refused(self, seed_data, ops, inv):
        for u in ('finance_manager', 'teacher'):
            assert 'error' in _run(seed_data, 'record_stock_in', u, lines=[{'item_name': 'Chair', 'quantity': 1}])
            assert 'error' in _run(seed_data, 'get_inventory_stock', u)


# ── transport ────────────────────────────────────────────────────────────────

@pytest.fixture
def trn(ops):
    from transport.models import TransportRoute, TransportStop, TransportVehicle
    r1 = TransportRoute.objects.create(school=ops['school'], name='Route 1', estimated_duration_minutes=30)
    r2 = TransportRoute.objects.create(school=ops['school'], name='Route 2', estimated_duration_minutes=30)
    s1 = TransportStop.objects.create(route=r1, name='Model Town', stop_order=1, pickup_time='07:30', drop_time='14:00')
    s2 = TransportStop.objects.create(route=r2, name='Gulberg', stop_order=1, pickup_time='07:30', drop_time='14:00')
    v2 = TransportVehicle.objects.create(school=ops['school'], vehicle_number='LEA-1234', capacity=30, assigned_route=r2)
    return {'r1': r1, 'r2': r2, 's1': s1, 's2': s2, 'v2': v2}


class TestTransport:
    def test_routes_and_status(self, seed_data, ops, trn):
        assert {r['name'] for r in _run(seed_data, 'list_routes')['data']['routes']} == {'Route 1', 'Route 2'}
        out = _run(seed_data, 'get_route_status', route_name='Route 2', estimated_duration_minutes=30)['data']
        assert out['running_now'] == 0 and 'note' in out

    def test_assign_then_read_back(self, seed_data, ops, trn):
        from transport.models import TransportAssignment
        card = _card(_run(seed_data, 'assign_student_transport', student_id=ops['a'].id, route_name='Route 1', stop_name='model town'))
        assert not TransportAssignment.objects.exists()
        _approve(card, seed_data)
        a = TransportAssignment.objects.get()
        assert a.route_id == trn['r1'].id and a.transport_type == 'BOTH' and a.is_active
        assert _run(seed_data, 'get_student_transport', student_id=ops['a'].id)['data']['assignments'][0]['route'] == 'Route 1'
        assert _run(seed_data, 'get_route_students', route_name='Route 1', estimated_duration_minutes=30)['data']['count'] == 1

    def test_second_assignment_changes_instead_of_duplicating(self, seed_data, ops, trn):
        from transport.models import TransportAssignment
        _approve(_card(_run(seed_data, 'assign_student_transport', student_id=ops['a'].id, route_name='Route 1', stop_name='Model Town')), seed_data)
        card = _card(_run(seed_data, 'assign_student_transport', student_id=ops['a'].id, route_name='Route 2', stop_name='Gulberg', vehicle_number='LEA 1234', transport_type='PICKUP'))
        assert card.preview['title'] == 'Change transport'
        _approve(card, seed_data)
        a = TransportAssignment.objects.get()
        assert (a.route_id, a.vehicle_id, a.transport_type) == (trn['r2'].id, trn['v2'].id, 'PICKUP')

    def test_stop_of_another_route_asks(self, seed_data, ops, trn):
        out = _run(seed_data, 'assign_student_transport', student_id=ops['a'].id, route_name='Route 1', stop_name='Gulberg')
        assert 'error' in out and 'Model Town' in out['error']

    def test_vehicle_of_another_route_refused(self, seed_data, ops, trn):
        assert 'error' in _run(seed_data, 'assign_student_transport', student_id=ops['a'].id, route_name='Route 1', stop_name='Model Town', vehicle_number='LEA-1234')

    def test_remove_deactivates_and_keeps_the_record(self, seed_data, ops, trn):
        from transport.models import TransportAssignment
        _approve(_card(_run(seed_data, 'assign_student_transport', student_id=ops['a'].id, route_name='Route 1', stop_name='Model Town')), seed_data)
        _approve(_card(_run(seed_data, 'remove_student_transport', student_id=ops['a'].id)), seed_data)
        a = TransportAssignment.objects.get()
        assert a.is_active is False
        assert 'error' in _run(seed_data, 'remove_student_transport', student_id=ops['a'].id)

    def test_reassign_after_removal_reactivates(self, seed_data, ops, trn):
        from transport.models import TransportAssignment
        _approve(_card(_run(seed_data, 'assign_student_transport', student_id=ops['a'].id, route_name='Route 1', stop_name='Model Town')), seed_data)
        _approve(_card(_run(seed_data, 'remove_student_transport', student_id=ops['a'].id)), seed_data)
        _approve(_card(_run(seed_data, 'assign_student_transport', student_id=ops['a'].id, route_name='Route 2', stop_name='Gulberg')), seed_data)
        a = TransportAssignment.objects.get()
        assert a.is_active and a.route_id == trn['r2'].id

    def test_teacher_refused(self, seed_data, ops, trn):
        assert 'error' in _run(seed_data, 'assign_student_transport', 'teacher', student_id=ops['a'].id, route_name='Route 1', stop_name='Model Town')
        assert 'error' in _run(seed_data, 'list_routes', 'teacher')
