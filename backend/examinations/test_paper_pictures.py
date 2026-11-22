"""Paper Builder v2, pictures: code-drawn pictures, the library catalog, upload clean-up, and the
``paper-pictures`` endpoints (school uploads)."""
import io
import re

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image, ImageDraw

from examinations.models import PaperPicture
from examinations.paper_blocks import layouts
from examinations.paper_blocks.html_renderer import render_html
from examinations.paper_blocks.docx_renderer import render_docx
from examinations.paper_blocks.makers import MAKERS, make
from examinations.paper_blocks.pictures import LIBRARY_DIR, PictureStore
from examinations.paper_blocks.registry import picture_refs, upload_ids, validate_document
from examinations.paper_blocks.scene import Scene, to_png, to_svg
from examinations.paper_blocks.uploads import UploadError, prepare_upload
from examinations.paper_pictures import build_picture_store

URL = '/api/examinations/paper-pictures/'


def _photo_of_a_drawing(size=(800, 600), paper=(228, 224, 215), fmt='PNG'):
    """A dark square drawn in the middle of greyish paper, like a phone photo of a sketch."""
    image = Image.new('RGB', size, paper)
    ImageDraw.Draw(image).rectangle([300, 200, 500, 400], outline=(20, 20, 20), width=8)
    buffer = io.BytesIO()
    image.save(buffer, format=fmt)
    return buffer.getvalue()


def _paper(*blocks):
    return {'header': {'school_name': 'Test School'}, 'blocks': list(blocks)}


class TestMakers:
    @pytest.mark.parametrize('kind', sorted(MAKERS))
    def test_every_kind_draws_with_no_values_and_with_nonsense(self, kind):
        store = PictureStore()
        for extra in ({}, {'count': 'many', 'time': 'noon', 'parts': None, 'shaded': 99, 'value': -4,
                           'start': 'a', 'end': float('inf'), 'step': 0, 'hide': ['x'], 'rows': 9999,
                           'filled': 500, 'shape': 'blob', 'picture': {'make': 'nothing'}}):
            scene = make({'make': kind, **extra})
            assert scene.width > 0 and scene.height > 0 and scene.items
            assert to_svg(scene, store).startswith('<svg')
        assert to_png(scene, store, scale=1)[:4] == b'\x89PNG'

    def test_unknown_kind_is_not_drawn(self):
        assert make({'make': 'hologram'}) is None
        scene = Scene(100, 100)
        scene.picture({'make': 'hologram'}, 0, 0, 100, 100)
        assert scene.items == [('picture', {'name': 'hologram', 'x': 0, 'y': 0, 'w': 100, 'h': 100})]

    def test_clock_hands_point_at_the_time(self):
        lines = [p for kind, p in make({'make': 'clock', 'time': '3:00', 'numbers': False}).items if kind == 'line']
        minute, hour = lines[-2], lines[-1]
        assert (round(minute['x2']), round(minute['y2'])) == (100, 30)   # straight up
        assert (round(hour['x2']), round(hour['y2'])) == (146, 100)      # pointing right
        blank = make({'make': 'clock', 'hands': False})
        assert len([1 for kind, _ in blank.items if kind == 'line']) == 12

    def test_fraction_shades_the_asked_number_of_parts(self):
        bar = make({'make': 'fraction', 'shape': 'bar', 'parts': 5, 'shaded': 2})
        assert [bool(p['fill']) for _, p in bar.items] == [True, True, False, False, False]
        pie = make({'make': 'fraction', 'parts': 8, 'shaded': 5})
        assert len([1 for kind, p in pie.items if kind == 'polygon' and p['fill']]) == 5

    def test_number_line_hides_the_listed_numbers(self):
        scene = make({'make': 'number_line', 'start': 0, 'end': 50, 'step': 5, 'hide': [15, 30]})
        labels = [p['text'] for kind, p in scene.items if kind == 'text']
        assert labels == ['0', '5', '10', '20', '25', '35', '40', '45', '50']
        assert len([1 for kind, _ in scene.items if kind == 'rect']) == 2

    def test_repeat_draws_the_count_and_refuses_to_nest(self):
        scene = make({'make': 'repeat', 'picture': 'apple', 'count': 12, 'per_row': 4})
        assert [p['name'] for _, p in scene.items] == ['apple'] * 12
        assert (scene.width, scene.height) == (4 * 70 - 10, 3 * 70 - 10)
        bomb = {'make': 'repeat', 'count': 40, 'picture': {'make': 'repeat', 'count': 40, 'picture': 'apple'}}
        assert len(make(bomb).items) == 40

    def test_a_made_picture_is_scaled_into_its_box(self):
        scene = Scene(660, 200)
        scene.picture({'make': 'dice', 'value': 6}, 100, 20, 50, 50)
        for kind, p in scene.items:
            if kind == 'circle':
                assert 100 <= p['cx'] <= 150 and 20 <= p['cy'] <= 70
        assert len(scene.items) == 7


class TestPictureReferences:
    def test_refs_are_found_inside_made_pictures(self):
        document = _paper(
            {'type': 'count_write', 'data': {'rows': [{'picture': 'star', 'count': 2}]}},
            {'type': 'colour_picture', 'data': {'picture': {'upload': 7}}},
            {'type': 'picture_answer', 'data': {'items': [
                {'picture': {'make': 'repeat', 'count': 3, 'picture': {'upload': 9}}}]}},
        )
        assert validate_document(document) == []
        assert upload_ids(document) == {7, 9}
        assert 'star' in list(picture_refs(document))

    def test_bad_refs_are_reported(self):
        errors = validate_document(_paper(
            {'type': 'colour_picture', 'data': {'picture': {'make': 'hologram'}}},
            {'type': 'colour_picture', 'data': {'picture': {'upload': '7; drop'}}},
            {'type': 'picture_answer', 'data': {'items': [{'picture': 5}]}},
        ))
        assert [e.split(':')[0] for e in errors] == ['Question 1', 'Question 2', 'Question 3']
        assert 'hologram' in errors[0]


class TestCatalog:
    def test_catalog_and_picture_files_match(self):
        catalog = PictureStore().catalog()
        names = [entry['name'] for entry in catalog]
        assert len(names) == len(set(names))
        # Every picture has a PNG (Word needs it); SVG is optional, kept only when it is small.
        assert set(names) == {png.stem for png in LIBRARY_DIR.glob('*.png')}
        assert {svg.stem for svg in LIBRARY_DIR.glob('*.svg')} <= set(names)
        for entry in catalog:
            assert entry['en'] and entry['ur'] and entry['tags']

    def test_library_has_at_least_500_pictures_from_known_sources(self):
        catalog = PictureStore().catalog()
        assert len(catalog) >= 500
        for entry in catalog:
            if entry.get('source'):
                assert entry['source'] == 'openclipart' and isinstance(entry['source_id'], int)

    def test_library_files_are_safe_and_small(self):
        for svg in LIBRARY_DIR.glob('*.svg'):
            text = svg.read_text(encoding='utf-8').lower()
            for bad in ('<script', 'javascript:', '<foreignobject', '<image', 'onload', 'onclick', '<!entity'):
                assert bad not in text, (svg.name, bad)
            assert not re.search(r'href="(?!#)', text), svg.name
            assert len(text) <= 40_000, svg.name
        total = sum(f.stat().st_size for f in LIBRARY_DIR.iterdir())
        assert total < 15 * 1024 * 1024

    def test_search_by_english_urdu_and_tag(self):
        store = PictureStore()
        assert [e['name'] for e in store.search('butterfly')] == ['butterfly']
        assert [e['name'] for e in store.search('تتلی')] == ['butterfly']
        assert {'circle', 'square', 'triangle', 'rectangle', 'star'} <= {e['name'] for e in store.search('SHAPE')}
        fruits = store.search('fruit')
        assert 'apple' in {e['name'] for e in fruits} and len(fruits) >= 10
        assert store.search('zzz') == []


class TestPrepareUpload:
    def test_a_photo_of_a_drawing_is_whitened_and_trimmed(self):
        prepared = prepare_upload(_photo_of_a_drawing(fmt='JPEG'))
        image = Image.open(io.BytesIO(prepared.png))
        assert image.format == 'PNG' and image.mode == 'L'
        # 800x600 photo, 200x200 drawing: what is kept is the drawing plus a small edge.
        assert (prepared.width, prepared.height) == image.size
        assert 200 <= image.width <= 260 and 200 <= image.height <= 260
        assert image.getpixel((2, 2)) == 255
        assert image.getpixel((image.width // 2, image.height // 2)) == 255
        assert min(image.getdata()) < 60

    def test_clean_off_keeps_the_picture_as_it_is(self):
        prepared = prepare_upload(_photo_of_a_drawing(), clean=False)
        image = Image.open(io.BytesIO(prepared.png))
        assert image.size == (800, 600) and image.getpixel((2, 2)) == (228, 224, 215)

    def test_large_pictures_are_shrunk(self):
        prepared = prepare_upload(_photo_of_a_drawing(size=(3000, 1500)), clean=False)
        assert (prepared.width, prepared.height) == (1200, 600)

    @pytest.mark.parametrize('raw, message', [
        (b'', 'empty'),
        (b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'not a picture'),
        (b'%PDF-1.4 not an image', 'not a picture'),
        (b'x' * (8 * 1024 * 1024 + 1), '8 MB'),
    ], ids=['empty', 'svg', 'pdf', 'too-large'])
    def test_bad_files_are_refused_with_a_plain_message(self, raw, message):
        with pytest.raises(UploadError) as error:
            prepare_upload(raw)
        assert message in str(error.value)

    def test_gif_and_blank_pictures_are_refused(self):
        buffer = io.BytesIO()
        Image.new('RGB', (50, 50), 'white').save(buffer, format='GIF')
        with pytest.raises(UploadError, match='PNG, JPG or WebP'):
            prepare_upload(buffer.getvalue())
        buffer = io.BytesIO()
        Image.new('RGB', (50, 50), 'white').save(buffer, format='PNG')
        with pytest.raises(UploadError, match='blank'):
            prepare_upload(buffer.getvalue())


@pytest.fixture
def fake_storage(monkeypatch):
    """Supabase stands in as a dict: nothing leaves the machine."""
    from core.storage import storage_service
    saved, deleted = {}, []

    def upload_file(file, folder, filename, max_image_dimension=None):
        url = f'https://files.example.test/{folder}/{filename}'
        saved[url] = file.read()
        return url

    monkeypatch.setattr(storage_service, 'upload_file', upload_file)
    monkeypatch.setattr(storage_service, '_extract_storage_path', lambda url: url.split('.test/')[1])
    monkeypatch.setattr(storage_service, 'delete_file', lambda path: deleted.append(path) or True)
    return {'saved': saved, 'deleted': deleted}


def _upload(api, seed_data, who='admin', school='SID_A', raw=None, **fields):
    file = SimpleUploadedFile('my mango.png', raw if raw is not None else _photo_of_a_drawing(), content_type='image/png')
    return api.post_multipart(URL, {'file': file, **fields}, seed_data['tokens'][who], seed_data[school])


@pytest.mark.django_db
class TestPaperPictureEndpoints:
    def test_catalog_lists_library_and_makers(self, api, seed_data):
        response = api.get(f'{URL}catalog/', seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert response.status_code == 200
        body = response.json()
        assert len(body['library']) == len(list(LIBRARY_DIR.glob('*.png')))
        assert all(entry['url'].endswith(f'/api/examinations/paper-picture-library/{entry["name"]}/')
                   for entry in body['library'])
        assert {maker['kind'] for maker in body['makers']} == set(MAKERS)
        searched = api.get(f'{URL}catalog/?search=تتلی', seed_data['tokens']['teacher'], seed_data['SID_A']).json()
        assert [entry['name'] for entry in searched['library']] == ['butterfly']

    def test_library_picture_is_served_without_login(self, api):
        response = api.get_no_auth('/api/examinations/paper-picture-library/star/')
        assert response.status_code == 200
        assert response['Content-Type'] == 'image/svg+xml'
        assert "default-src 'none'" in response['Content-Security-Policy']
        assert b''.join(response.streaming_content).lstrip().startswith(b'<svg')
        png_only = next(p.stem for p in LIBRARY_DIR.glob('*.png') if not p.with_suffix('.svg').exists())
        response = api.get_no_auth(f'/api/examinations/paper-picture-library/{png_only}/')
        assert response.status_code == 200 and response['Content-Type'] == 'image/png'
        for bad in ('nothing_here', 'catalog', '..%2Fsettings', 'STAR'):
            assert api.get_no_auth(f'/api/examinations/paper-picture-library/{bad}/').status_code == 404

    def test_library_pictures_keep_their_long_cache_other_api_answers_do_not(self, api, seed_data):
        # The API cache middleware sets no-cache on every GET; the library files are exempt so the preview
        # and the picker grid do not download each picture again every time.
        assert api.get_no_auth('/api/examinations/paper-picture-library/star/')['Cache-Control'] == 'public, max-age=604800'
        assert api.get_no_auth('/api/examinations/paper-picture-library/star/?format=png')['Cache-Control'] == 'public, max-age=604800'
        assert api.get_no_auth('/api/examinations/paper-picture-library/nothing_here/')['Cache-Control'] == 'no-cache'
        other = api.get('/api/examinations/paper-blocks/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert other['Cache-Control'] == 'no-cache'

    def test_library_picture_as_png_for_the_phone(self, api):
        response = api.get_no_auth('/api/examinations/paper-picture-library/star/?format=png')
        assert response.status_code == 200 and response['Content-Type'] == 'image/png'
        assert b''.join(response.streaming_content)[:4] == bytes([0x89]) + b'PNG'
        assert api.get_no_auth('/api/examinations/paper-picture-library/nothing_here/?format=png').status_code == 404

    def test_upload_is_cleaned_stored_and_listed_for_its_school_only(self, api, seed_data, fake_storage):
        response = _upload(api, seed_data, who='teacher')
        assert response.status_code == 201, response.content
        body = response.json()
        assert body['label'] == 'my mango'
        assert body['width'] < 300 and body['height'] < 300          # trimmed from 800x600
        assert f'paper-pictures/{seed_data["SID_A"]}/' in body['image_url']
        stored = Image.open(io.BytesIO(fake_storage['saved'][body['image_url']]))
        assert stored.format == 'PNG' and stored.size == (body['width'], body['height'])

        mine = api.get(URL, seed_data['tokens']['admin'], seed_data['SID_A']).json()
        assert [row['id'] for row in mine['results']] == [body['id']]
        other = api.get(URL, seed_data['tokens']['admin_b'], seed_data['SID_B']).json()
        assert other['results'] == []

    def test_label_and_clean_can_be_set(self, api, seed_data, fake_storage):
        body = _upload(api, seed_data, label='  Mango  ', clean='false').json()
        assert body['label'] == 'Mango' and (body['width'], body['height']) == (800, 600)
        found = api.get(f'{URL}?search=mang', seed_data['tokens']['admin'], seed_data['SID_A']).json()
        assert found['count'] == 1
        assert api.get(f'{URL}?search=zebra', seed_data['tokens']['admin'], seed_data['SID_A']).json()['count'] == 0

    def test_bad_uploads_are_refused(self, api, seed_data, fake_storage):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        response = _upload(api, seed_data, raw=svg)
        assert response.status_code == 400 and 'not a picture' in response.json()['error']
        response = api.post_multipart(URL, {'label': 'x'}, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert response.status_code == 400
        assert PaperPicture.objects.count() == 0 and fake_storage['saved'] == {}

    def test_storage_failure_saves_nothing(self, api, seed_data, monkeypatch):
        from core.storage import storage_service

        def broken(*args, **kwargs):
            raise Exception('bucket unreachable')

        monkeypatch.setattr(storage_service, 'upload_file', broken)
        response = _upload(api, seed_data)
        assert response.status_code == 502
        assert 'bucket' not in response.json()['error']
        assert PaperPicture.objects.count() == 0

    def test_teacher_deletes_only_own_picture_and_admin_any(self, api, seed_data, fake_storage):
        by_admin = _upload(api, seed_data, who='admin').json()
        by_teacher = _upload(api, seed_data, who='teacher').json()
        teacher, admin, sid = seed_data['tokens']['teacher'], seed_data['tokens']['admin'], seed_data['SID_A']

        assert api.delete(f'{URL}{by_admin["id"]}/', teacher, sid).status_code == 403
        assert api.delete(f'{URL}{by_teacher["id"]}/', teacher, sid).status_code == 204
        # Another school cannot even see it, so it cannot delete it.
        assert api.delete(f'{URL}{by_admin["id"]}/', seed_data['tokens']['admin_b'], seed_data['SID_B']).status_code == 404
        assert api.delete(f'{URL}{by_admin["id"]}/', admin, sid).status_code == 204
        assert PaperPicture.objects.count() == 0
        assert len(fake_storage['deleted']) == 2

    def test_a_paper_gets_only_its_own_schools_uploads(self, api, seed_data, fake_storage, monkeypatch):
        mine = _upload(api, seed_data, who='admin').json()
        theirs = _upload(api, seed_data, who='admin_b', school='SID_B').json()
        document = _paper(
            {'type': 'colour_picture', 'title': 'Colour', 'marks': 2, 'data': {'picture': {'upload': mine['id']}}},
            {'type': 'colour_picture', 'title': 'Colour', 'marks': 2, 'data': {'picture': {'upload': theirs['id']}}},
        )
        monkeypatch.setattr('examinations.paper_pictures._fetch_picture', lambda url: fake_storage['saved'].get(url))
        store = build_picture_store(document, seed_data['SID_A'])

        html = render_html(document, store)
        assert mine['image_url'] in html and theirs['image_url'] not in html
        assert f'>upload:{theirs["id"]}<' in html      # the other school's picture is an empty named box

        first, second = (layouts.build_scene(block) for block in document['blocks'])
        # The upload is a hollow square, drawn about 360 wide in the middle of the frame, so its
        # left side falls in this strip; the other school's block has only a pale dashed box there.
        strip = (135, 30, 185, 350)
        with_picture = Image.open(io.BytesIO(to_png(first, store, scale=1))).convert('L')
        without = Image.open(io.BytesIO(to_png(second, store, scale=1))).convert('L')
        assert min(with_picture.crop(strip).getdata()) < 90
        assert min(without.crop(strip).getdata()) > 150
        assert render_docx(document, store)[:2] == b'PK'
        assert store.png_image(f'upload:{theirs["id"]}') is None
