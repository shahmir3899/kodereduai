import numpy as np
from django.db import migrations

BATCH_SIZE = 500


def backfill_embedding_vector(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        # embedding_vector (pgvector) only exists on Postgres; local SQLite
        # dev environments have nothing to backfill.
        return

    StudentFaceEmbedding = apps.get_model('face_attendance', 'StudentFaceEmbedding')

    # Re-query each pass instead of .iterator() — the production DB is on
    # Supabase's transaction pooler, which doesn't support server-side
    # cursors (see DISABLE_SERVER_SIDE_CURSORS in settings.py).
    while True:
        batch = list(
            StudentFaceEmbedding.objects.filter(embedding_vector__isnull=True)
            .only('id', 'embedding')[:BATCH_SIZE]
        )
        if not batch:
            break
        for row in batch:
            vector = np.frombuffer(bytes(row.embedding), dtype=np.float64).astype(np.float32)
            row.embedding_vector = vector.tolist()
        StudentFaceEmbedding.objects.bulk_update(batch, ['embedding_vector'])


def noop_reverse(apps, schema_editor):
    # embedding (BinaryField) is left untouched by the forward migration,
    # so there's nothing to restore on reverse.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('face_attendance', '0002_add_embedding_vector'),
    ]

    operations = [
        migrations.RunPython(backfill_embedding_vector, noop_reverse),
    ]
