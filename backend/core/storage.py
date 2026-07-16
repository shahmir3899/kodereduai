"""
Supabase storage service for file uploads.
"""

import logging
import uuid
from datetime import datetime
from django.conf import settings

logger = logging.getLogger(__name__)

PHOTO_ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp']
PHOTO_MAX_SIZE_BYTES = 5 * 1024 * 1024


def validate_photo_upload(file):
    """
    Validate a profile-photo upload's content type and size.
    Raises ValueError with a user-facing message if invalid.
    """
    if file.content_type not in PHOTO_ALLOWED_CONTENT_TYPES:
        raise ValueError(
            f'Invalid file type. Allowed: {", ".join(PHOTO_ALLOWED_CONTENT_TYPES)}'
        )
    if file.size > PHOTO_MAX_SIZE_BYTES:
        raise ValueError('File too large. Maximum size is 5MB.')


def _process_profile_photo(file_content: bytes, max_dimension: int = 480, quality: int = 85) -> bytes:
    """
    Normalize a profile photo upload: respect camera EXIF orientation, convert to
    RGB, and downscale to at most max_dimension on the long edge. Always returns
    JPEG bytes so callers don't need to track the source format/extension.
    """
    import io
    from PIL import Image, ImageOps

    image = Image.open(io.BytesIO(file_content))
    image = ImageOps.exif_transpose(image)
    if image.mode != 'RGB':
        image = image.convert('RGB')
    image.thumbnail((max_dimension, max_dimension), Image.LANCZOS)

    output = io.BytesIO()
    image.save(output, format='JPEG', quality=quality, optimize=True)
    return output.getvalue()


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
        """Lazy initialization of Supabase client with extended httpx timeout."""
        if self._client is None:
            if not self.url or not self.key:
                raise Exception("Supabase credentials not configured")

            from supabase import create_client
            import httpx
            
            # Create httpx client with 120s timeout for large file uploads
            # (default is 30s which is too short for Render→Supabase network latency)
            http_client = httpx.Client(timeout=120.0)
            
            # Create Supabase client and inject custom httpx client
            self._client = create_client(self.url, self.key)
            # Replace the internal httpx client with our longer-timeout version
            if hasattr(self._client, '_client'):
                self._client._client = http_client
            elif hasattr(self._client.storage, '_client'):
                self._client.storage._client = http_client
                
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

            logger.info(f"Starting upload to Supabase: {filename} ({len(file_content)} bytes)")

            # Upload to Supabase
            # The httpx client now has 120s timeout to handle Render→Supabase latency
            result = self.client.storage.from_(self.bucket).upload(
                path=filename,
                file=file_content,
                file_options={"content-type": content_type}
            )

            # Get public URL
            public_url = self.client.storage.from_(self.bucket).get_public_url(filename)

            logger.info(f"Successfully uploaded attendance image: {filename} → {public_url}")
            return public_url

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Failed to upload to Supabase: {error_msg}")
            raise Exception(f"Failed to upload image: {error_msg}")

    def upload_school_asset(self, file, school_id: int, asset_type: str) -> str:
        """
        Upload a school asset (logo or letterhead) to Supabase Storage.

        Args:
            file: File object from request
            school_id: School ID for organizing files
            asset_type: One of 'logo' or 'letterhead'

        Returns:
            str: Public URL of uploaded file
        """
        if not self.is_configured():
            raise Exception("Supabase storage not configured")

        if asset_type not in ('logo', 'letterhead'):
            raise ValueError(f"Invalid asset type: {asset_type}")

        extension = file.name.split('.')[-1].lower() if '.' in file.name else 'png'
        filename = f"school-assets/{school_id}/{asset_type}.{extension}"

        try:
            file_content = file.read()
            content_type = getattr(file, 'content_type', 'image/png')

            logger.info(f"Uploading school asset: {filename} ({len(file_content)} bytes)")

            # Try to remove existing file first (may not exist, that's OK)
            try:
                self.client.storage.from_(self.bucket).remove([filename])
            except Exception:
                pass

            self.client.storage.from_(self.bucket).upload(
                path=filename,
                file=file_content,
                file_options={"content-type": content_type}
            )

            public_url = self.client.storage.from_(self.bucket).get_public_url(filename)
            logger.info(f"Successfully uploaded school asset: {filename}")
            return public_url

        except Exception as e:
            logger.error(f"Failed to upload school asset: {e}")
            raise Exception(f"Failed to upload {asset_type}: {e}")

    def _upload_profile_photo(self, file, filename: str) -> str:
        """
        Shared implementation for profile-style photo uploads: resize/normalize,
        overwrite any existing file at the given path, and return the public URL.

        Let decode errors (e.g. UnidentifiedImageError) propagate as-is so callers
        can distinguish "bad image" (400) from storage failures (500).
        """
        if not self.is_configured():
            raise Exception("Supabase storage not configured")

        file_content = _process_profile_photo(file.read())

        try:
            logger.info(f"Uploading profile photo: {filename} ({len(file_content)} bytes)")

            # Try to remove existing file first (may not exist, that's OK)
            try:
                self.client.storage.from_(self.bucket).remove([filename])
            except Exception:
                pass

            self.client.storage.from_(self.bucket).upload(
                path=filename,
                file=file_content,
                file_options={"content-type": "image/jpeg"}
            )

            public_url = self.client.storage.from_(self.bucket).get_public_url(filename)
            logger.info(f"Successfully uploaded profile photo: {filename}")
            return public_url

        except Exception as e:
            logger.error(f"Failed to upload profile photo {filename}: {e}")
            raise Exception(f"Failed to upload photo: {e}")

    def upload_student_photo(self, file, school_id: int, student_id: int) -> str:
        """
        Upload a student profile photo to Supabase Storage.

        Args:
            file: File object from request
            school_id: School ID for organizing files
            student_id: Student ID — file overwrites in place on re-upload

        Returns:
            str: Public URL of uploaded file
        """
        # Output is always a resized JPEG, so the stored filename is always .jpg
        # regardless of what the client uploaded.
        return self._upload_profile_photo(file, f"students/{school_id}/{student_id}.jpg")

    def upload_user_photo(self, file, user_id: int) -> str:
        """
        Upload a user account's avatar to Supabase Storage.

        Args:
            file: File object from request
            user_id: User ID — file overwrites in place on re-upload

        Returns:
            str: Public URL of uploaded file
        """
        # User.school is a nullable/deprecated legacy field (users can belong to
        # multiple schools via memberships), so the path is keyed by user_id only.
        return self._upload_profile_photo(file, f"users/{user_id}.jpg")

    def upload_staff_photo(self, file, school_id: int, staff_id: int) -> str:
        """
        Upload an HR staff member's photo to Supabase Storage.

        Args:
            file: File object from request
            school_id: School ID for organizing files
            staff_id: StaffMember ID — file overwrites in place on re-upload

        Returns:
            str: Public URL of uploaded file
        """
        return self._upload_profile_photo(file, f"staff/{school_id}/{staff_id}.jpg")

    def _extract_storage_path(self, public_url: str):
        """Extract the storage path from a Supabase public URL."""
        if not public_url:
            return None
        marker = f"/object/public/{self.bucket}/"
        idx = public_url.find(marker)
        if idx == -1:
            return None
        return public_url[idx + len(marker):]

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
