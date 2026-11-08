"""Assistant tests never talk to a model provider.

Every test mocks `assistant.llm.complete`. If one forgets (or a lazy stream is read after its
patch ended), the real client would burn the free daily budget that the live app shares, so the
transport functions (`providers.post_chat`, `list_models`, `post_transcription`) and the legacy
Groq client are replaced by a tripwire. It raises a BaseException on purpose: the code under test
catches Exception, which would turn a stray call into a silent "assistant unavailable" instead of
a failing test.
"""
from unittest.mock import patch

import pytest


class RealLLMCall(BaseException):
    pass


def _tripwire(*args, **kwargs):
    raise RealLLMCall('a test called a real model API - mock assistant.llm.complete or the providers function')


@pytest.fixture(autouse=True)
def _no_real_llm():
    with patch('groq.Groq', _tripwire), \
            patch('assistant.providers.post_chat', _tripwire), \
            patch('assistant.providers.list_models', _tripwire), \
            patch('assistant.providers.post_transcription', _tripwire):
        yield
