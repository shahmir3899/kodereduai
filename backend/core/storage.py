"""
Supabase storage service for file uploads.
"""

import logging
import uuid
from datetime import datetime
from django.conf import settings

logger = logging.getLogger(__name__)


class SupabaseStorageService:
    """
    Service for uploading files to Supabase Storage.
    """

    def __init__(self):
        self.url = settings.SUPABASE_URL
        self.key = settings.SUPABASE_KEY
        self.bucket = settings.SUPABASE_BUCKET
        self._client = None

    @property
    def client(self):
        """Lazy initialization of Supabase client."""
        if self._client is None:
            if not self.url or not self.key:
                raise Exception("Supabase credentials not configured")

            from supabase import create_client
            self._client = create_client(self.url, self.key)
        return self._client

    def is_configured(self) -> bool:
        """Check if Supabase is properly configured."""
        return bool(self.url and self.key and self.bucket)

    def upload_attendance_image(self, file, school_id: int, class_id: int) -> str:
        """
        Upload attendance image to Supabase Storage.

        Args:
            file: File object from request
            school_id: School ID for organizing files
            class_id: Class ID for organizing files

        Returns:
            str: Public URL of uploaded file
        """
        if not self.is_configured():
            raise Exception("Supabase storage not configured")

        # Generate unique filename
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        unique_id = str(uuid.uuid4())[:8]
        extension = file.name.split('.')[-1] if '.' in file.name else 'jpg'
        filename = f"attendance/{school_id}/{class_id}/{timestamp}_{unique_id}.{extension}"

        try:
            # Read file content
            file_content = file.read()

            # Get content type
            content_type = getattr(file, 'content_type', 'image/jpeg')

            # Upload to Supabase
            result = self.client.storage.from_(self.bucket).upload(
                path=filename,
                file=file_content,
                file_options={"content-type": content_type}
            )

            # Get public URL
            public_url = self.client.storage.from_(self.bucket).get_public_url(filename)

            logger.info(f"Uploaded attendance image: {filename}")
            return public_url

        except Exception as e:
            logger.error(f"Failed to upload to Supabase: {e}")
            raise Exception(f"Failed to upload image: {str(e)}")

    def delete_file(self, file_path: str) -> bool:
        """
        Delete a file from Supabase Storage.

        Args:
            file_path: Path of file to delete

        Returns:
            bool: True if deleted successfully
        """
        if not self.is_configured():
            return False

        try:
            self.client.storage.from_(self.bucket).remove([file_path])
            logger.info(f"Deleted file: {file_path}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete file: {e}")
            return False


# Singleton instance
storage_service = SupabaseStorageService()
