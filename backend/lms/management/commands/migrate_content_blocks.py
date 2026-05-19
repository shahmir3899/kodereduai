import json

from django.core.management.base import BaseCommand
from django.db import transaction

from lms.models import Chapter, ContentBlock, Topic


LEGACY_BLOCK_TYPE_MAP = {
    'paragraph': ContentBlock.BlockType.TEXT,
    'heading': ContentBlock.BlockType.KEY_POINT,
    'note': ContentBlock.BlockType.KEY_POINT,
    'list': ContentBlock.BlockType.SUMMARY,
    'exercise': ContentBlock.BlockType.EXERCISE,
    'table': ContentBlock.BlockType.DIAGRAM_DESC,
    'image': ContentBlock.BlockType.DIAGRAM_DESC,
    'code': ContentBlock.BlockType.EXAMPLE,
    'quote': ContentBlock.BlockType.EXAMPLE,
    'definition': ContentBlock.BlockType.DEFINITION,
    'example': ContentBlock.BlockType.EXAMPLE,
    'formula': ContentBlock.BlockType.FORMULA,
    'diagram_desc': ContentBlock.BlockType.DIAGRAM_DESC,
    'summary': ContentBlock.BlockType.SUMMARY,
    'key_point': ContentBlock.BlockType.KEY_POINT,
    'text': ContentBlock.BlockType.TEXT,
}


def _flatten_value(value):
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, list):
        parts = []
        for item in value:
            parts.extend(_flatten_value(item))
        return parts
    return []


def _extract_block_text(block):
    if not isinstance(block, dict):
        return str(block).strip()

    parts = []
    for key in ('text', 'question', 'answer', 'caption', 'alt', 'title', 'content'):
        parts.extend(_flatten_value(block.get(key)))

    if not parts:
        for value in block.values():
            parts.extend(_flatten_value(value))

    return '\n'.join(parts).strip()


def _normalize_block_type(block):
    raw_type = str((block or {}).get('type') or 'text').strip().lower()
    return LEGACY_BLOCK_TYPE_MAP.get(raw_type, ContentBlock.BlockType.TEXT)


class Command(BaseCommand):
    help = 'Explode legacy chapter/topic content_blocks JSON into relational ContentBlock rows.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Preview migrated ContentBlock rows without writing to the database.',
        )

    def handle(self, *args, **options):
        dry_run = options.get('dry_run', False)
        created = 0
        skipped = 0
        errors = 0

        chapter_qs = Chapter.objects.filter(is_active=True).exclude(content_blocks=[]).only('id', 'content_blocks')
        topic_qs = Topic.objects.filter(is_active=True).exclude(content_blocks=[]).only('id', 'content_blocks')

        self.stdout.write(f'Chapters to inspect: {chapter_qs.count()}')
        self.stdout.write(f'Topics to inspect: {topic_qs.count()}')

        def migrate_parent(parent, parent_field_name):
            nonlocal created, skipped, errors

            blocks = parent.content_blocks or []
            if not isinstance(blocks, list):
                errors += 1
                self.stdout.write(self.style.WARNING(
                    f'{parent_field_name}:{parent.id} skipped invalid content_blocks payload (expected list).'
                ))
                return

            for index, block in enumerate(blocks):
                try:
                    block_type = _normalize_block_type(block if isinstance(block, dict) else {})
                    content_text = _extract_block_text(block)
                    content_rich = block if isinstance(block, dict) else {'raw_value': block}

                    if not content_text and not content_rich:
                        skipped += 1
                        continue

                    lookup = {
                        parent_field_name: parent,
                        'sequence_order': index,
                        'block_type': block_type,
                        'content_text': content_text,
                    }

                    if ContentBlock.objects.filter(**lookup).exists():
                        skipped += 1
                        continue

                    if dry_run:
                        created += 1
                        continue

                    with transaction.atomic():
                        ContentBlock.objects.create(
                            **lookup,
                            content_rich=content_rich,
                            is_ai_generated=False,
                            is_active=True,
                        )
                    created += 1
                except Exception as exc:
                    errors += 1
                    self.stdout.write(self.style.WARNING(
                        f'{parent_field_name}:{parent.id} block#{index} error: {exc}'
                    ))

        for chapter in chapter_qs.iterator():
            migrate_parent(chapter, 'chapter')

        for topic in topic_qs.iterator():
            migrate_parent(topic, 'topic')

        summary = f'Created: {created} | Skipped: {skipped} | Errors: {errors}'
        if dry_run:
            self.stdout.write(self.style.NOTICE(f'[DRY RUN] {summary}'))
        else:
            self.stdout.write(self.style.SUCCESS(summary))