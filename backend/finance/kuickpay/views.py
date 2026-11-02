"""The two endpoints Kuickpay calls (guide §1). Authentication is by header, not JWT, and the school is
derived from the consumer number, never from a header."""
import logging
import time

from django.conf import settings
from rest_framework.exceptions import Throttled
from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core.audit import client_ip
from finance.kuickpay import contract, services
from finance.kuickpay.auth import KuickpayThrottle, credentials_ok, https_ok
from finance.models import KuickpayCallbackLog

logger = logging.getLogger(__name__)

# Every response the guide defines is sent with HTTP 200 and the result in `response_Code`
# (Kuickpay's examples show bodies only). Open question K-10 covers HTTP-status policy.
RESULT_HTTP_STATUS = 200


class _KuickpayView(APIView):
    authentication_classes = []
    permission_classes = []
    parser_classes = [JSONParser]
    throttle_classes = [KuickpayThrottle]
    endpoint = ''

    def handle_exception(self, exc):
        from rest_framework.exceptions import APIException, ParseError
        if isinstance(exc, Throttled):
            return Response(contract.server_error(), status=429)
        if isinstance(exc, ParseError):
            return Response(contract.invalid_data('Malformed request.'), status=RESULT_HTTP_STATUS)
        if isinstance(exc, APIException):
            return super().handle_exception(exc)        # e.g. 405 for a GET: standard framework answer
        # Anything unexpected is answered in Kuickpay's format. Credentials and bodies are never logged.
        logger.exception('Kuickpay %s failed unexpectedly', self.endpoint)
        return Response(contract.server_error(), status=RESULT_HTTP_STATUS)

    def post(self, request):
        started = time.monotonic()
        if not https_ok(request):
            return self._finish(request, started, Response(contract.invalid_data('HTTPS required.'), status=403),
                                auth_ok=False)
        if not credentials_ok(request):
            return self._finish(request, started, Response(contract.AUTH_FAILURE, status=RESULT_HTTP_STATUS),
                                auth_ok=False)
        body, bill, txn, consumer = self.process(request.data)
        return self._finish(request, started, Response(body, status=RESULT_HTTP_STATUS), auth_ok=True,
                            bill=bill, txn=txn, consumer_number=consumer, request_body=self.loggable(request.data))

    def process(self, data):
        raise NotImplementedError

    @staticmethod
    def loggable(data):
        if not isinstance(data, dict):
            return {}
        return {str(k)[:40]: (v if isinstance(v, (str, int, float, bool)) and len(str(v)) <= 200 else '…')
                for k, v in data.items() if str(k).lower() not in ('username', 'password')}

    def _finish(self, request, started, response, *, auth_ok, bill=None, txn=None, consumer_number='',
                request_body=None):
        try:
            KuickpayCallbackLog.objects.create(
                endpoint=self.endpoint, remote_ip=client_ip(request), auth_ok=auth_ok,
                consumer_number=(consumer_number or '')[:19], result_code=str(response.data.get('response_Code', ''))[:20],
                http_status=response.status_code, latency_ms=int((time.monotonic() - started) * 1000),
                redacted_request=request_body or {}, redacted_response=response.data, transaction=txn, bill=bill,
            )
        except Exception:
            # Evidence logging must never change what Kuickpay is told.
            logger.exception('Could not write the Kuickpay callback log')
        return response


class BillInquiryView(_KuickpayView):
    endpoint = 'BillInquiry'

    def process(self, data):
        try:
            req = contract.parse_inquiry(data)
        except contract.ContractError as exc:
            return contract.invalid_data(str(exc)), None, None, ''
        body, bill = services.inquire(req)
        return body, bill, None, req.consumer_number


class BillPaymentView(_KuickpayView):
    endpoint = 'BillPayment'

    def process(self, data):
        try:
            req = contract.parse_payment(
                data, amount_unit=getattr(settings, 'KUICKPAY_AMOUNT_UNIT', ''),
                tzname=getattr(settings, 'KUICKPAY_TIMEZONE', 'Asia/Karachi'),
            )
        except contract.ContractError as exc:
            if 'unit is not configured' in str(exc):
                # We cannot credit money whose unit is unconfirmed (K-25); refuse loudly, keep the evidence.
                logger.error('Kuickpay payment received but EDU_KUICKPAY_AMOUNT_UNIT is not configured')
                return contract.server_error(), None, None, ''
            return contract.invalid_data(str(exc)), None, None, ''
        body, txn = services.record_payment(req)
        return body, (txn.bill if txn else None), txn, req.consumer_number
