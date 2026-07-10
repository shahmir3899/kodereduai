from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count

from finance.models import FeePayment


class Command(BaseCommand):
    help = (
        "Audit fee-payment duplicates for MONTHLY/ANNUAL excluding NULL students. "
        "Exits with code 1 if duplicates are found."
    )

    def handle(self, *args, **options):
        monthly = list(
            FeePayment.objects.filter(
                fee_type='MONTHLY',
                student_id__isnull=False,
            )
            .values('school_id', 'student_id', 'year', 'month', 'monthly_category_id')
            .annotate(c=Count('id'))
            .filter(c__gt=1)
            .order_by('school_id', 'student_id', 'year', 'month', 'monthly_category_id')
        )

        annual = list(
            FeePayment.objects.filter(
                fee_type='ANNUAL',
                student_id__isnull=False,
            )
            .values('school_id', 'student_id', 'year', 'annual_category_id')
            .annotate(c=Count('id'))
            .filter(c__gt=1)
            .order_by('school_id', 'student_id', 'year', 'annual_category_id')
        )

        self.stdout.write(f"MONTHLY_NON_NULL_DUPLICATES={len(monthly)}")
        for row in monthly:
            self.stdout.write(str(row))

        self.stdout.write(f"ANNUAL_NON_NULL_DUPLICATES={len(annual)}")
        for row in annual:
            self.stdout.write(str(row))

        if monthly or annual:
            raise CommandError('Duplicate fee rows detected (excluding NULL students).')

        self.stdout.write(self.style.SUCCESS('No duplicates found (excluding NULL students).'))
