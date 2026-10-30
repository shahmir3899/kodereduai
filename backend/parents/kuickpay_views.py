from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsParentOrAdmin
from finance.kuickpay.parent_summary import build_parent_summary
from students.models import Student

from .views import _verify_child_access


class ChildKuickpayBillView(APIView):
    """
    GET children/<int:student_id>/kuickpay-bill/
    The child's current Kuickpay bill (the only payable one) and expired bills as history.
    """
    permission_classes = [IsAuthenticated, IsParentOrAdmin]

    def get(self, request, student_id):
        if not _verify_child_access(request, student_id):
            return Response(
                {'error': 'You do not have access to this child.'}, status=status.HTTP_403_FORBIDDEN,
            )
        student = Student.objects.filter(pk=student_id).first()
        if student is None:
            return Response({'error': 'Student not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(build_parent_summary(student))
