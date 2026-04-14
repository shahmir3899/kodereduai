"""Shared helpers for resolving class filters in legacy and session-aware modes."""

from core.mixins import ensure_tenant_school_id


def _get_param(request, key, include_body=False):
    value = request.query_params.get(key)
    if value in (None, '') and include_body:
        value = request.data.get(key)
    return value


def _get_first_param(request, keys, include_body=False):
    for key in keys:
        value = _get_param(request, key, include_body=include_body)
        if value not in (None, ''):
            return value
    return None


def resolve_class_scope(
    request,
    *,
    school_id=None,
    include_body=False,
    class_param_names=('class_id', 'class_obj'),
    academic_year_param='academic_year',
    session_class_param='session_class_id',
):
    """Resolve class filters with optional session-class precedence.

    Returns:
      {
        'class_obj_id': str|None,
        'academic_year_id': str|None,
        'session_class_id': str|None,
        'has_session_class': bool,
        'invalid': bool,
        'error': str,
      }
    """

    class_obj_id = _get_first_param(
        request,
        class_param_names,
        include_body=include_body,
    )
    academic_year_id = _get_param(
        request,
        academic_year_param,
        include_body=include_body,
    )
    session_class_id = _get_param(
        request,
        session_class_param,
        include_body=include_body,
    )

    result = {
        'class_obj_id': str(class_obj_id) if class_obj_id not in (None, '') else None,
        'academic_year_id': str(academic_year_id) if academic_year_id not in (None, '') else None,
        'session_class_id': str(session_class_id) if session_class_id not in (None, '') else None,
        'has_session_class': session_class_id not in (None, ''),
        'invalid': False,
        'error': '',
    }

    if not result['has_session_class']:
        return result

    from academic_sessions.models import SessionClass

    resolved_school_id = school_id or ensure_tenant_school_id(request)
    session_qs = SessionClass.objects.filter(id=result['session_class_id'])
    if resolved_school_id:
        session_qs = session_qs.filter(school_id=resolved_school_id)

    session_class = session_qs.select_related('academic_year').first()
    if not session_class:
        result['invalid'] = True
        result['error'] = 'Invalid session_class_id for this school.'
        return result

    if not session_class.class_obj_id:
        result['invalid'] = True
        result['error'] = 'Selected session class is not linked to a master class.'
        return result

    resolved_class_id = str(session_class.class_obj_id)
    resolved_year_id = str(session_class.academic_year_id)

    if result['class_obj_id'] and result['class_obj_id'] != resolved_class_id:
        result['invalid'] = True
        result['error'] = 'class_id/class_obj does not match the selected session_class_id.'
        return result

    if result['academic_year_id'] and result['academic_year_id'] != resolved_year_id:
        result['invalid'] = True
        result['error'] = 'academic_year does not match the selected session_class_id.'
        return result

    result['class_obj_id'] = resolved_class_id
    result['academic_year_id'] = resolved_year_id
    return result
