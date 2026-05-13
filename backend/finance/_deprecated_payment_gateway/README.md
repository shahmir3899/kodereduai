# Deprecated: Payment Gateway Service

Parked on: 2026-05-13
Reason: School-level payment gateway configuration adds per-school credential management overhead
        with zero current users. Replaced by manual/offline payment recording only.

## Files
- `payment_gateway_service.py` — JazzCash, Easypaisa, Stripe, Razorpay abstract gateway layer

## DB State
- `PaymentGatewayConfig` model in `finance/models.py` is KEPT (data preserved, not migrated out)
- `OnlinePayment` model records kept
- No destructive migration applied

## How to Re-enable
1. Move `payment_gateway_service.py` back to `backend/finance/`
2. In `finance/views.py`: restore `PaymentGatewayConfigViewSet`, `JazzCashCallbackView`,
   `EasypaisaCallbackView`, `PaymentInitiateView`, `GatewayPaymentStatusView`
3. In `finance/urls.py`: restore gateway routes (`gateway-config/`, `callbacks/`, `online-payments/`)
4. In `parents/views.py`: restore `pay-fee` endpoint
5. Restore frontend: `PaymentGatewayPage`, API methods in `services/api.js`, parent portal pay button

## Notes
- JazzCash sandbox credentials: configure in `GatewayConfig` via admin
- Easypaisa webhook callbacks were at `/api/finance/callbacks/easypaisa/`
- Parent portal pay-fee was at `/api/parents/children/{id}/pay-fee/`
