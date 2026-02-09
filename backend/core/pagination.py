"""
Custom pagination classes.
"""

from rest_framework.pagination import PageNumberPagination


class FlexiblePageNumberPagination(PageNumberPagination):
    """
    Pagination class that allows clients to set page_size via query parameter.
    """
    page_size = 20  # Default page size
    page_size_query_param = 'page_size'  # Allow client to set page size
    max_page_size = 2000  # Maximum allowed page size
