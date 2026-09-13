import pytest

PASSWORD_RESET_URL = lambda user_id: f'/api/users/{user_id}/reset_password/'


@pytest.mark.django_db
class TestSchoolScopedPasswordReset:
    """
    SCHOOL_ADMIN/PRINCIPAL can now reset a password for a user in their own
    school, scoped by ROLE_HIERARCHY (mirrors who they're allowed to create) --
    see users/views.py::UserViewSet.reset_password.
    """

    def test_school_admin_can_reset_teacher_password_in_own_school(self, seed_data, api):
        token = seed_data['tokens']['admin']
        teacher = seed_data['users']['teacher']

        resp = api.post(
            PASSWORD_RESET_URL(teacher.id),
            {'mode': 'set', 'new_password': 'NewPass123!', 'confirm_password': 'NewPass123!'},
            token, seed_data['SID_A'],
        )
        assert resp.status_code == 200

        teacher.refresh_from_db()
        assert teacher.check_password('NewPass123!')

    def test_school_admin_cannot_reset_password_for_user_in_other_school(self, seed_data, api):
        token = seed_data['tokens']['admin']
        admin_b = seed_data['users']['admin_b']

        resp = api.post(
            PASSWORD_RESET_URL(admin_b.id),
            {'mode': 'set', 'new_password': 'NewPass123!', 'confirm_password': 'NewPass123!'},
            token, seed_data['SID_A'],
        )
        # Out of the school-scoped queryset entirely -> 404, not 403.
        assert resp.status_code == 404

    def test_principal_cannot_reset_school_admin_password(self, seed_data, api):
        """PRINCIPAL's ROLE_HIERARCHY entry doesn't include SCHOOL_ADMIN, so
        this must be refused even though both are in the same school."""
        token = seed_data['tokens']['principal']
        admin = seed_data['users']['admin']

        resp = api.post(
            PASSWORD_RESET_URL(admin.id),
            {'mode': 'set', 'new_password': 'NewPass123!', 'confirm_password': 'NewPass123!'},
            token, seed_data['SID_A'],
        )
        assert resp.status_code == 403

        admin.refresh_from_db()
        assert not admin.check_password('NewPass123!')

    def test_principal_can_reset_teacher_password(self, seed_data, api):
        token = seed_data['tokens']['principal']
        teacher = seed_data['users']['teacher']

        resp = api.post(
            PASSWORD_RESET_URL(teacher.id),
            {'mode': 'set', 'new_password': 'NewPass123!', 'confirm_password': 'NewPass123!'},
            token, seed_data['SID_A'],
        )
        assert resp.status_code == 200

    def test_teacher_cannot_reset_anyone_password(self, seed_data, api):
        """Non-admin roles never reach the view -- IsSchoolAdmin on the
        ViewSet still gates the whole action."""
        token = seed_data['tokens']['teacher']
        other_teacher = seed_data['staff'][1].user

        resp = api.post(
            PASSWORD_RESET_URL(other_teacher.id),
            {'mode': 'set', 'new_password': 'NewPass123!', 'confirm_password': 'NewPass123!'},
            token, seed_data['SID_A'],
        )
        assert resp.status_code == 403
