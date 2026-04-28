from pathlib import Path

from django.conf import settings
from django.core.mail import EmailMessage
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Send a test careers email, optionally with an attachment, to verify SMTP delivery.'

    def add_arguments(self, parser):
        parser.add_argument('--to', dest='to', default='', help='Recipient email override')
        parser.add_argument('--subject', dest='subject', default='Test Career Application Email', help='Email subject')
        parser.add_argument('--body', dest='body', default='This is a test email for careers CV delivery setup.', help='Email body')
        parser.add_argument('--attachment', dest='attachment', default='', help='Optional path to attach a file')

    def handle(self, *args, **options):
        recipient = options['to'] or settings.CAREERS_EMAIL_RECIPIENT
        if not recipient:
            raise CommandError('No recipient configured. Set CAREERS_EMAIL_RECIPIENT or pass --to.')

        email = EmailMessage(
            subject=options['subject'],
            body=options['body'],
            from_email=settings.CAREERS_EMAIL_SENDER,
            to=[recipient],
        )

        attachment = options['attachment']
        if attachment:
            path = Path(attachment)
            if not path.exists() or not path.is_file():
                raise CommandError(f'Attachment not found: {path}')
            email.attach_file(str(path))

        try:
            sent = email.send(fail_silently=False)
        except Exception as exc:
            raise CommandError(f'Email send failed: {exc}') from exc

        if sent:
            self.stdout.write(self.style.SUCCESS(f'Test email sent to {recipient}'))
        else:
            raise CommandError('Email backend returned 0 sent messages.')
