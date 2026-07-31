"""
AI Inventory Reorder Prediction Service.

Trends recent consumption (ISSUE / negative-quantity StockTransactions) per
item using the same weighted-slope technique as AttendanceRiskService, and
projects days-until-stockout to flag items to reorder soon.
"""

import logging
from collections import defaultdict
from datetime import date, timedelta

logger = logging.getLogger(__name__)

# Minimum weeks of consumption data required before trending a projection —
# below this, only the static is_low_stock flag applies.
MIN_WEEKS_WITH_DATA = 2

CONSUMPTION_WINDOW_DAYS = 60


class ReorderPredictionService:
    """Identifies inventory items likely to stock out soon."""

    def __init__(self, school_id: int):
        self.school_id = school_id

    def get_items_to_reorder(self, lookahead_days: int = 14) -> dict:
        from .models import InventoryItem, StockTransaction

        items = InventoryItem.objects.filter(
            school_id=self.school_id,
            is_active=True,
        ).select_related('category')

        total_items = items.count()
        if total_items == 0:
            return {
                'total_items': 0,
                'at_risk_count': 0,
                'risk_levels': {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0},
                'items': [],
            }

        item_ids = list(items.values_list('id', flat=True))
        item_map = {i.id: i for i in items}

        today = date.today()
        window_start = today - timedelta(days=CONSUMPTION_WINDOW_DAYS)

        transactions = StockTransaction.objects.filter(
            school_id=self.school_id,
            item_id__in=item_ids,
            transaction_type='ISSUE',
            date__gte=window_start,
            date__lte=today,
        ).values_list('item_id', 'date', 'quantity')

        item_weekly = defaultdict(lambda: defaultdict(int))
        for item_id, txn_date, quantity in transactions:
            week_index = (today - txn_date).days // 7
            item_weekly[item_id][week_index] += abs(quantity)

        at_risk_items = []
        risk_counts = {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0}

        for item_id in item_ids:
            item = item_map[item_id]
            weekly_buckets = item_weekly.get(item_id, {})
            weeks_with_data = len(weekly_buckets)

            avg_weekly_consumption = None
            trend = 'stable'
            if weeks_with_data >= MIN_WEEKS_WITH_DATA:
                num_weeks = CONSUMPTION_WINDOW_DAYS // 7
                ordered_weekly = [weekly_buckets.get(w, 0) for w in range(num_weeks - 1, -1, -1)]
                avg_weekly_consumption = sum(ordered_weekly) / num_weeks
                slope = self._weighted_trend_slope(ordered_weekly)
                total_change = slope * (len(ordered_weekly) - 1)
                if total_change > avg_weekly_consumption * 0.5 and avg_weekly_consumption > 0:
                    trend = 'rising'
                elif total_change < -avg_weekly_consumption * 0.5:
                    trend = 'falling'

            days_until_stockout = None
            if avg_weekly_consumption and avg_weekly_consumption > 0:
                days_until_stockout = round(item.current_stock / avg_weekly_consumption * 7, 1)

            severity = self._determine_severity(item, days_until_stockout, trend, lookahead_days)
            if severity is None:
                continue

            suggested_action = self._suggest_action(severity, item, days_until_stockout)

            at_risk_items.append({
                'item_id': item_id,
                'item_name': item.name,
                'category_name': item.category.name if item.category else '',
                'current_stock': item.current_stock,
                'minimum_stock': item.minimum_stock,
                'avg_weekly_consumption': round(avg_weekly_consumption, 1) if avg_weekly_consumption else None,
                'consumption_trend': trend,
                'days_until_stockout': days_until_stockout,
                'severity': severity,
                'suggested_action': suggested_action,
            })

            risk_counts[severity] += 1

        severity_order = {'HIGH': 0, 'MEDIUM': 1, 'LOW': 2}
        at_risk_items.sort(
            key=lambda i: (
                severity_order.get(i['severity'], 3),
                i['days_until_stockout'] if i['days_until_stockout'] is not None else float('inf'),
            )
        )

        return {
            'total_items': total_items,
            'at_risk_count': len(at_risk_items),
            'risk_levels': risk_counts,
            'items': at_risk_items,
        }

    def _weighted_trend_slope(self, values: list) -> float:
        """Weighted least-squares slope, recent weeks weighted more — same technique as AttendanceRiskService."""
        n = len(values)
        if n < 2:
            return 0.0

        xs = list(range(n))
        weights = [i + 1 for i in range(n)]
        total_weight = sum(weights)
        x_mean = sum(w * x for w, x in zip(weights, xs)) / total_weight
        y_mean = sum(w * y for w, y in zip(weights, values)) / total_weight

        numerator = sum(w * (x - x_mean) * (y - y_mean) for w, x, y in zip(weights, xs, values))
        denominator = sum(w * (x - x_mean) ** 2 for w, x in zip(weights, xs))

        return numerator / denominator if denominator else 0.0

    def _determine_severity(self, item, days_until_stockout, trend: str, lookahead_days: int) -> str | None:
        if item.is_low_stock:
            return 'HIGH'

        if days_until_stockout is None:
            return None

        if days_until_stockout <= 3:
            return 'HIGH'

        if days_until_stockout <= lookahead_days:
            return 'MEDIUM'

        if trend == 'rising':
            return 'LOW'

        return None

    def _suggest_action(self, severity: str, item, days_until_stockout) -> str:
        if severity == 'HIGH':
            if item.is_low_stock:
                return f'Reorder immediately - already at or below minimum stock ({item.current_stock} {item.get_unit_display()})'
            return f'Reorder immediately - projected to stock out in {days_until_stockout} days'

        if severity == 'MEDIUM':
            return f'Plan reorder within {int(days_until_stockout)} days'

        return 'Consumption trending up - monitor, may need reorder soon'
