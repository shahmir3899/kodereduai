"""The Items page filters by `category` and `stock_status` (it used to send names the API ignored)."""
import pytest

from inventory.models import InventoryCategory, InventoryItem


@pytest.fixture
def items(seed_data):
    school = seed_data['school_a']
    cat_a = InventoryCategory.objects.create(school=school, name='Filter A')
    cat_b = InventoryCategory.objects.create(school=school, name='Filter B')
    make = lambda name, cat, stock, minimum: InventoryItem.objects.create(  # noqa: E731
        school=school, category=cat, name=name, current_stock=stock, minimum_stock=minimum, unit_price=1,
    )
    make('out item', cat_a, 0, 5)
    make('low item', cat_a, 3, 5)
    make('edge item', cat_b, 5, 5)
    make('ok item', cat_b, 20, 5)
    return {'a': cat_a.id, 'b': cat_b.id}


def _names(api, seed_data, query):
    resp = api.get(f'/api/inventory/items/?page_size=100&{query}', seed_data['tokens']['admin'], seed_data['SID_A'])
    assert resp.status_code == 200
    return {r['name'] for r in resp.json()['results']}


@pytest.mark.django_db
def test_stock_status_matches_the_badges(api, seed_data, items):
    assert _names(api, seed_data, 'stock_status=out') == {'out item'}
    assert _names(api, seed_data, 'stock_status=low') == {'low item', 'edge item'}
    assert _names(api, seed_data, 'stock_status=ok') == {'ok item'}


@pytest.mark.django_db
def test_category_filter_accepts_the_page_param_and_the_old_one(api, seed_data, items):
    assert _names(api, seed_data, f"category={items['a']}") == {'out item', 'low item'}
    assert _names(api, seed_data, f"category_id={items['b']}") == {'edge item', 'ok item'}
    assert _names(api, seed_data, f"category={items['a']}&stock_status=low") == {'low item'}
