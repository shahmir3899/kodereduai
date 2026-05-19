import pytest


@pytest.mark.django_db
class TestContentRevisions:
    def test_editing_content_block_creates_revision(self, content_block):
        from lms.models import ContentRevision

        original_text = content_block.content_text
        content_block.content_text = 'Updated text for revision test'
        content_block.save()
        revision = ContentRevision.objects.filter(content_block=content_block).last()
        assert revision is not None
        assert revision.content_text == original_text

    def test_multiple_edits_create_multiple_revisions(self, content_block):
        from lms.models import ContentRevision

        content_block.content_text = 'Version 2'
        content_block.save()
        content_block.content_text = 'Version 3'
        content_block.save()
        assert ContentRevision.objects.filter(content_block=content_block).count() >= 2

    def test_get_revision_history_via_api(self, auth_client, content_block_with_revisions):
        response = auth_client.get(
            f'/api/lms/content-blocks/{content_block_with_revisions.id}/revisions/'
        )
        assert response.status_code == 200
        assert len(response.data) >= 1

    def test_revision_history_sorted_newest_first(self, auth_client, content_block_with_revisions):
        response = auth_client.get(
            f'/api/lms/content-blocks/{content_block_with_revisions.id}/revisions/'
        )
        dates = [r['changed_at'] for r in response.data]
        assert dates == sorted(dates, reverse=True)

    def test_restore_content_block_to_revision(self, auth_client, content_block_with_revisions):
        from lms.models import ContentRevision

        revision = ContentRevision.objects.filter(content_block=content_block_with_revisions).first()
        response = auth_client.post(
            f'/api/lms/content-blocks/{content_block_with_revisions.id}/restore/',
            {'revision_id': revision.id},
            format='json',
        )
        assert response.status_code == 200
        content_block_with_revisions.refresh_from_db()
        assert content_block_with_revisions.content_text == revision.content_text

    def test_question_edit_creates_question_revision(self, question):
        from examinations.models import QuestionRevision

        original_text = question.question_text
        question.question_text = 'Updated question text'
        question.save()
        revision = QuestionRevision.objects.filter(question=question).last()
        assert revision is not None
        assert revision.question_text == original_text

    def test_question_revision_snapshot_contains_full_state(self, question):
        from examinations.models import QuestionRevision

        question.question_text = 'Snapshot test'
        question.save()
        revision = QuestionRevision.objects.filter(question=question).last()
        assert 'question_text' in revision.snapshot
        assert 'marks' in revision.snapshot
