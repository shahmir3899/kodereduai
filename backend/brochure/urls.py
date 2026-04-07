from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import BrochureSectionViewSet, BrochurePreviewView, BrochureDownloadPdfView

router = DefaultRouter()
router.register('sections', BrochureSectionViewSet, basename='brochure-section')

urlpatterns = [
    path('', include(router.urls)),
    path('preview/', BrochurePreviewView.as_view(), name='brochure-preview'),
    path('download-pdf/', BrochureDownloadPdfView.as_view(), name='brochure-download-pdf'),
]
