"""Unit tests for WAHA / legacy WhatsApp delivery."""

from types import SimpleNamespace
from unittest.mock import patch

from django.test import override_settings

from core.whatsapp_delivery import phone_to_waha_chat_id, send_whatsapp, whatsapp_is_configured


def test_phone_to_waha_chat_id_strips_non_digits():
    assert phone_to_waha_chat_id("+92 300 1234567") == "923001234567@c.us"
    assert phone_to_waha_chat_id("(0300) 123-4567") == "03001234567@c.us"


def test_phone_to_waha_chat_id_empty():
    assert phone_to_waha_chat_id("") is None
    assert phone_to_waha_chat_id(None) is None
    assert phone_to_waha_chat_id("   ") is None
    assert phone_to_waha_chat_id("abc") is None


def _fake_school(session="default", whatsapp_module=True):
    def gem(mod):
        return whatsapp_module if mod == "whatsapp" else False

    return SimpleNamespace(
        whatsapp_sender_id=session,
        name="Test School",
        get_enabled_module=gem,
    )


def test_whatsapp_is_configured_respects_module_flag():
    school = _fake_school()
    with override_settings(
        WHATSAPP_PROVIDER="waha",
        WHATSAPP_API_URL="http://127.0.0.1:3080",
        WHATSAPP_API_KEY="secret",
    ):
        assert whatsapp_is_configured(school, require_whatsapp_module=False) is True
        assert whatsapp_is_configured(school, require_whatsapp_module=True) is True
    school2 = SimpleNamespace(
        whatsapp_sender_id="default",
        name="X",
        get_enabled_module=lambda m: False,
    )
    with override_settings(
        WHATSAPP_PROVIDER="waha",
        WHATSAPP_API_URL="http://127.0.0.1:3080",
        WHATSAPP_API_KEY="secret",
    ):
        assert whatsapp_is_configured(school2, require_whatsapp_module=True) is False


@patch("core.whatsapp_delivery.requests.post")
def test_send_waha_uses_sendtext_and_x_api_key(mock_post):
    mock_post.return_value.ok = True
    mock_post.return_value.status_code = 201
    mock_post.return_value.text = "{}"

    school = _fake_school("mysession")
    with override_settings(
        WHATSAPP_PROVIDER="waha",
        WHATSAPP_API_URL="http://127.0.0.1:3080/",
        WHATSAPP_API_KEY="api-key-1",
    ):
        assert send_whatsapp(school, "+44 7700 900123", "Hello") is True

    mock_post.assert_called_once()
    args, kwargs = mock_post.call_args
    assert args[0] == "http://127.0.0.1:3080/api/sendText"
    assert kwargs["headers"]["X-Api-Key"] == "api-key-1"
    assert kwargs["json"] == {
        "session": "mysession",
        "chatId": "447700900123@c.us",
        "text": "Hello",
    }


@patch("core.whatsapp_delivery.requests.post")
def test_send_http_legacy_uses_bearer(mock_post):
    mock_post.return_value.ok = True
    mock_post.return_value.status_code = 200
    mock_post.return_value.text = "ok"

    school = _fake_school("sender-99")
    with override_settings(
        WHATSAPP_PROVIDER="http",
        WHATSAPP_API_URL="https://gateway.example/hook",
        WHATSAPP_API_KEY="tok",
    ):
        assert send_whatsapp(school, "+1 555 0100", "Body", title="Title") is True

    mock_post.assert_called_once()
    args, kwargs = mock_post.call_args
    assert args[0] == "https://gateway.example/hook"
    assert kwargs["headers"]["Authorization"] == "Bearer tok"
    assert kwargs["json"]["sender_id"] == "sender-99"
    assert kwargs["json"]["phone"] == "+1 555 0100"
    assert "Title" in kwargs["json"]["message"]
    assert "Body" in kwargs["json"]["message"]
