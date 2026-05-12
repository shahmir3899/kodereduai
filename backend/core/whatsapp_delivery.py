"""
Send WhatsApp messages via configured provider.

- http: POST to WHATSAPP_API_URL (legacy) with Bearer token and JSON
  {sender_id, phone, message}.
- waha: POST to {WHATSAPP_API_URL}/api/sendText with X-Api-Key and JSON
  {session, chatId, text}. School.whatsapp_sender_id is the WAHA session name.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


def phone_to_waha_chat_id(phone: str) -> Optional[str]:
    """Build WAHA chatId (digits only + @c.us). Returns None if no digits."""
    if not phone or not str(phone).strip():
        return None
    digits = re.sub(r"\D", "", str(phone))
    if not digits:
        return None
    return f"{digits}@c.us"


def _provider() -> str:
    raw = getattr(settings, "WHATSAPP_PROVIDER", "http") or "http"
    p = str(raw).strip().lower()
    return p if p in ("http", "waha") else "http"


def whatsapp_is_configured(school, *, require_whatsapp_module: bool) -> bool:
    if require_whatsapp_module and not school.get_enabled_module("whatsapp"):
        return False
    return bool(
        settings.WHATSAPP_API_URL
        and settings.WHATSAPP_API_KEY
        and school.whatsapp_sender_id
    )


def _compose_text(title: Optional[str], body: str) -> str:
    t = (title or "").strip()
    b = (body or "").strip()
    if t and b:
        return f"{t}\n\n{b}"
    return t or b


def send_whatsapp(
    school,
    phone: str,
    message: str,
    *,
    title: Optional[str] = None,
) -> bool:
    """
    Deliver one WhatsApp message for ``school`` to ``phone``.

    ``school.whatsapp_sender_id`` is the legacy sender_id (http) or WAHA session
    name (waha).
    """
    if not phone or not str(phone).strip():
        logger.warning("WhatsApp send skipped: empty phone")
        return False

    text = _compose_text(title, message)
    if not text:
        logger.warning("WhatsApp send skipped: empty body")
        return False

    api_url = (settings.WHATSAPP_API_URL or "").strip().rstrip("/")
    api_key = (settings.WHATSAPP_API_KEY or "").strip()
    sender_id = (school.whatsapp_sender_id or "").strip()

    if not (api_url and api_key and sender_id):
        logger.warning("WhatsApp send skipped: missing URL, API key, or sender/session")
        return False

    provider = _provider()

    try:
        if provider == "waha":
            chat_id = phone_to_waha_chat_id(phone)
            if not chat_id:
                logger.warning("WhatsApp (WAHA): no digits in phone %r", phone)
                return False
            url = f"{api_url}/api/sendText"
            response = requests.post(
                url,
                json={
                    "session": sender_id,
                    "chatId": chat_id,
                    "text": text,
                },
                headers={
                    "X-Api-Key": api_key,
                    "Content-Type": "application/json",
                },
                timeout=30,
            )
        else:
            response = requests.post(
                api_url,
                json={
                    "sender_id": sender_id,
                    "phone": phone,
                    "message": text,
                },
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout=30,
            )

        if response.ok:
            logger.info("WhatsApp delivered to %s", phone)
            return True
        logger.error(
            "WhatsApp API error: %s - %s",
            response.status_code,
            response.text[:500],
        )
        return False
    except Exception as exc:
        logger.error("WhatsApp send failed: %s", exc)
        return False
