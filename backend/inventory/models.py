"""
Inventory management models: categories, vendors, items, assignments, and stock transactions.
"""

from django.db import models
from django.db.models import F
from django.conf import settings


class InventoryCategory(models.Model):
    """Categories for inventory items (e.g., Stationery, Lab Equipment, Sports)."""
    school = models.ForeignKey(
        'schools.School', on_delete=models.CASCADE, related_name='inventory_categories',
    )
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, default='')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('school', 'name')
        ordering = ['name']
        verbose_name_plural = 'Inventory categories'

    def __str__(self):
        return self.name


class Vendor(models.Model):
    """Supplier/vendor for inventory purchases."""
    school = models.ForeignKey(
        'schools.School', on_delete=models.CASCADE, related_name='vendors',
    )
    name = models.CharField(max_length=200)
    contact_person = models.CharField(max_length=100, blank=True, default='')
    phone = models.CharField(max_length=20, blank=True, default='')
    email = models.EmailField(blank=True, default='')
    address = models.TextField(blank=True, default='')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'name')
        ordering = ['name']

    def __str__(self):
        return self.name


class InventoryItem(models.Model):
    """An item tracked in inventory (e.g., Whiteboard Marker, Microscope)."""
    UNIT_CHOICES = [
        ('PCS', 'Pieces'),
        ('PKT', 'Packets'),
        ('BOX', 'Boxes'),
        ('KG', 'Kilograms'),
        ('LTR', 'Litres'),
        ('SET', 'Sets'),
        ('REAM', 'Reams'),
        ('DZN', 'Dozens'),
        ('MTR', 'Meters'),
    ]

    school = models.ForeignKey(
        'schools.School', on_delete=models.CASCADE, related_name='inventory_items',
    )
    category = models.ForeignKey(
        InventoryCategory, on_delete=models.CASCADE, related_name='items',
    )
    name = models.CharField(max_length=200)
    sku = models.CharField(max_length=50, blank=True, default='', help_text='Optional stock code')
    unit = models.CharField(max_length=10, choices=UNIT_CHOICES, default='PCS')
    current_stock = models.IntegerField(default=0)
    minimum_stock = models.PositiveIntegerField(
        default=5, help_text='Alert when stock falls below this level',
    )
    unit_price = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text='Last known unit price',
    )
    location = models.CharField(
        max_length=100, blank=True, default='',
        help_text='Storage location e.g. "Store Room A", "Lab Cabinet 3"',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'name', 'category')
        ordering = ['name']
        indexes = [
            models.Index(fields=['school', 'category']),
        ]

    def __str__(self):
        return f"{self.name} ({self.current_stock} {self.get_unit_display()})"

    @property
    def is_low_stock(self):
        return self.current_stock <= self.minimum_stock

    @property
    def stock_value(self):
        return self.current_stock * self.unit_price


class ItemAssignment(models.Model):
    """Tracks items assigned to users (e.g., laptop to teacher, projector to lab)."""
    CONDITION_CHOICES = [
        ('NEW', 'New'),
        ('GOOD', 'Good'),
        ('FAIR', 'Fair'),
        ('POOR', 'Poor'),
    ]

    school = models.ForeignKey(
        'schools.School', on_delete=models.CASCADE, related_name='item_assignments',
    )
    item = models.ForeignKey(
        InventoryItem, on_delete=models.CASCADE, related_name='assignments',
    )
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='assigned_items',
        help_text='The person who has the item',
    )
    quantity = models.PositiveIntegerField(default=1)
    assigned_date = models.DateField()
    returned_date = models.DateField(null=True, blank=True)
    condition_on_assign = models.CharField(
        max_length=10, choices=CONDITION_CHOICES, default='GOOD',
    )
    condition_on_return = models.CharField(
        max_length=10, choices=CONDITION_CHOICES, blank=True, default='',
    )
    notes = models.TextField(blank=True, default='')
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='inventory_assignments_made',
    )
    is_active = models.BooleanField(default=True, help_text='True while assigned, False after returned')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['school', 'assigned_to']),
            models.Index(fields=['school', 'item']),
        ]

    def __str__(self):
        return f"{self.item.name} -> {self.assigned_to.username} (x{self.quantity})"


class StockTransaction(models.Model):
    """Every stock movement: purchase, issue, return, adjustment, disposal."""
    TRANSACTION_TYPES = [
        ('PURCHASE', 'Purchase'),
        ('ISSUE', 'Issue'),
        ('RETURN', 'Return'),
        ('ADJUSTMENT', 'Adjustment'),
        ('DISPOSAL', 'Disposal'),
    ]

    school = models.ForeignKey(
        'schools.School', on_delete=models.CASCADE, related_name='stock_transactions',
    )
    item = models.ForeignKey(
        InventoryItem, on_delete=models.CASCADE, related_name='transactions',
    )
    transaction_type = models.CharField(max_length=20, choices=TRANSACTION_TYPES)
    quantity = models.IntegerField(help_text='Positive for stock in, negative for stock out')
    unit_price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    vendor = models.ForeignKey(
        Vendor, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='transactions', help_text='Only for PURCHASE transactions',
    )
    assignment = models.ForeignKey(
        ItemAssignment, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='transactions', help_text='Link to assignment for ISSUE/RETURN',
    )
    reference_number = models.CharField(
        max_length=100, blank=True, default='',
        help_text='Invoice/PO/receipt number',
    )
    remarks = models.TextField(blank=True, default='')
    date = models.DateField()
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date', '-created_at']
        indexes = [
            models.Index(fields=['school', 'item', '-date']),
            models.Index(fields=['school', 'transaction_type']),
        ]

    def __str__(self):
        return f"{self.get_transaction_type_display()}: {self.item.name} ({self.quantity:+d})"

    def save(self, *args, **kwargs):
        """Auto-calculate total_amount and update item stock."""
        if not self.total_amount:
            self.total_amount = abs(self.quantity) * self.unit_price

        is_new = self.pk is None
        super().save(*args, **kwargs)

        if is_new:
            InventoryItem.objects.filter(pk=self.item_id).update(
                current_stock=F('current_stock') + self.quantity,
            )
