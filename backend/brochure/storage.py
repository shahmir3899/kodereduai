import os

from django.core.exceptions import ImproperlyConfigured
from django.core.files.base import ContentFile
from django.core.files.storage import Storage
from django.utils.deconstruct import deconstructible

from core.storage import storage_service


@deconstructible
class CareerCVSupabaseStorage(Storage):
    """Store career CV files in Supabase bucket under files/ prefix."""

    def _normalize(self, name: str) -> str:
        return name.replace('\\', '/').lstrip('/').strip()

    def _save(self, name, content):
        if not storage_service.is_configured():
            raise ImproperlyConfigured('Supabase storage is not configured for career CV uploads.')

        path = self._normalize(name)
        file_bytes = content.read()
        content_type = getattr(content, 'content_type', 'application/octet-stream')

        storage_service.client.storage.from_(storage_service.bucket).upload(
            path=path,
            file=file_bytes,
            file_options={'content-type': content_type},
        )

        return path

    def _open(self, name, mode='rb'):
        path = self._normalize(name)
        data = storage_service.client.storage.from_(storage_service.bucket).download(path)
        return ContentFile(data, name=os.path.basename(path))

    def exists(self, name):
        # Paths are generated uniquely in upload_to.
        return False

    def url(self, name):
        path = self._normalize(name)
        return storage_service.client.storage.from_(storage_service.bucket).get_public_url(path)

    def delete(self, name):
        path = self._normalize(name)
        storage_service.delete_file(path)
