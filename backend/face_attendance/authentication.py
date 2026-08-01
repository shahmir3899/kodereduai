"""
Device-key authentication for Fixed Camera capture on-prem devices.

Isolated on purpose (design doc §4): on-prem devices have no user account,
so this does not touch the JWT/session auth or IsSchoolAdmin machinery used
everywhere else in the app. Only face_attendance's live-ingest endpoint
uses this.
"""

from django.contrib.auth.models import AnonymousUser
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission

from .models import FaceCaptureDevice


class DeviceKeyAuthentication(BaseAuthentication):
    """
    Authenticates a request via the X-Device-Key header.

    On success, sets request.user to an AnonymousUser (no human account is
    involved) and request.auth to the FaceCaptureDevice instance — views
    and permissions should read the device from request.auth, not
    request.user.
    """

    def authenticate(self, request):
        raw_key = request.headers.get('X-Device-Key')
        if not raw_key:
            return None

        key_hash = FaceCaptureDevice.hash_api_key(raw_key)
        try:
            device = FaceCaptureDevice.objects.select_related('school', 'class_obj').get(
                api_key_hash=key_hash, is_active=True,
            )
        except FaceCaptureDevice.DoesNotExist:
            raise AuthenticationFailed('Invalid or inactive device key.')

        return (AnonymousUser(), device)

    def authenticate_header(self, request):
        return 'X-Device-Key'


class IsAuthenticatedDevice(BasePermission):
    """Grants access only to requests authenticated via DeviceKeyAuthentication."""

    def has_permission(self, request, view):
        return isinstance(request.auth, FaceCaptureDevice)
