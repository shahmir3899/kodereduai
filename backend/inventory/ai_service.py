"""
AI Inventory Suggestion Service using Groq LLM.

Given optional context (e.g., "science lab", "sports equipment"), generates
suggested inventory categories and items for a school.

Uses the same Groq integration pattern as backend/lms/ai_generator.py.
"""

import json
import logging

from django.conf import settings

logger = logging.getLogger(__name__)


INVENTORY_SUGGEST_PROMPT = """You are a school inventory management expert. Suggest inventory categories and items for a school.

## Context
School: {school_name}
User request: {user_context}

## Existing Categories (avoid duplicates)
{existing_categories}

## Existing Items (avoid duplicates)
{existing_items}

## Instructions
Suggest 3-6 inventory categories and 10-20 items that a school would typically need.
- If the user provided a specific context (e.g., "science lab"), focus suggestions on that area
- If no context, suggest general school inventory essentials
- Do NOT suggest categories or items that already exist (listed above)
- Use realistic prices in PKR (Pakistani Rupees)
- Each item must reference a category_name from either your suggested categories OR the existing ones
- Use unit values from: PCS, PKT, BOX, KG, LTR, SET, REAM, DZN, MTR

## Output Format (JSON only, no markdown fences)
{{
  "categories": [
    {{"name": "Category Name", "description": "Brief description"}}
  ],
  "items": [
    {{
      "name": "Item Name",
      "category_name": "Category Name",
      "unit": "PCS",
      "minimum_stock": 10,
      "unit_price": 250.00
    }}
  ]
}}"""


FALLBACK_SUGGESTIONS = {
    "categories": [
        {"name": "Stationery", "description": "Pens, pencils, papers, and writing supplies"},
        {"name": "Cleaning Supplies", "description": "Cleaning materials and maintenance items"},
        {"name": "Classroom Furniture", "description": "Desks, chairs, and classroom fixtures"},
        {"name": "Technology", "description": "Computers, projectors, and electronic equipment"},
        {"name": "Sports Equipment", "description": "Sports gear and physical education items"},
    ],
    "items": [
        {"name": "Whiteboard Marker", "category_name": "Stationery", "unit": "PCS", "minimum_stock": 50, "unit_price": 80.00},
        {"name": "A4 Paper Ream", "category_name": "Stationery", "unit": "REAM", "minimum_stock": 20, "unit_price": 850.00},
        {"name": "Ballpoint Pen (Blue)", "category_name": "Stationery", "unit": "DZN", "minimum_stock": 10, "unit_price": 240.00},
        {"name": "Chalk Box (White)", "category_name": "Stationery", "unit": "BOX", "minimum_stock": 15, "unit_price": 120.00},
        {"name": "Floor Cleaner", "category_name": "Cleaning Supplies", "unit": "LTR", "minimum_stock": 10, "unit_price": 350.00},
        {"name": "Dust Bin", "category_name": "Cleaning Supplies", "unit": "PCS", "minimum_stock": 10, "unit_price": 500.00},
        {"name": "Broom", "category_name": "Cleaning Supplies", "unit": "PCS", "minimum_stock": 10, "unit_price": 250.00},
        {"name": "Student Desk", "category_name": "Classroom Furniture", "unit": "PCS", "minimum_stock": 5, "unit_price": 3500.00},
        {"name": "Student Chair", "category_name": "Classroom Furniture", "unit": "PCS", "minimum_stock": 5, "unit_price": 2500.00},
        {"name": "Teacher Desk", "category_name": "Classroom Furniture", "unit": "PCS", "minimum_stock": 2, "unit_price": 8000.00},
        {"name": "Whiteboard (4x3 ft)", "category_name": "Classroom Furniture", "unit": "PCS", "minimum_stock": 2, "unit_price": 3000.00},
        {"name": "Projector", "category_name": "Technology", "unit": "PCS", "minimum_stock": 1, "unit_price": 45000.00},
        {"name": "Computer Mouse", "category_name": "Technology", "unit": "PCS", "minimum_stock": 5, "unit_price": 600.00},
        {"name": "Cricket Bat", "category_name": "Sports Equipment", "unit": "PCS", "minimum_stock": 5, "unit_price": 1500.00},
        {"name": "Football", "category_name": "Sports Equipment", "unit": "PCS", "minimum_stock": 5, "unit_price": 1200.00},
    ],
}


def suggest_inventory_items(school, user_context=''):
    """
    Generate suggested inventory categories and items using Groq LLM.

    Args:
        school: School instance
        user_context: Optional string describing what kind of items to suggest

    Returns:
        dict with 'success' flag and suggested categories/items
    """
    from .models import InventoryCategory, InventoryItem

    existing_cats = list(
        InventoryCategory.objects.filter(school=school, is_active=True)
        .values_list('name', flat=True)
    )
    existing_items_list = list(
        InventoryItem.objects.filter(school=school, is_active=True)
        .values_list('name', flat=True)[:50]
    )

    if not getattr(settings, 'GROQ_API_KEY', None):
        return _filtered_fallback(existing_cats, existing_items_list)

    try:
        from groq import Groq

        client = Groq(api_key=settings.GROQ_API_KEY)

        existing_categories_text = ', '.join(existing_cats) if existing_cats else 'None yet'
        existing_items_text = ', '.join(existing_items_list) if existing_items_list else 'None yet'

        prompt = INVENTORY_SUGGEST_PROMPT.format(
            school_name=school.name,
            user_context=user_context or 'General school inventory essentials',
            existing_categories=existing_categories_text,
            existing_items=existing_items_text,
        )

        model_name = getattr(settings, 'GROQ_MODEL', 'llama-3.3-70b-versatile')

        response = client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
            max_tokens=2000,
        )

        result_text = response.choices[0].message.content

        if "```json" in result_text:
            result_text = result_text.split("```json")[1].split("```")[0]
        elif "```" in result_text:
            result_text = result_text.split("```")[1].split("```")[0]

        result = json.loads(result_text.strip())

        return {
            'success': True,
            'categories': result.get('categories', []),
            'items': result.get('items', []),
        }

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse AI inventory suggestion response: {e}")
        return _filtered_fallback(existing_cats, existing_items_list)

    except Exception as e:
        logger.error(f"AI inventory suggestion failed: {e}")
        return _filtered_fallback(existing_cats, existing_items_list)


def _filtered_fallback(existing_cats, existing_items_list):
    """Return fallback suggestions filtered to exclude existing data."""
    existing_cats_lower = {c.lower() for c in existing_cats}
    existing_items_lower = {i.lower() for i in existing_items_list}

    categories = [
        c for c in FALLBACK_SUGGESTIONS['categories']
        if c['name'].lower() not in existing_cats_lower
    ]
    items = [
        i for i in FALLBACK_SUGGESTIONS['items']
        if i['name'].lower() not in existing_items_lower
    ]

    return {
        'success': True,
        'categories': categories,
        'items': items,
        'is_fallback': True,
    }
