"""Run DB-backed async job worker."""

import time

from django.core.management.base import BaseCommand

from core.job_queue import claim_next_job, execute_job, requeue_stale_running_jobs


class Command(BaseCommand):
    help = 'Run DB-backed queued jobs (replacement worker for Celery path).'

    def add_arguments(self, parser):
        parser.add_argument('--once', action='store_true', help='Process at most one available job and exit.')
        parser.add_argument('--max-jobs', type=int, default=0, help='Process up to N jobs, then exit (0 = unlimited).')
        parser.add_argument('--sleep-seconds', type=float, default=2.0, help='Sleep interval between polling attempts.')
        parser.add_argument('--lease-seconds', type=int, default=300, help='Lease duration for claimed running jobs.')

    def handle(self, *args, **options):
        once = options['once']
        max_jobs = int(options['max_jobs'] or 0)
        sleep_seconds = float(options['sleep_seconds'])
        lease_seconds = int(options['lease_seconds'])

        processed = 0
        self.stdout.write('DB job worker started')

        while True:
            stale_count = requeue_stale_running_jobs()
            if stale_count:
                self.stdout.write(self.style.WARNING(f'Re-queued {stale_count} stale running job(s).'))

            job = claim_next_job(lease_seconds=lease_seconds)
            if not job:
                if once:
                    self.stdout.write('No pending jobs found.')
                    return

                if max_jobs and processed >= max_jobs:
                    self.stdout.write(self.style.SUCCESS(f'Processed {processed} job(s). Exiting.'))
                    return

                time.sleep(sleep_seconds)
                continue

            self.stdout.write(f'Processing job #{job.id} ({job.callable_path})')
            ok = execute_job(job)
            processed += 1

            if ok:
                self.stdout.write(self.style.SUCCESS(f'Job #{job.id} finished successfully.'))
            else:
                self.stdout.write(self.style.WARNING(f'Job #{job.id} failed; queued status updated.'))

            if once:
                return
            if max_jobs and processed >= max_jobs:
                self.stdout.write(self.style.SUCCESS(f'Processed {processed} job(s). Exiting.'))
                return
