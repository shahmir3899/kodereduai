"""Call the app's own DRF views as a given user, without HTTP.

Every agent write goes through the same viewsets the web and mobile apps use, so the
permission classes, validation, tenant scoping, module gating and model safeguards (period
locks, Kuickpay protection...) all apply exactly as they do for a person clicking a button.
"""
from rest_framework.test import APIRequestFactory, force_authenticate


def call(user, school_id, viewset, mapping, method, path, data=None, **view_kwargs):
    """Return (status_code, data). `mapping` is the DRF action map, e.g. {'post': 'bulk_update'};
    `view_kwargs` are URL kwargs such as pk=3 for detail routes."""
    factory = APIRequestFactory()
    headers = {'HTTP_X_SCHOOL_ID': str(school_id)}
    if method.lower() == 'get':
        request = factory.get(path, data or {}, **headers)
    else:
        request = getattr(factory, method.lower())(path, data or {}, format='json', **headers)
    force_authenticate(request, user=user)
    response = viewset.as_view(mapping)(request, **view_kwargs)
    if hasattr(response, 'render'):
        response.render()
    return response.status_code, getattr(response, 'data', None)
