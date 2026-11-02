"""Header authentication for the Kuickpay endpoints (guide §1.1: username/password in HTTP headers).

Credentials live only in environment-backed settings, are compared in constant time, and an unset
integration rejects everything the same way a wrong password does, so it reveals nothing.
"""
import hmac

from django.conf import settings
from rest_framework.throttling import AnonRateThrottle


def credentials_ok(request):
    expected_user = getattr(settings, 'KUICKPAY_USERNAME', '') or ''
    expected_pass = getattr(settings, 'KUICKPAY_PASSWORD', '') or ''
    # Both comparisons always run so the timing does not say which field was wrong.
    user_ok = hmac.compare_digest((request.META.get('HTTP_USERNAME') or '').encode(), expected_user.encode())
    pass_ok = hmac.compare_digest((request.META.get('HTTP_PASSWORD') or '').encode(), expected_pass.encode())
    configured = bool(getattr(settings, 'KUICKPAY_ENABLED', False) and expected_user and expected_pass)
    return configured and user_ok and pass_ok


def https_ok(request):
    return not getattr(settings, 'KUICKPAY_REQUIRE_HTTPS', True) or request.is_secure()


class KuickpayThrottle(AnonRateThrottle):
    """Generous per-client cap. The rate lives on the class (test settings empty the rate table).
    Render sits behind a proxy, so the client is the first X-Forwarded-For hop, like core.audit.client_ip."""
    scope = 'kuickpay'
    rate = '600/minute'

    def get_ident(self, request):
        forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
        return (forwarded.split(',')[0].strip() if forwarded else request.META.get('REMOTE_ADDR')) or 'unknown'
