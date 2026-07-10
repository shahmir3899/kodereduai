import io
import unittest

from PIL import Image


class ProcessProfilePhotoTests(unittest.TestCase):
    """Pure function tests — no DB access, so these run even when the shared
    test database is unavailable/locked."""

    def _make_image_bytes(self, size, mode='RGB', fmt='PNG'):
        image = Image.new(mode, size, color=(200, 50, 50))
        buffer = io.BytesIO()
        image.save(buffer, format=fmt)
        return buffer.getvalue()

    def test_downscales_large_image(self):
        from core.storage import _process_profile_photo

        original = self._make_image_bytes((2000, 1500))
        processed = _process_profile_photo(original, max_dimension=480)

        result = Image.open(io.BytesIO(processed))
        self.assertEqual(result.format, 'JPEG')
        self.assertLessEqual(result.width, 480)
        self.assertLessEqual(result.height, 480)

    def test_small_image_not_upscaled(self):
        from core.storage import _process_profile_photo

        original = self._make_image_bytes((100, 100))
        processed = _process_profile_photo(original, max_dimension=480)

        result = Image.open(io.BytesIO(processed))
        self.assertEqual(result.size, (100, 100))

    def test_converts_rgba_to_rgb_jpeg(self):
        from core.storage import _process_profile_photo

        original = self._make_image_bytes((300, 300), mode='RGBA', fmt='PNG')
        processed = _process_profile_photo(original)

        result = Image.open(io.BytesIO(processed))
        self.assertEqual(result.format, 'JPEG')
        self.assertEqual(result.mode, 'RGB')

    def test_corrupt_image_raises_unidentified_image_error(self):
        from PIL import UnidentifiedImageError
        from core.storage import _process_profile_photo

        with self.assertRaises(UnidentifiedImageError):
            _process_profile_photo(b'not-an-image')
