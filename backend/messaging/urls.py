from django.urls import path
from .views import MessagingViewSet

urlpatterns = [
    path('threads/',
         MessagingViewSet.as_view({'get': 'list_threads', 'post': 'create_thread'}),
         name='messaging-threads'),
    path('threads/<uuid:thread_id>/',
         MessagingViewSet.as_view({'get': 'get_thread'}),
         name='messaging-thread-detail'),
    path('threads/<uuid:thread_id>/reply/',
         MessagingViewSet.as_view({'post': 'reply'}),
         name='messaging-reply'),
    path('threads/<uuid:thread_id>/read/',
         MessagingViewSet.as_view({'patch': 'mark_read'}),
         name='messaging-mark-read'),
    path('recipients/',
         MessagingViewSet.as_view({'get': 'list_recipients'}),
         name='messaging-recipients'),
    path('unread-count/',
         MessagingViewSet.as_view({'get': 'unread_count'}),
         name='messaging-unread-count'),
]
