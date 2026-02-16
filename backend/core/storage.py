"""
Supabase storage service for file uploads.
"""

import logging
import uuid
import time
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
        """Lazy initialization of Supabase client with extended timeouts."""
        if self._client is None:
            if not self.url or not self.key:
                raise Exception("Supabase credentials not configured")

            from supabase import create_client
            # Create client with custom config for longer timeouts
            self._client = create_client(self.url, self.key)
            
            # Increase timeout for HTTP requests (default is often 5-10s)
            if hasattr(self._client, '_client_options'):
                self._client._client_options['timeout'] = 60  # 60 second timeout
            
        return self._client

    def is_configured(self) -> bool:
        """Check if Supabase is properly configured."""
        return bool(self.url and self.key and self.bucket)

    def upload_attendance_image(self, file, school_id: int, class_id: int) -> str:
        """
        Upload attendance image to Supabase Storage with retry logic.

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

        # Retry logic: attempt upload up to 3 times with exponential backoff
        max_retries = 3
        for attempt in range(max_retries):
            try:
                # Read file content
                file_content = file.read()
                # Reset file pointer for potential retries
                file.seek(0)

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
                error_msg = str(e)
                logger.warning(f"Upload attempt {attempt + 1}/{max_retries} failed: {error_msg}")
                
                # If this was the last attempt, raise the exception
                if attempt == max_retries - 1:
                    logger.error(f"Failed to upload to Supabase after {max_retries} attempts: {error_msg}")
                    raise Exception(f"Failed to upload image after retries: {error_msg}")
                
                # Exponential backoff: wait 2s, 4s, 8s between retries
                wait_time = 2 ** (attempt + 1)
                logger.info(f"Retrying upload in {wait_time}s...")
                time.sleep(wait_time)
        
        raise Exception("Upload failed - max retries exceeded")

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
