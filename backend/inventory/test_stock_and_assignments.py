"""Assign/return/record flows the Inventory pages drive (they used to 400 or 404 or cross schools)."""
import pytest

from inventory.models import InventoryCategory, InventoryItem, ItemAssignment, StockTransaction, Vendor


@pytest.fixture
def store(seed_data):
    a, b = seed_data['school_a'], seed_data['school_b']
    cat_a = InventoryCategory.objects.create(school=a, name='Cat A')
    cat_b = InventoryCategory.objects.create(school=b, name='Cat B')
    return {
        'item': InventoryItem.objects.create(
            school=a, category=cat_a, name='Chalk', current_stock=10, minimum_stock=2, unit_price=5),
        'other_item': InventoryItem.objects.create(
            school=b, category=cat_b, name='Other school chalk', current_stock=10, minimum_stock=2, unit_price=5),
        'other_vendor': Vendor.objects.create(school=b, name='Other vendor'),
        'vendor': Vendor.objects.create(school=a, name='Vendor A'),
    }


def _post(api, seed_data, url, data, who='admin'):
    return api.post(url, data, seed_data['tokens'][who], seed_data['SID_A'])


@pytest.mark.django_db
def test_assign_without_a_date_defaults_to_today_and_return_works(api, seed_data, store):
    teacher = seed_data['users']['teacher']
    resp = _post(api, seed_data, '/api/inventory/assignments/', {
        'item': store['item'].id, 'assigned_to': teacher.id, 'quantity': 3,
        'condition_on_assign': 'NEW', 'notes': '',
    })
    assert resp.status_code == 201, resp.content
    store['item'].refresh_from_db()
    assert store['item'].current_stock == 7

    aid = resp.json()['id']
    resp = _post(api, seed_data, f'/api/inventory/assignments/{aid}/return/', {'condition_on_return': 'POOR'})
    assert resp.status_code == 200, resp.content
    store['item'].refresh_from_db()
    assert store['item'].current_stock == 10
    assert ItemAssignment.objects.get(pk=aid).condition_on_return == 'POOR'


@pytest.mark.django_db
def test_return_rejects_unknown_condition(api, seed_data, store):
    teacher = seed_data['users']['teacher']
    aid = _post(api, seed_data, '/api/inventory/assignments/', {
        'item': store['item'].id, 'assigned_to': teacher.id, 'quantity': 1,
    }).json()['id']
    resp = _post(api, seed_data, f'/api/inventory/assignments/{aid}/return/', {'condition_on_return': 'BROKEN!!!'})
    assert resp.status_code == 400
    assert ItemAssignment.objects.get(pk=aid).is_active


@pytest.mark.django_db
def test_assignment_validation(api, seed_data, store):
    teacher = seed_data['users']['teacher']
    base = {'item': store['item'].id, 'assigned_to': teacher.id}
    assert _post(api, seed_data, '/api/inventory/assignments/', {**base, 'quantity': 0}).status_code == 400
    assert _post(api, seed_data, '/api/inventory/assignments/', {**base, 'quantity': 99}).status_code == 400
    # another school's item / user
    assert _post(api, seed_data, '/api/inventory/assignments/', {
        'item': store['other_item'].id, 'assigned_to': teacher.id, 'quantity': 1}).status_code == 400
    assert _post(api, seed_data, '/api/inventory/assignments/', {
        'item': store['item'].id, 'assigned_to': seed_data['users']['admin_b'].id, 'quantity': 1}).status_code == 400
    assert ItemAssignment.objects.count() == 0


@pytest.mark.django_db
def test_transaction_validation_and_vendor_scope(api, seed_data, store):
    url = '/api/inventory/transactions/'
    item = store['item']
    day = '2026-01-10'
    assert _post(api, seed_data, url, {
        'item': store['other_item'].id, 'transaction_type': 'PURCHASE', 'quantity': 1, 'date': day}).status_code == 400
    assert _post(api, seed_data, url, {
        'item': item.id, 'transaction_type': 'PURCHASE', 'quantity': 1, 'vendor': store['other_vendor'].id,
        'date': day}).status_code == 400
    assert _post(api, seed_data, url, {
        'item': item.id, 'transaction_type': 'PURCHASE', 'quantity': 0, 'date': day}).status_code == 400
    # an adjustment down cannot take stock below zero
    assert _post(api, seed_data, url, {
        'item': item.id, 'transaction_type': 'ADJUSTMENT', 'quantity': -11, 'date': day}).status_code == 400
    assert StockTransaction.objects.count() == 0

    resp = _post(api, seed_data, url, {
        'item': item.id, 'transaction_type': 'ADJUSTMENT', 'quantity': -4, 'date': day,
        'vendor': store['vendor'].id})
    assert resp.status_code == 201, resp.content
    item.refresh_from_db()
    assert item.current_stock == 6
    # vendor is dropped on anything but a purchase
    assert StockTransaction.objects.get().vendor_id is None


@pytest.mark.django_db
def test_teacher_cannot_assign_or_return(api, seed_data, store):
    teacher = seed_data['users']['teacher']
    resp = _post(api, seed_data, '/api/inventory/assignments/', {
        'item': store['item'].id, 'assigned_to': teacher.id, 'quantity': 1}, who='teacher')
    assert resp.status_code == 403
