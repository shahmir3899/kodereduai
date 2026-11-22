"""Pictures for the block-based Paper Builder: the library that ships with the app, the pictures our
own code can draw, and a school's own uploads ("Browse").

``paper_blocks`` itself stays free of Django; this module is where it meets the database, storage and
the network.
"""
import logging
import uuid

import requests
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id
from core.permissions import HasSchoolAccess, ModuleAccessMixin, get_effective_role
from core.url_safety import UnsafeUrlError, assert_safe_external_url

from .models import PaperPicture
from .paper_blocks.makers import makers_for_api
from .paper_blocks.pictures import LIBRARY_DIR, PictureStore
from .paper_blocks.registry import upload_ids
from .paper_blocks.uploads import MAX_BYTES, UploadError, prepare_upload

logger = logging.getLogger(__name__)

# Enough for years of papers, and a ceiling on what one school can put in storage.
MAX_PICTURES_PER_SCHOOL = 2000


def _fetch_picture(url):
    """Bytes of an uploaded picture, or None. Used for Word export, which needs the file itself."""
    try:
        assert_safe_external_url(url)
    except UnsafeUrlError as exc:
        logger.warning('Rejected unsafe picture URL %s: %s', url, exc)
        return None
    try:
        response = requests.get(url, timeout=8)
        response.raise_for_status()
        return response.content
    except Exception as exc:
        logger.warning('Could not fetch picture %s: %s', url, exc)
        return None


def build_picture_store(document, school_id, link_base: str = '') -> PictureStore:
    """The store for rendering one paper: the library plus the uploads that paper uses.

    Uploads are looked up for ``school_id`` only, so a paper that names another school's picture
    number gets the empty placeholder box, never that school's file.
    """
    wanted = upload_ids(document)
    uploads = {}
    if wanted and school_id:
        uploads = dict(
            PaperPicture.objects.filter(school_id=school_id, id__in=wanted).values_list('id', 'image_url')
        )
    return PictureStore(uploads=uploads, fetch=_fetch_picture, link_base=link_base)


class PaperPictureSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PaperPicture
        fields = ['id', 'label', 'image_url', 'width', 'height', 'uploaded_by', 'uploaded_by_name', 'created_at']
        read_only_fields = fields

    def get_uploaded_by_name(self, obj):
        user = obj.uploaded_by
        if not user:
            return ''
        return (user.get_full_name() or user.username).strip()


class PaperPictureViewSet(
    ModuleAccessMixin,
    TenantQuerySetMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """A school's uploaded pictures, plus ``catalog/`` for the library and the code-drawn kinds."""
    required_module = 'examinations'
    queryset = PaperPicture.objects.select_related('uploaded_by')
    serializer_class = PaperPictureSerializer
    permission_classes = [IsAuthenticated, HasSchoolAccess]
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        queryset = super().get_queryset()
        search = (self.request.query_params.get('search') or '').strip()
        if search:
            queryset = queryset.filter(label__icontains=search)
        return queryset

    def create(self, request, *args, **kwargs):
        from core.storage import storage_service

        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'School ID is required.'}, status=status.HTTP_400_BAD_REQUEST)
        file = request.FILES.get('file')
        if file is None:
            return Response({'error': 'No file provided.'}, status=status.HTTP_400_BAD_REQUEST)
        if file.size > MAX_BYTES:
            return Response({'error': 'The picture is larger than 8 MB.'}, status=status.HTTP_400_BAD_REQUEST)
        if PaperPicture.objects.filter(school_id=school_id).count() >= MAX_PICTURES_PER_SCHOOL:
            return Response(
                {'error': 'This school has reached its picture limit. Delete pictures you no longer use.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        clean = str(request.data.get('clean', 'true')).lower() not in ('false', '0', 'no')
        try:
            prepared = prepare_upload(file.read(), clean=clean)
        except UploadError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        label = (request.data.get('label') or '').strip()
        if not label:
            label = (getattr(file, 'name', '') or 'Picture').rsplit('.', 1)[0]
        label = label[:120]

        filename = f'{uuid.uuid4().hex}.png'
        try:
            url = storage_service.upload_file(
                SimpleUploadedFile(filename, prepared.png, content_type='image/png'),
                folder=f'paper-pictures/{school_id}',
                filename=filename,
            )
        except Exception as exc:
            logger.error('Paper picture upload failed for school %s: %s', school_id, exc)
            return Response(
                {'error': 'The picture could not be saved. Please try again.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        picture = PaperPicture.objects.create(
            school_id=school_id, label=label, image_url=url,
            width=prepared.width, height=prepared.height, uploaded_by=request.user,
        )
        return Response(self.get_serializer(picture).data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        from core.storage import storage_service

        # A teacher's picture may sit in a colleague's paper, so teachers remove only their own;
        # admins and principals can tidy up anyone's.
        if get_effective_role(self.request) == 'TEACHER' and instance.uploaded_by_id != self.request.user.id:
            raise PermissionDenied('You can delete only the pictures you uploaded.')
        url = instance.image_url
        instance.delete()
        try:
            path = storage_service._extract_storage_path(url)
            if path:
                storage_service.delete_file(path)
        except Exception:
            # The row is gone, which is what the teacher asked for; a leftover file in storage
            # is only wasted space and must not turn the delete into an error.
            pass

    @action(detail=False, methods=['get'])
    def catalog(self, request):
        """Library pictures (``?search=`` matches English and Urdu names and search words) and the
        kinds of picture the code can draw. Each picture comes with the address of its file rather
        than the file itself: the library has hundreds of pictures."""
        store = PictureStore()
        library = [
            {**entry, 'url': request.build_absolute_uri(f'{LIBRARY_URL}{entry["name"]}/')}
            for entry in store.search(request.query_params.get('search'))
        ]
        return Response({'library': library, 'makers': makers_for_api()})


class PaperBlockTypesView(ModuleAccessMixin, APIView):
    """Every block type with its fields, and the kinds of picture the code can draw. The web editor
    (and the phone app later) build their forms from this list."""
    required_module = 'examinations'
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request):
        from .paper_blocks.registry import DOCUMENT_VERSION, TYPE_GROUPS, registry_for_api, structure_templates
        return Response({'version': DOCUMENT_VERSION, 'blocks': registry_for_api(), 'makers': makers_for_api(),
                         'structure_templates': structure_templates(), 'type_groups': TYPE_GROUPS})


LIBRARY_URL = '/api/examinations/paper-picture-library/'
# Library SVGs are cleaned when they are added, but a file opened on its own should still not be
# able to run or load anything.
_LIBRARY_HEADERS = {
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=604800',
}


def library_picture(request, name):
    """One library picture's file (SVG when there is one, else PNG). Open to anyone: these are the
    public-domain pictures that ship with the app, and an ``<img>`` tag cannot send a login token.
    ``?format=png`` always serves the PNG copy: the phone app cannot show SVG in its picture grids."""
    from django.http import FileResponse, Http404

    store = PictureStore()
    kinds = (('.svg', 'image/svg+xml'), ('.png', 'image/png'))
    if request.GET.get('format') == 'png':
        kinds = kinds[1:]
    for suffix, mime in kinds:
        path = store._path(name, suffix)
        if path is not None and path.parent == LIBRARY_DIR:
            response = FileResponse(open(path, 'rb'), content_type=mime)
            for header, value in _LIBRARY_HEADERS.items():
                response[header] = value
            return response
    raise Http404('No such picture.')
