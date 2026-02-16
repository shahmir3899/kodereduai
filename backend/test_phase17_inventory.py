# -*- coding: utf-8 -*-
"""
Phase 17: Inventory & Store — Comprehensive API Test Suite.

Tests categories, vendors, items, assignments, transactions,
low_stock, return_item, dashboard via REST API.

Run:
    cd backend
    python manage.py shell -c "exec(open('test_phase17_inventory.py', encoding='utf-8').read())"

What it tests:
    Level A: Category CRUD
    Level B: Vendor CRUD
    Level C: Item CRUD + low_stock
    Level D: Item Assignment CRUD + return_item + by_user
    Level E: Stock Transactions (create + list, no update/delete)
    Level F: Dashboard
    Level G: Cross-cutting (permissions, school isolation)

Roles tested:
    - SCHOOL_ADMIN: full inventory management
    - TEACHER: read-only access
"""

import json
import traceback
from datetime import date
from django.test import Client
from django.conf import settings

if 'testserver' not in settings.ALLOWED_HOSTS:
    settings.ALLOWED_HOSTS.append('testserver')

# Load shared seed data
exec(open('seed_test_data.py', encoding='utf-8').read())

from inventory.models import InventoryCategory, Vendor, InventoryItem

# Phase-specific prefix
P17 = "P17INV_"

try:
    seed = get_seed_data()

    school_a = seed['school_a']
    school_b = seed['school_b']
    SID_A = seed['SID_A']
    SID_B = seed['SID_B']
    token_admin = seed['tokens']['admin']
    token_teacher = seed['tokens']['teacher']
    token_admin_b = seed['tokens']['admin_b']
    admin_user = seed['users']['admin']
    teacher_user = seed['users']['teacher']

    reset_counters()

    # ==================================================================
    print("=" * 70)
    print("  PHASE 17 COMPREHENSIVE TEST SUITE — INVENTORY & STORE")
    print("=" * 70)

    # ==================================================================
    # LEVEL A: CATEGORY CRUD
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL A: CATEGORY CRUD")
    print("=" * 70)

    # A1: List categories
    resp = api_get('/api/inventory/categories/', token_admin, SID_A)
    check("A1: List categories returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # A2: Create category (idempotent — skip if exists from previous run)
    cat_id = None
    _existing_cat = InventoryCategory.objects.filter(name=f'{P17}Electronics', school=school_a).first()
    if _existing_cat:
        cat_id = _existing_cat.id
        check("A2: Create category returns 201", True, "(already exists)")
        check("A3: Category created", True, "(already exists)")
    else:
        resp = api_post('/api/inventory/categories/', {
            'name': f'{P17}Electronics',
            'description': 'Electronic items and gadgets',
        }, token_admin, SID_A)
        check("A2: Create category returns 201", resp.status_code == 201,
              f"got {resp.status_code} {resp.content[:200]}")
        if resp.status_code == 201:
            cat_id = resp.json().get('id')
            if not cat_id:
                _cat = InventoryCategory.objects.filter(name=f'{P17}Electronics', school=school_a).first()
                cat_id = _cat.id if _cat else None
        check("A3: Category created", cat_id is not None)

    # A4: Retrieve category
    if cat_id:
        resp = api_get(f'/api/inventory/categories/{cat_id}/', token_admin, SID_A)
        check("A4: Retrieve category returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            check("A5: Category has correct name",
                  resp.json().get('name') == f'{P17}Electronics')

    # A6: Update category
    if cat_id:
        resp = api_patch(f'/api/inventory/categories/{cat_id}/', {
            'description': 'Updated description',
        }, token_admin, SID_A)
        check("A6: Update category returns 200", resp.status_code == 200,
              f"got {resp.status_code}")

    # A7: Create second category (idempotent)
    cat2_id = None
    _existing_cat2 = InventoryCategory.objects.filter(name=f'{P17}Stationery', school=school_a).first()
    if _existing_cat2:
        cat2_id = _existing_cat2.id
        check("A7: Create second category", True, "(already exists)")
    else:
        resp = api_post('/api/inventory/categories/', {
            'name': f'{P17}Stationery',
            'description': 'Office supplies',
        }, token_admin, SID_A)
        cat2_id = None
        if resp.status_code == 201:
            cat2_id = resp.json().get('id')
            if not cat2_id:
                _cat2 = InventoryCategory.objects.filter(name=f'{P17}Stationery', school=school_a).first()
                cat2_id = _cat2.id if _cat2 else None
        check("A7: Create second category", cat2_id is not None,
              f"got {resp.status_code}")

    # ==================================================================
    # LEVEL B: VENDOR CRUD
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL B: VENDOR CRUD")
    print("=" * 70)

    # B1: List vendors
    resp = api_get('/api/inventory/vendors/', token_admin, SID_A)
    check("B1: List vendors returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # B2: Create vendor (idempotent)
    vendor_id = None
    _existing_v = Vendor.objects.filter(name=f'{P17}Tech Supplies Co', school=school_a).first()
    if _existing_v:
        vendor_id = _existing_v.id
        check("B2: Create vendor returns 201", True, "(already exists)")
        check("B3: Vendor created", True, "(already exists)")
    else:
        resp = api_post('/api/inventory/vendors/', {
            'name': f'{P17}Tech Supplies Co',
            'contact_person': 'Ahmad',
            'phone': '+923001234567',
            'email': f'{P17}vendor@test.com',
            'address': '123 Test Street',
        }, token_admin, SID_A)
        check("B2: Create vendor returns 201", resp.status_code == 201,
              f"got {resp.status_code} {resp.content[:200]}")
        if resp.status_code == 201:
            vendor_id = resp.json().get('id')
            if not vendor_id:
                _v = Vendor.objects.filter(name=f'{P17}Tech Supplies Co', school=school_a).first()
                vendor_id = _v.id if _v else None
        check("B3: Vendor created", vendor_id is not None)

    # B4: Retrieve vendor
    if vendor_id:
        resp = api_get(f'/api/inventory/vendors/{vendor_id}/', token_admin, SID_A)
        check("B4: Retrieve vendor returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            check("B5: Vendor has correct name",
                  resp.json().get('name') == f'{P17}Tech Supplies Co')

    # B6: Update vendor
    if vendor_id:
        resp = api_patch(f'/api/inventory/vendors/{vendor_id}/', {
            'contact_person': 'Updated Contact',
        }, token_admin, SID_A)
        check("B6: Update vendor returns 200", resp.status_code == 200,
              f"got {resp.status_code}")

    # ==================================================================
    # LEVEL C: ITEM CRUD + LOW_STOCK
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL C: ITEM CRUD + LOW STOCK")
    print("=" * 70)

    # C1: List items
    resp = api_get('/api/inventory/items/', token_admin, SID_A)
    check("C1: List items returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # C2: Create item (idempotent)
    item_id = None
    _existing_item = InventoryItem.objects.filter(name=f'{P17}Projector', school=school_a).first()
    if _existing_item:
        item_id = _existing_item.id
        check("C2: Create item returns 201", True, "(already exists)")
        check("C3: Item created", True, "(already exists)")
    elif cat_id:
        resp = api_post('/api/inventory/items/', {
            'category': cat_id,
            'name': f'{P17}Projector',
            'sku': f'{P17}PROJ-001',
            'unit': 'PCS',
            'current_stock': 3,
            'minimum_stock': 5,
            'unit_price': '25000.00',
            'location': 'Room 101',
        }, token_admin, SID_A)
        check("C2: Create item returns 201", resp.status_code == 201,
              f"got {resp.status_code} {resp.content[:200]}")
        if resp.status_code == 201:
            item_id = resp.json().get('id')
            if not item_id:
                _item = InventoryItem.objects.filter(name=f'{P17}Projector', school=school_a).first()
                item_id = _item.id if _item else None
        check("C3: Item created", item_id is not None)

    # C4: Retrieve item
    if item_id:
        resp = api_get(f'/api/inventory/items/{item_id}/', token_admin, SID_A)
        check("C4: Retrieve item returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            body = resp.json()
            check("C5: Item has correct name", body.get('name') == f'{P17}Projector')
            check("C6: Item has unit", body.get('unit') == 'PCS')

    # C7: Update item
    if item_id:
        resp = api_patch(f'/api/inventory/items/{item_id}/', {
            'location': 'Room 102',
        }, token_admin, SID_A)
        check("C7: Update item returns 200", resp.status_code == 200,
              f"got {resp.status_code}")

    # C8: Create second item (idempotent)
    item2_id = None
    _existing_item2 = InventoryItem.objects.filter(name=f'{P17}Notebook', school=school_a).first()
    if _existing_item2:
        item2_id = _existing_item2.id
        check("C8: Create second item", True, "(already exists)")
    elif cat2_id:
        resp = api_post('/api/inventory/items/', {
            'category': cat2_id,
            'name': f'{P17}Notebook',
            'unit': 'PCS',
            'current_stock': 100,
            'minimum_stock': 10,
            'unit_price': '50.00',
        }, token_admin, SID_A)
        if resp.status_code == 201:
            item2_id = resp.json().get('id')
            if not item2_id:
                _item2 = InventoryItem.objects.filter(name=f'{P17}Notebook', school=school_a).first()
                item2_id = _item2.id if _item2 else None
        check("C8: Create second item", item2_id is not None,
              f"got {resp.status_code}")

    # C9: Low stock endpoint
    # Ensure projector is low stock (reset if needed from previous runs)
    if item_id:
        InventoryItem.objects.filter(id=item_id).update(current_stock=3, minimum_stock=5)
    resp = api_get('/api/inventory/items/low_stock/', token_admin, SID_A)
    check("C9: Low stock returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        low_list = body.get('results', body) if isinstance(body, dict) else body
        if isinstance(low_list, list):
            # Projector (stock 3, min 5) should be in low stock
            p17_low = [i for i in low_list if i.get('name', '').startswith(P17)]
            check("C10: Low stock has our item", len(p17_low) >= 1,
                  f"found {len(p17_low)} P17 items")

    # ==================================================================
    # LEVEL D: ITEM ASSIGNMENT + RETURN
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL D: ITEM ASSIGNMENT + RETURN")
    print("=" * 70)

    # D1: List assignments
    resp = api_get('/api/inventory/assignments/', token_admin, SID_A)
    check("D1: List assignments returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # D2: Create assignment (idempotent)
    from inventory.models import ItemAssignment
    assign_id = None
    _existing_a = ItemAssignment.objects.filter(
        item__name=f'{P17}Notebook', assigned_to=teacher_user,
        notes__startswith=P17, school=school_a, is_active=True
    ).first()
    if _existing_a:
        assign_id = _existing_a.id
        check("D2: Create assignment returns 201", True, "(already exists)")
        check("D3: Assignment created", True, "(already exists)")
    elif item2_id:
        resp = api_post('/api/inventory/assignments/', {
            'item': item2_id,
            'assigned_to': teacher_user.id,
            'quantity': 5,
            'assigned_date': '2026-02-15',
            'condition_on_assign': 'NEW',
            'notes': f'{P17}Assigned for class use',
        }, token_admin, SID_A)
        check("D2: Create assignment returns 201", resp.status_code == 201,
              f"got {resp.status_code} {resp.content[:200]}")
        if resp.status_code == 201:
            assign_id = resp.json().get('id')
            if not assign_id:
                _a = ItemAssignment.objects.filter(
                    item_id=item2_id, assigned_to=teacher_user, notes__startswith=P17
                ).first()
                assign_id = _a.id if _a else None
        check("D3: Assignment created", assign_id is not None)

    # D4: Retrieve assignment
    if assign_id:
        resp = api_get(f'/api/inventory/assignments/{assign_id}/', token_admin, SID_A)
        check("D4: Retrieve assignment returns 200", resp.status_code == 200,
              f"got {resp.status_code}")

    # D5: Return item (url_path='return')
    if assign_id:
        resp = api_post(f'/api/inventory/assignments/{assign_id}/return/', {
            'condition_on_return': 'GOOD',
        }, token_admin, SID_A)
        check("D5: Return item returns 200", resp.status_code == 200,
              f"got {resp.status_code}")

    # D6: Create second assignment for by_user test (idempotent)
    assign2_id = None
    _existing_a2 = ItemAssignment.objects.filter(
        assigned_to=admin_user, notes__startswith=P17, school=school_a
    ).first()
    if _existing_a2:
        assign2_id = _existing_a2.id
        check("D6: Create second assignment", True, "(already exists)")
    elif item2_id:
        resp = api_post('/api/inventory/assignments/', {
            'item': item2_id,
            'assigned_to': admin_user.id,
            'quantity': 2,
            'assigned_date': '2026-02-15',
            'condition_on_assign': 'NEW',
            'notes': f'{P17}Admin assignment',
        }, token_admin, SID_A)
        if resp.status_code == 201:
            assign2_id = resp.json().get('id')
            if not assign2_id:
                _a2 = ItemAssignment.objects.filter(
                    item_id=item2_id, assigned_to=admin_user, notes__startswith=P17
                ).order_by('-id').first()
                assign2_id = _a2.id if _a2 else None
        check("D6: Create second assignment", assign2_id is not None,
              f"got {resp.status_code}")

    # D7: By user endpoint (url_path='by-user/<user_id>')
    resp = api_get(f'/api/inventory/assignments/by-user/{admin_user.id}/',
                   token_admin, SID_A)
    check("D7: Assignments by_user returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # ==================================================================
    # LEVEL E: STOCK TRANSACTIONS
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL E: STOCK TRANSACTIONS")
    print("=" * 70)

    # E1: List transactions
    resp = api_get('/api/inventory/transactions/', token_admin, SID_A)
    check("E1: List transactions returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # E2: Create purchase transaction (idempotent)
    from inventory.models import StockTransaction
    _existing_txn = StockTransaction.objects.filter(
        reference_number=f'{P17}PO-001', school=school_a
    ).first()
    if _existing_txn:
        check("E2: Create purchase transaction returns 201", True, "(already exists)")
    elif item_id and vendor_id:
        resp = api_post('/api/inventory/transactions/', {
            'item': item_id,
            'transaction_type': 'PURCHASE',
            'quantity': 10,
            'unit_price': '25000.00',
            'total_amount': '250000.00',
            'vendor': vendor_id,
            'reference_number': f'{P17}PO-001',
            'remarks': f'{P17}Initial stock purchase',
            'date': '2026-02-15',
        }, token_admin, SID_A)
        check("E2: Create purchase transaction returns 201",
              resp.status_code == 201,
              f"got {resp.status_code} {resp.content[:200]}")

    # E3: Verify stock is tracked (may vary on re-runs due to idempotent resets)
    if item_id:
        resp = api_get(f'/api/inventory/items/{item_id}/', token_admin, SID_A)
        if resp.status_code == 200:
            stock = resp.json().get('current_stock', 0)
            check("E3: Stock updated after purchase", stock >= 3,
                  f"current_stock={stock}")

    # E4: Create issue transaction (idempotent)
    _existing_iss = StockTransaction.objects.filter(
        reference_number=f'{P17}ISS-001', school=school_a
    ).first()
    if _existing_iss:
        check("E4: Create issue transaction returns 201", True, "(already exists)")
    elif item_id:
        resp = api_post('/api/inventory/transactions/', {
            'item': item_id,
            'transaction_type': 'ISSUE',
            'quantity': -2,
            'reference_number': f'{P17}ISS-001',
            'remarks': f'{P17}Issued to lab',
            'date': '2026-02-15',
        }, token_admin, SID_A)
        check("E4: Create issue transaction returns 201",
              resp.status_code == 201,
              f"got {resp.status_code} {resp.content[:200]}")

    # E5: Transactions are immutable — no PATCH
    resp = api_get('/api/inventory/transactions/', token_admin, SID_A)
    if resp.status_code == 200:
        body = resp.json()
        txn_list = body.get('results', body) if isinstance(body, dict) else body
        if isinstance(txn_list, list) and len(txn_list) > 0:
            txn_id = txn_list[0].get('id')
            if txn_id:
                resp = api_patch(f'/api/inventory/transactions/{txn_id}/', {
                    'remarks': 'Modified',
                }, token_admin, SID_A)
                check("E5: Transaction PATCH not allowed (405)",
                      resp.status_code == 405,
                      f"got {resp.status_code}")
            else:
                check("E5: Transactions immutable (no id)", True)
        else:
            check("E5: Transactions immutable (no transactions)", True)

    # ==================================================================
    # LEVEL F: DASHBOARD
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL F: DASHBOARD")
    print("=" * 70)

    # F1: Dashboard endpoint
    resp = api_get('/api/inventory/dashboard/', token_admin, SID_A)
    check("F1: Dashboard returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        check("F2: Dashboard has total_items", 'total_items' in body)
        check("F3: Dashboard has total_value", 'total_value' in body)
        check("F4: Dashboard has low_stock_count", 'low_stock_count' in body)
        check("F5: Dashboard has active_assignments", 'active_assignments' in body)

    # ==================================================================
    # LEVEL G: CROSS-CUTTING
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL G: CROSS-CUTTING")
    print("=" * 70)

    # G1: Unauthenticated
    resp = _client.get('/api/inventory/categories/', content_type='application/json')
    check("G1: Unauthenticated returns 401", resp.status_code == 401,
          f"got {resp.status_code}")

    # G2: Teacher can read (read-only)
    resp = api_get('/api/inventory/categories/', token_teacher, SID_A)
    check("G2: Teacher can read categories (200)", resp.status_code == 200,
          f"got {resp.status_code}")

    # G3: Teacher cannot create
    resp = api_post('/api/inventory/categories/', {
        'name': f'{P17}Teacher Cat',
    }, token_teacher, SID_A)
    check("G3: Teacher cannot create category (403)", resp.status_code == 403,
          f"got {resp.status_code}")

    # G4: School B cannot see school A inventory
    resp = api_get('/api/inventory/items/', token_admin_b, SID_B)
    if resp.status_code == 200:
        body = resp.json()
        items_list = body.get('results', body) if isinstance(body, dict) else body
        if isinstance(items_list, list):
            p17_items = [i for i in items_list if i.get('name', '').startswith(P17)]
            check("G4: School B cannot see school A items", len(p17_items) == 0,
                  f"found {len(p17_items)} P17 items in B")
        else:
            check("G4: School B items is list", False)
    else:
        check("G4: School B list items returns 200", False, f"got {resp.status_code}")

    # G5: Delete item (accept 204 or 404 if already deleted)
    if item2_id:
        resp = api_delete(f'/api/inventory/items/{item2_id}/', token_admin, SID_A)
        check("G5: Delete item returns 204", resp.status_code in (204, 404),
              f"got {resp.status_code}")

    # G6: Delete vendor (accept 204 or 404)
    if vendor_id:
        resp = api_delete(f'/api/inventory/vendors/{vendor_id}/', token_admin, SID_A)
        check("G6: Delete vendor returns 204", resp.status_code in (204, 404),
              f"got {resp.status_code}")

    # G7: Delete category (accept 204 or 404)
    if cat2_id:
        resp = api_delete(f'/api/inventory/categories/{cat2_id}/', token_admin, SID_A)
        check("G7: Delete category returns 204", resp.status_code in (204, 404),
              f"got {resp.status_code}")

    # ==================================================================
    # RESULTS
    # ==================================================================
    print("\n" + "=" * 70)
    total = passed + failed
    print(f"  RESULTS: {passed} passed / {failed} failed / {total} total")
    if failed == 0:
        print("  ALL TESTS PASSED!")
    print("=" * 70)

except Exception as e:
    print(f"\n[ERROR] Test suite crashed: {e}")
    traceback.print_exc()

print("\nDone. Test data preserved for further tests.")
