from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status


def custom_exception_handler(exc, context):
    """
    Convert Django model ValidationError into a DRF-style 400 response
    so that model-level safeguards (period locks, field validation) return
    clean JSON errors instead of 500s.
    """
    if isinstance(exc, DjangoValidationError):
        if hasattr(exc, 'message_dict'):
            detail = exc.message_dict
        elif hasattr(exc, 'messages'):
            detail = exc.messages
        else:
            detail = [str(exc)]
        return Response({'detail': detail}, status=status.HTTP_400_BAD_REQUEST)

    return exception_handler(exc, context)
