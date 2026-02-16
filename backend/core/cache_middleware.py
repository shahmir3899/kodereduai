"""
Middleware to set Cache-Control headers on API responses.

- GET/HEAD requests to /api/ paths: Cache-Control: private, max-age=300
- Mutating requests (POST/PUT/PATCH/DELETE): Cache-Control: no-store
- Non-API paths: untouched (WhiteNoise handles static files)
"""

from django.utils.deprecation import MiddlewareMixin


class APICacheControlMiddleware(MiddlewareMixin):
    """Set Cache-Control headers on API responses."""

    def process_response(self, request, response):
        path = request.path

        # Only affect API endpoints
        if not path.startswith('/api/'):
            return response

        # Don't override if the view already set Cache-Control (e.g. @cache_page)
        if response.get('Cache-Control'):
            return response

        if request.method in ('GET', 'HEAD'):
            response['Cache-Control'] = 'private, max-age=300'
        else:
            response['Cache-Control'] = 'no-store'

        return response
