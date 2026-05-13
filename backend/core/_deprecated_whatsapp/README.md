# Deprecated: WhatsApp Delivery

Parked on: 2026-05-13
Reason: WhatsApp integration requires per-school WAHA setup which adds operational complexity.
        Replaced by in-app notifications as the primary channel.
        Android app push notifications planned as the parent alert channel.

## Files
- `whatsapp_delivery.py` (from `core/`) — WAHA + legacy HTTP WhatsApp delivery
- (in notifications/_deprecated_whatsapp/) `whatsapp.py` — Notification channel wrapper

## How to Re-enable
1. Move `whatsapp_delivery.py` back to `backend/core/`
2. Move `whatsapp.py` back to `backend/notifications/channels/`
3. Re-add `('WHATSAPP', 'WhatsApp')` to `NotificationTemplate.CHANNEL_CHOICES` in `notifications/models.py`
4. Re-add `send_whatsapp_notifications` Celery task in `attendance/tasks.py`
5. Re-add the WhatsApp trigger block in `attendance/views.py` `confirm()` action
6. Uncomment `WHATSAPP_PROVIDER`, `WHATSAPP_API_URL`, `WHATSAPP_API_KEY` in `config/settings.py`
7. Set up WAHA Docker container per school (see `infra/waha/README.md`)
8. Set `school.whatsapp_sender_id` per school in admin

## Integration Notes
- WAHA session name goes in `School.whatsapp_sender_id` (DB field kept, unused)
- `SchoolNotificationSettings.whatsapp_enabled` DB field kept (unused)
- Phone numbers in E.164 format (+92XXXXXXXXXX) needed for WAHA chat ID conversion
