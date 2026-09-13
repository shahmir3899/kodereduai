"""
Guard against SSRF when the app makes outbound HTTP requests to URLs that
originate from user/tenant-controlled data (attendance image URLs, question
diagram attachments, school logos, etc.). Without this, a stored URL pointing
at an internal host or the cloud metadata endpoint would be fetched server-side
on the caller's behalf.
"""
import ipaddress
import socket
from urllib.parse import urlparse

ALLOWED_SCHEMES = {'http', 'https'}


class UnsafeUrlError(ValueError):
    """Raised when a URL is not safe to fetch server-side."""


def _is_disallowed_ip(ip_str):
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        # Not a literal IP; caller resolves the hostname separately.
        return False
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def assert_safe_external_url(url):
    """
    Raise UnsafeUrlError if `url` is not safe to fetch from the server.
    Blocks non-http(s) schemes and any hostname that resolves to a private,
    loopback, link-local, or otherwise internal address (defends against SSRF
    to internal services / cloud metadata endpoints, e.g. 169.254.169.254).
    """
    if not url or not isinstance(url, str):
        raise UnsafeUrlError('No URL provided.')

    parsed = urlparse(url)
    if parsed.scheme not in ALLOWED_SCHEMES:
        raise UnsafeUrlError(f'Unsupported URL scheme: {parsed.scheme!r}')

    hostname = parsed.hostname
    if not hostname:
        raise UnsafeUrlError('URL has no hostname.')

    if _is_disallowed_ip(hostname):
        raise UnsafeUrlError('URL resolves to a disallowed internal address.')

    try:
        addr_infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise UnsafeUrlError(f'Could not resolve host: {hostname}') from exc

    for info in addr_infos:
        ip_str = info[4][0]
        if _is_disallowed_ip(ip_str):
            raise UnsafeUrlError('URL resolves to a disallowed internal address.')
