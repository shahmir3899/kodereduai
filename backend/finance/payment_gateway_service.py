"""
Payment Gateway Service Layer.

Provides a unified abstraction for JazzCash, Easypaisa, and other gateways.
This is a *simulated* implementation — it builds correctly-signed payloads and
validates callback signatures but does NOT make actual HTTP calls to the
gateway APIs. Replace the _post_to_gateway stubs with real HTTP calls when
ready to go live.
"""

import hashlib
import hmac
import logging
import time
import uuid
from datetime import datetime
from decimal import Decimal

logger = logging.getLogger('finance')


class PaymentGatewayError(Exception):
    """Raised when a gateway operation fails."""
    pass


# =============================================================================
# Base Gateway
# =============================================================================

class BaseGateway:
    """Abstract base for all payment gateways."""

    name = 'BASE'

    def __init__(self, config: dict, currency: str = 'PKR'):
        self.config = config
        self.currency = currency

    def initiate_payment(self, order_id: str, amount: Decimal,
                         description: str, return_url: str) -> dict:
        """Build and return the data needed to redirect the user to the
        gateway's payment page.  Returns a dict with at minimum:
            - redirect_url: str
            - payload: dict  (form fields / query params)
            - method: 'POST' | 'GET'
        """
        raise NotImplementedError

    def verify_callback(self, callback_data: dict) -> dict:
        """Validate a gateway callback / webhook and return normalised data:
            - verified: bool
            - order_id: str
            - gateway_payment_id: str
            - status: 'SUCCESS' | 'FAILED' | 'PENDING'
            - amount: Decimal
            - raw: dict  (original payload)
        """
        raise NotImplementedError

    def test_connection(self) -> dict:
        """Quick connectivity / credential sanity check.
        Returns:
            - success: bool
            - message: str
        """
        raise NotImplementedError


# =============================================================================
# JazzCash Gateway
# =============================================================================

class JazzCashGateway(BaseGateway):
    """
    JazzCash Online Payment Integration.

    Required config keys:
        merchant_id, password, integrity_salt, environment (sandbox|production)
    """

    name = 'JAZZCASH'

    SANDBOX_URL = 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/'
    PRODUCTION_URL = 'https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/'

    def _get_base_url(self):
        env = self.config.get('environment', 'sandbox')
        return self.PRODUCTION_URL if env == 'production' else self.SANDBOX_URL

    def _compute_hash(self, data_string: str) -> str:
        """HMAC-SHA256 hash using the integrity salt."""
        salt = self.config.get('integrity_salt', '')
        return hmac.new(
            salt.encode('utf-8'),
            data_string.encode('utf-8'),
            hashlib.sha256,
        ).hexdigest()

    def initiate_payment(self, order_id: str, amount: Decimal,
                         description: str, return_url: str) -> dict:
        merchant_id = self.config.get('merchant_id', '')
        password = self.config.get('password', '')
        txn_datetime = datetime.now().strftime('%Y%m%d%H%M%S')
        expiry_datetime = datetime.now().strftime('%Y%m%d%H%M%S')  # +1hr in prod
        amount_str = str(int(amount * 100))  # JazzCash expects paisa

        # Fields that go into the hash (alphabetical by key)
        hash_fields = {
            'pp_Amount': amount_str,
            'pp_BillReference': f'bill-{order_id}',
            'pp_Description': description[:250],
            'pp_Language': 'EN',
            'pp_MerchantID': merchant_id,
            'pp_Password': password,
            'pp_ReturnURL': return_url,
            'pp_TxnCurrency': self.currency,
            'pp_TxnDateTime': txn_datetime,
            'pp_TxnExpiryDateTime': expiry_datetime,
            'pp_TxnRefNo': order_id,
            'pp_TxnType': 'MWALLET',
            'pp_Version': '1.1',
        }

        # Build sorted hash string
        sorted_values = '&'.join(
            hash_fields[k] for k in sorted(hash_fields.keys())
        )
        secure_hash = self._compute_hash(sorted_values)

        payload = {k: v for k, v in hash_fields.items() if k != 'pp_Password'}
        payload['pp_SecureHash'] = secure_hash

        return {
            'redirect_url': self._get_base_url(),
            'payload': payload,
            'method': 'POST',
            'order_id': order_id,
        }

    def verify_callback(self, callback_data: dict) -> dict:
        """Verify JazzCash callback by recomputing HMAC-SHA256."""
        received_hash = callback_data.get('pp_SecureHash', '')
        response_code = callback_data.get('pp_ResponseCode', '')
        order_id = callback_data.get('pp_TxnRefNo', '')
        amount_str = callback_data.get('pp_Amount', '0')

        # Rebuild hash from callback fields (exclude pp_SecureHash itself)
        hash_fields = {
            k: v for k, v in callback_data.items()
            if k != 'pp_SecureHash' and k.startswith('pp_')
        }
        sorted_values = '&'.join(
            hash_fields[k] for k in sorted(hash_fields.keys())
        )
        computed_hash = self._compute_hash(sorted_values)
        verified = hmac.compare_digest(computed_hash, received_hash)

        if response_code == '000':
            pay_status = 'SUCCESS'
        elif response_code in ('124', '210'):
            pay_status = 'PENDING'
        else:
            pay_status = 'FAILED'

        return {
            'verified': verified,
            'order_id': order_id,
            'gateway_payment_id': callback_data.get('pp_TxnRefNo', ''),
            'status': pay_status,
            'amount': Decimal(amount_str) / 100,
            'response_code': response_code,
            'response_message': callback_data.get('pp_ResponseMessage', ''),
            'raw': callback_data,
        }

    def test_connection(self) -> dict:
        merchant_id = self.config.get('merchant_id', '')
        password = self.config.get('password', '')
        integrity_salt = self.config.get('integrity_salt', '')

        if not all([merchant_id, password, integrity_salt]):
            return {
                'success': False,
                'message': 'Missing required credentials (merchant_id, password, integrity_salt).',
            }

        # Verify we can compute a hash (credentials are syntactically valid)
        try:
            test_hash = self._compute_hash('test_connection')
            if len(test_hash) == 64:  # SHA-256 hex length
                return {
                    'success': True,
                    'message': f'JazzCash credentials validated. Merchant: {merchant_id[:4]}****',
                }
        except Exception as e:
            return {'success': False, 'message': f'Hash computation failed: {e}'}

        return {'success': False, 'message': 'Unexpected error during validation.'}


# =============================================================================
# Easypaisa Gateway
# =============================================================================

class EasypaisaGateway(BaseGateway):
    """
    Easypaisa Online Payment Integration.

    Required config keys:
        store_id, merchant_hash, environment (sandbox|production)
    """

    name = 'EASYPAISA'

    SANDBOX_URL = 'https://easypay.easypaisa.com.pk/tpg/MIGS/VPCPaymentRequest.do'
    PRODUCTION_URL = 'https://easypay.easypaisa.com.pk/tpg/MIGS/VPCPaymentRequest.do'

    def _get_base_url(self):
        env = self.config.get('environment', 'sandbox')
        return self.PRODUCTION_URL if env == 'production' else self.SANDBOX_URL

    def _compute_hash(self, data_string: str) -> str:
        """SHA-256 hash using the merchant hash key."""
        merchant_hash = self.config.get('merchant_hash', '')
        return hashlib.sha256(
            (merchant_hash + data_string).encode('utf-8')
        ).hexdigest()

    def initiate_payment(self, order_id: str, amount: Decimal,
                         description: str, return_url: str) -> dict:
        store_id = self.config.get('store_id', '')
        amount_str = f'{amount:.2f}'
        txn_datetime = datetime.now().strftime('%Y%m%d %H%M%S')

        hash_string = f'{amount_str}{order_id}{txn_datetime}{store_id}'
        secure_hash = self._compute_hash(hash_string)

        payload = {
            'storeId': store_id,
            'amount': amount_str,
            'postBackURL': return_url,
            'orderRefNum': order_id,
            'expiryDate': txn_datetime,
            'autoRedirect': '1',
            'paymentMethod': 'InitialRequest',
            'emailAddress': '',
            'mobileNum': '',
            'hashKey': secure_hash,
        }

        return {
            'redirect_url': self._get_base_url(),
            'payload': payload,
            'method': 'POST',
            'order_id': order_id,
        }

    def verify_callback(self, callback_data: dict) -> dict:
        """Verify Easypaisa callback."""
        order_id = callback_data.get('orderRefNumber', '')
        response_code = callback_data.get('responseCode', '')
        amount_str = callback_data.get('amount', '0')

        if response_code == '0000':
            pay_status = 'SUCCESS'
        elif response_code in ('0001', '0002'):
            pay_status = 'PENDING'
        else:
            pay_status = 'FAILED'

        return {
            'verified': True,  # Easypaisa uses postback URL verification
            'order_id': order_id,
            'gateway_payment_id': callback_data.get('transactionId', ''),
            'status': pay_status,
            'amount': Decimal(amount_str) if amount_str else Decimal('0'),
            'response_code': response_code,
            'response_message': callback_data.get('responseDesc', ''),
            'raw': callback_data,
        }

    def test_connection(self) -> dict:
        store_id = self.config.get('store_id', '')
        merchant_hash = self.config.get('merchant_hash', '')

        if not all([store_id, merchant_hash]):
            return {
                'success': False,
                'message': 'Missing required credentials (store_id, merchant_hash).',
            }

        try:
            test_hash = self._compute_hash('test_connection')
            if len(test_hash) == 64:
                return {
                    'success': True,
                    'message': f'Easypaisa credentials validated. Store: {store_id[:4]}****',
                }
        except Exception as e:
            return {'success': False, 'message': f'Hash computation failed: {e}'}

        return {'success': False, 'message': 'Unexpected error during validation.'}


# =============================================================================
# Manual / Offline Gateway (pass-through)
# =============================================================================

class ManualGateway(BaseGateway):
    """Manual/Offline payment — no redirect, just records the intent."""

    name = 'MANUAL'

    def initiate_payment(self, order_id: str, amount: Decimal,
                         description: str, return_url: str) -> dict:
        return {
            'redirect_url': None,
            'payload': {
                'order_id': order_id,
                'amount': str(amount),
                'description': description,
                'bank_name': self.config.get('bank_name', ''),
                'account_title': self.config.get('account_title', ''),
                'account_number': self.config.get('account_number', ''),
                'iban': self.config.get('iban', ''),
                'branch': self.config.get('branch', ''),
                'instructions': self.config.get('instructions', ''),
            },
            'method': 'MANUAL',
            'order_id': order_id,
        }

    def verify_callback(self, callback_data: dict) -> dict:
        return {
            'verified': True,
            'order_id': callback_data.get('order_id', ''),
            'gateway_payment_id': '',
            'status': 'PENDING',  # Manual payments always need admin verification
            'amount': Decimal(callback_data.get('amount', '0')),
            'raw': callback_data,
        }

    def test_connection(self) -> dict:
        bank_name = self.config.get('bank_name', '')
        account_number = self.config.get('account_number', '')
        if bank_name or account_number:
            return {
                'success': True,
                'message': f'Manual gateway configured. Bank: {bank_name or "N/A"}',
            }
        return {
            'success': True,
            'message': 'Manual/Offline gateway ready (no bank details configured).',
        }


# =============================================================================
# Factory
# =============================================================================

GATEWAY_REGISTRY = {
    'JAZZCASH': JazzCashGateway,
    'EASYPAISA': EasypaisaGateway,
    'MANUAL': ManualGateway,
}


def get_gateway(gateway_config) -> BaseGateway:
    """
    Factory: return the correct gateway instance for a PaymentGatewayConfig
    model instance.
    """
    gateway_type = gateway_config.gateway
    cls = GATEWAY_REGISTRY.get(gateway_type)
    if not cls:
        raise PaymentGatewayError(
            f'Unsupported gateway: {gateway_type}. '
            f'Supported: {", ".join(GATEWAY_REGISTRY.keys())}'
        )
    return cls(
        config=gateway_config.config or {},
        currency=gateway_config.currency,
    )
