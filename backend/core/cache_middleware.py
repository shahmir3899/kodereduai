"""
Middleware to set Cache-Control headers on API responses.

- GET/HEAD requests to /api/ paths: Cache-Control: no-cache
  (browser must revalidate with server every time; never serves stale data)
- Mutating requests (POST/PUT/PATCH/DELETE): Cache-Control: no-store
- Non-API paths: untouched (WhiteNoise handles static files)

Note: We intentionally avoid max-age on API responses because React Query
handles client-side caching with staleTime. Browser-level HTTP caching with
max-age causes stale data after mutations (the browser serves the old cached
response even when React Query tries to refetch).
"""

from django.utils.deprecation import MiddlewareMixin


# Files that ship with the app and never change per user or after a save, so they keep the long cache
# their view sets. The paper picture library is drawn many times per preview and in the picker grid;
# with no-cache (and no ETag) every one was downloaded again each time.
LONG_CACHE_PREFIXES = ('/api/examinations/paper-picture-library/',)


class APICacheControlMiddleware(MiddlewareMixin):
    """Set Cache-Control headers on API responses."""

    def process_response(self, request, response):
        path = request.path

        # Only affect API endpoints
        if not path.startswith('/api/'):
            return response

        if path.startswith(LONG_CACHE_PREFIXES) and response.status_code == 200:
            return response

        # Always override Cache-Control for API responses to prevent
        # browser-level caching from serving stale data after mutations.
        # Views that previously used @cache_page still benefit from
        # Django's server-side cache, but the browser won't cache the response.
        if request.method in ('GET', 'HEAD'):
            response['Cache-Control'] = 'no-cache'
        else:
            response['Cache-Control'] = 'no-store'

        return response
