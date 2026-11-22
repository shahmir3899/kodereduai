"""Paper Builder v2, Phase 4: a photo of a paper -> blocks. Every AI and storage call is mocked."""
import io
import json
from unittest.mock import MagicMock, patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from examinations import paper_scan_blocks as scan
from examinations.models import PaperUpload
from examinations.paper_blocks.registry import BLOCK_TYPES
from examinations.paper_document import check_document
from examinations.paper_ocr_processor import MSG_AI_BUSY

STORAGE = 'https://files.example.test'

# What a vision model sends back for the Play Group Math paper, with the usual slips: numbers as text,
# a plural picture name, a choice in the wrong case, a count over the limit, one unknown block type,
# one empty block, and one drawing it could only point at.
PLAY_GROUP_REPLY = {
    'header': {'school_name': 'THE FOCUS MONTESSORI & SCHOOL', 'class_name': 'Play Group', 'subject': 'Math',
               'total_marks': '50', 'duration_minutes': None, 'secret': 'x'},
    'blocks': [
        {'type': 'writing_grid', 'title': 'Write counting from 1 to 20?', 'marks': '10', 'data': {'rows': '4', 'cols': 5}},
        {'type': 'missing_sequence', 'title': 'Write missing numbers?', 'marks': 5,
         'data': {'shape': 'Cloud', 'items': [1, '', 3, None, 5]}},
        {'type': 'count_write', 'title': 'Count and write?', 'marks': 5, 'data': {'rows': [
            {'picture': 'Butterflies', 'count': 3},
            {'picture': {'crop': [100, 100, 300, 300], 'label': 'a zorblax gadget'}, 'count': 12},
            {'count': 2},
        ]}},
        {'type': 'hologram', 'title': 'Draw a hologram', 'data': {}},
        {'type': 'find_colour', 'title': 'Search the number 4', 'marks': 4, 'data': {'target': '4', 'items': []}},
        {'type': 'mcq', 'title': 'Choose the correct answer.', 'marks': 2, 'data': {'items': [
            {'text': '$2 + 2 =$', 'options': [{'text': '3'}, {'text': '4'}], 'answer': 'b'},
            {'text': 'Which is a fruit?', 'options': ['Apple', 'Chair'], 'answer': 'A'},
        ], 'attempt': 9}},
    ],
}


def _photo_bytes(size=(1000, 1400)):
    buffer = io.BytesIO()
    Image.new('RGB', size, (250, 250, 250)).save(buffer, format='JPEG')
    return buffer.getvalue()


@pytest.fixture
def stored(settings):
    """Cut-out pictures go to a dict instead of Supabase, under the host check_document allows."""
    settings.SUPABASE_URL = STORAGE
    saved = {}

    def upload_file(self, file, folder, filename, max_image_dimension=None):
        url = f'{STORAGE}/{folder}/{filename}'
        saved[url] = file.read()
        return url

    with patch('core.storage.SupabaseStorageService.__init__', return_value=None), \
            patch('core.storage.SupabaseStorageService.upload_file', upload_file):
        yield saved


def _resolver(image=True):
    return scan._PictureResolver('https://photo.example.test/p.jpg', 7, _photo_bytes() if image else None)


def _groq_response(payload, status=200):
    response = MagicMock(ok=status < 400, status_code=status)
    response.json.return_value = {'choices': [{'message': {'content': json.dumps(payload)}}], 'usage': {'total_tokens': 10}}
    response.text = ''
    return response


class TestPrompt:
    def test_every_block_type_and_library_names_are_in_the_prompt(self):
        prompt = scan.build_prompt({'class_name': 'Play Group', 'subject_name': 'Math'})
        for name in BLOCK_TYPES:
            assert f'- {name} (' in prompt
        assert 'butterfly' in prompt and 'Class: Play Group' in prompt
        assert 'count: int 1-7' in prompt

    def test_ocr_text_is_added_when_there_is_some(self):
        assert 'OCR service' not in scan.build_prompt({}, '  ')
        assert 'Q1. Count the apples' in scan.build_prompt({}, 'Q1. Count the apples')


class TestMaths:
    def test_prompt_asks_for_latex_and_forbids_made_up_answers(self):
        prompt = scan.build_prompt({})
        assert r'$\frac{1}{2}$' in prompt and '9,999 not $9,999$' in prompt
        assert 'Never work answers out yourself' in prompt

    @pytest.mark.parametrize('text, html', [
        ('The sum of $9,999$ and $999$ is', 'The sum of 9,999 and 999 is'),
        ('$-2.5$ is less than 0', '-2.5 is less than 0'),
        ('5 < 7 & 2 > 1', '5 &lt; 7 &amp; 2 &gt; 1'),
        ('Find $x^2$', 'Find <span data-latex="x^2" data-evaluate="no" data-display="no" data-type="inlineMath">$x^2$</span>'),
        ('Price is $5', 'Price is $5'),
    ])
    def test_rich_text(self, text, html):
        assert scan.rich_text(text) == html

    def test_scanned_equations_print_as_maths(self):
        from examinations.html_sanitize import sanitize_for_docx, sanitize_for_html
        html = scan.rich_text(r'Simplify $\frac{1}{2} + \frac{1}{4}$ please')
        assert sanitize_for_html(html) == r'Simplify <span class="math">\frac{1}{2} + \frac{1}{4}</span> please'
        assert sanitize_for_docx(html) == r'Simplify \frac{1}{2} + \frac{1}{4} please'

    def test_plain_text_fields_and_titles_lose_the_dollars(self):
        block = scan.clean_block({'type': 'mcq', 'title': 'Q1: Choose $x$.', 'data': {'items': [
            {'text': 'Value of $2^3$', 'options': [{'text': '$8$'}, {'text': '$6$'}]}]}}, _resolver())
        assert block['title'] == 'Choose x.'
        item = block['data']['items'][0]
        assert 'data-type="inlineMath"' in item['text'] and [o['text'] for o in item['options']] == ['8', '6']
        pair = scan.clean_block({'type': 'matching', 'title': 'Match', 'data': {'items': [
            {'left': '$x^2$', 'right': 'square'}]}}, _resolver())
        assert pair['data']['items'][0]['left'] == 'x^2'


class TestLibraryMatch:
    @pytest.mark.parametrize('said, name', [
        ('apple', 'apple'), ('Apples', 'apple'), ('an owl', 'owl'), ('Butterflies', 'butterfly'),
        ('زرافہ', 'giraffe'), ('owl_2', 'owl_2'), ('', None), ('robot dinosaur', None),
    ])
    def test_names(self, said, name):
        assert scan.match_library(said) == name


class TestCleanBlock:
    def test_values_are_coerced_to_the_registry(self):
        block = scan.clean_block(PLAY_GROUP_REPLY['blocks'][0], _resolver())
        assert block['data'] == {'rows': 4, 'cols': 5} and block['marks'] == 10 and block['id']

    def test_choices_lists_and_empty_boxes(self):
        block = scan.clean_block(PLAY_GROUP_REPLY['blocks'][1], _resolver())
        assert block['data']['shape'] == 'cloud'
        assert block['data']['items'] == ['1', '', '3', '', '5']

    def test_unknown_or_empty_blocks_are_refused(self):
        with pytest.raises(ValueError, match='unknown kind'):
            scan.clean_block(PLAY_GROUP_REPLY['blocks'][3], _resolver())
        with pytest.raises(ValueError, match='nothing was read'):
            scan.clean_block(PLAY_GROUP_REPLY['blocks'][4], _resolver())

    def test_mcq_letters_bare_options_and_attempt(self):
        block = scan.clean_block(PLAY_GROUP_REPLY['blocks'][5], _resolver())
        first, second = block['data']['items']
        assert first['answer'] == 'B' and second['options'] == [{'text': 'Apple'}, {'text': 'Chair'}]
        assert 'attempt' not in block['data']

    @pytest.mark.parametrize('printed, kept', [
        ('Q1: Write counting from 1 to 20?', 'Write counting from 1 to 20?'), ('Q 7. Colour it.', 'Colour it.'),
        ('Question 3) Match.', 'Match.'), ('2. Oral', 'Oral'), ('10 apples are red.', '10 apples are red.'),
        ('Qatar is a country.', 'Qatar is a country.'),
        ('2.5 kg of rice costs Rs 300.', '2.5 kg of rice costs Rs 300.'), ('Q2: 3.5 + 1 = ?', '3.5 + 1 = ?'),
    ])
    def test_printed_question_numbers_are_dropped_from_titles(self, printed, kept):
        block = scan.clean_block({'type': 'writing_grid', 'title': printed, 'data': {'rows': 1, 'cols': 1}}, _resolver())
        assert block['title'] == kept

    def test_printed_part_numbers_are_dropped(self):
        block = scan.clean_block({'type': 'oral', 'title': 'Oral', 'data': {'items': [
            {'text': '1. Counting 1 to 20'}, {'text': '2: Poem: Early to bed.'}, {'text': '(b) Shapes'},
            {'text': 'iii) Colours'}, {'text': 'a. Animals'}, {'text': 'A big cat'}, {'text': '5 senses'},
        ]}}, _resolver())
        assert [i['text'] for i in block['data']['items']] == [
            'Counting 1 to 20', 'Poem: Early to bed.', 'Shapes', 'Colours', 'Animals', 'A big cat', '5 senses']

    def test_section_heading_has_no_data(self):
        assert scan.clean_block({'type': 'section_heading', 'title': 'Section A'}, _resolver())['title'] == 'Section A'


class TestPictures:
    def test_crop_is_cut_from_the_photo_and_stored(self, stored):
        pictures = _resolver()
        value = pictures.resolve({'crop': [100, 100, 300, 300], 'label': 'a zorblax gadget'})
        assert value['url'].startswith(STORAGE + '/papers/7/figures/')
        cut = Image.open(io.BytesIO(stored[value['url']]))
        assert 200 < cut.width < 260 and 280 < cut.height < 340   # 20% of 1000 x 1400 plus a small margin
        assert pictures.crops == 1

    def test_library_wins_over_a_crop(self, stored):
        assert _resolver().resolve({'crop': [100, 100, 300, 300], 'label': 'apples'}) == 'apple'
        assert not stored

    @pytest.mark.parametrize('box', [[0, 0, 1000, 1000], [5, 5, 6, 6], [300, 300, 100, 100], 'top', [1, 2]])
    def test_bad_boxes_keep_the_name_as_an_empty_box(self, stored, box):
        pictures = _resolver()
        assert pictures.resolve({'crop': box, 'label': 'a zorblax gadget'}) == 'a zorblax gadget'
        assert pictures.missing == ['a zorblax gadget'] and not stored

    def test_no_photo_means_no_crop(self, stored):
        pictures = _resolver(image=False)
        with patch.object(scan, '_download', side_effect=OSError('offline')):
            assert pictures.resolve({'crop': [100, 100, 300, 300], 'label': 'zorblax'}) == 'zorblax'

    def test_crops_are_capped(self, stored):
        pictures = _resolver()
        pictures.crops = scan.MAX_CROPS_PER_PAGE
        assert pictures.resolve({'crop': [100, 100, 300, 300], 'label': 'zorblax'}) == 'zorblax'

    def test_made_pictures_and_uploads_pass_through(self):
        assert _resolver().resolve({'make': 'clock', 'time': '3:00'}) == {'make': 'clock', 'time': '3:00'}
        assert _resolver().resolve({'upload': 4}) == {'upload': 4}


class TestScanPage:
    def test_play_group_reply_becomes_valid_blocks(self, settings, stored):
        settings.GOOGLE_VISION_API_KEY = ''
        with patch.object(scan.requests, 'post', return_value=_groq_response(PLAY_GROUP_REPLY)) as post, \
                patch.object(scan, '_download', return_value=_photo_bytes()):
            result = scan.scan_page('https://photo.example.test/p.jpg', {'school_id': 7}, provider='groq')
        sent = post.call_args.kwargs['json']
        assert sent['model'] == settings.PAPER_SCAN_GROQ_MODEL and sent['response_format'] == {'type': 'json_object'}
        assert [b['type'] for b in result['blocks']] == ['writing_grid', 'missing_sequence', 'count_write', 'mcq']
        assert check_document({'blocks': result['blocks']}) == []
        rows = result['blocks'][2]['data']['rows']
        assert rows[0]['picture'] == 'butterfly'
        assert rows[1]['picture']['url'].startswith(STORAGE) and rows[1]['count'] == 7
        assert rows[2]['picture'] == 'picture'
        assert result['header'] == {'school_name': 'THE FOCUS MONTESSORI & SCHOOL', 'class_name': 'Play Group',
                                    'subject': 'Math', 'total_marks': 50}
        assert result['pictures'] == {'library': 1, 'cropped': 1, 'missing': 1}
        notes = ' '.join(result['notes'])
        assert "Question 4 (Draw a hologram) was left out: unknown kind" in notes
        assert 'Question 5' in notes and 'Pictures not found' in notes
        assert result['provider'] == 'groq'

    def test_vision_text_is_sent_when_set_up(self, settings):
        settings.GOOGLE_VISION_API_KEY = 'test-key'
        vision = MagicMock(ok=True)
        vision.json.return_value = {'responses': [{'fullTextAnnotation': {'text': 'Q1. Count and write'}}]}
        with patch.object(scan.requests, 'post', side_effect=[vision, _groq_response(PLAY_GROUP_REPLY)]) as post, \
                patch.object(scan, '_download', return_value=_photo_bytes()):
            scan.scan_page('https://photo.example.test/p.jpg', {}, provider='groq')
        prompt = post.call_args_list[1].kwargs['json']['messages'][0]['content'][0]['text']
        assert 'Q1. Count and write' in prompt

    def test_busy_service_and_empty_reply_give_plain_messages(self, settings):
        settings.GOOGLE_VISION_API_KEY = ''
        with patch.object(scan.requests, 'post', return_value=_groq_response({}, status=429)), patch.object(scan.time, 'sleep'):
            with pytest.raises(scan.ScanError, match=MSG_AI_BUSY):
                scan.scan_page('https://x.test/p.jpg', {}, provider='groq')
        with patch.object(scan.requests, 'post', return_value=_groq_response({'blocks': []})):
            with pytest.raises(scan.ScanError, match='No questions'):
                scan.scan_page('https://x.test/p.jpg', {}, provider='groq')

    def test_a_busy_service_is_tried_once_more(self, settings):
        settings.GOOGLE_VISION_API_KEY = ''
        replies = [_groq_response({}, status=503), _groq_response(PLAY_GROUP_REPLY)]
        with patch.object(scan.requests, 'post', side_effect=replies) as post, patch.object(scan.time, 'sleep') as sleep,                 patch.object(scan, '_download', return_value=_photo_bytes()):
            result = scan.scan_page('https://x.test/p.jpg', {}, provider='groq')
        assert post.call_count == 2 and sleep.call_count == 1 and result['blocks']
        with patch.object(scan.requests, 'post', return_value=_groq_response({}, status=503)) as post,                 patch.object(scan.time, 'sleep'):
            with pytest.raises(scan.ScanError, match=MSG_AI_BUSY):
                scan.scan_page('https://x.test/p.jpg', {}, provider='groq')
        assert post.call_count == 2

    def test_unreadable_reply_is_a_scan_error(self, settings):
        settings.GOOGLE_VISION_API_KEY = ''
        response = _groq_response({})
        response.json.return_value = {'choices': [{'message': {'content': 'Sorry, I cannot help.'}}]}
        with patch.object(scan.requests, 'post', return_value=response):
            with pytest.raises(scan.ScanError):
                scan.scan_page('https://x.test/p.jpg', {}, provider='groq')

    def test_gemini_needs_a_key_and_sends_it_in_a_header(self, settings, stored):
        settings.GOOGLE_VISION_API_KEY = ''
        settings.GEMINI_API_KEY = ''
        with patch.object(scan, '_download', return_value=_photo_bytes()):
            with pytest.raises(scan.ScanError, match='not set up'):
                scan.scan_page('https://x.test/p.jpg', {}, provider='gemini')
        settings.GEMINI_API_KEY = 'test-gemini-key'
        reply = MagicMock(ok=True)
        reply.json.return_value = {'candidates': [{'content': {'parts': [{'text': json.dumps(PLAY_GROUP_REPLY)}]}}]}
        with patch.object(scan.requests, 'post', return_value=reply) as post, \
                patch.object(scan, '_download', return_value=_photo_bytes()) as download:
            result = scan.scan_page('https://x.test/p.jpg', {'school_id': 7}, provider='gemini')
        assert download.call_count == 1   # the photo is fetched once for the model and the crops
        assert post.call_args.kwargs['headers']['x-goog-api-key'] == 'test-gemini-key'
        assert 'test-gemini-key' not in post.call_args.args[0]
        assert len(result['blocks']) == 4 and result['provider'] == 'gemini'


def _gemini_response(payload, status=200):
    response = MagicMock(ok=status < 400, status_code=status)
    response.json.return_value = {'candidates': [{'content': {'parts': [{'text': json.dumps(payload)}]}}]}
    response.text = ''
    return response


class TestFallback:
    @pytest.fixture(autouse=True)
    def _setup(self, settings):
        settings.GOOGLE_VISION_API_KEY = ''
        settings.GEMINI_API_KEY = 'test-gemini-key'
        settings.PAPER_SCAN_PROVIDER = 'gemini'
        settings.PAPER_SCAN_FALLBACK = 'groq'

    def _scan(self, replies):
        with patch.object(scan.requests, 'post', side_effect=replies) as post, patch.object(scan.time, 'sleep'),                 patch.object(scan, '_download', return_value=_photo_bytes()) as download:
            result = scan.scan_page('https://x.test/p.jpg', {'school_id': 7})
        return result, post, download

    def test_default_order_is_gemini_then_groq(self, settings):
        assert scan.scan_providers() == ['gemini', 'groq']
        settings.PAPER_SCAN_FALLBACK = ''
        assert scan.scan_providers() == ['gemini']
        settings.PAPER_SCAN_FALLBACK = 'Gemini'
        assert scan.scan_providers() == ['gemini']

    def test_gemini_is_used_when_it_answers(self, stored):
        result, post, _ = self._scan([_gemini_response(PLAY_GROUP_REPLY)])
        assert result['provider'] == 'gemini' and 'fallback_from' not in result and post.call_count == 1

    def test_busy_gemini_falls_back_to_groq(self, stored):
        result, post, download = self._scan([
            _gemini_response({}, status=429), _gemini_response({}, status=429), _groq_response(PLAY_GROUP_REPLY),
        ])
        assert post.call_count == 3 and 'groq.com' in post.call_args_list[2].args[0]
        assert result['provider'] == 'groq' and result['fallback_from'] == 'gemini' and len(result['blocks']) == 4
        assert download.call_count == 1   # the photo fetched for Gemini is reused for the crops

    def test_missing_gemini_key_falls_back(self, settings, stored):
        settings.GEMINI_API_KEY = ''
        result, post, _ = self._scan([_groq_response(PLAY_GROUP_REPLY)])
        assert result['provider'] == 'groq' and post.call_count == 1

    def test_both_failing_gives_the_last_message(self):
        with pytest.raises(scan.ScanError, match=MSG_AI_BUSY):
            self._scan([_gemini_response({}, 503)] * 2 + [_groq_response({}, 503)] * 2)

    def test_an_empty_page_does_not_try_the_fallback(self):
        with pytest.raises(scan.ScanError, match='No questions'):
            _, post, _ = self._scan([_gemini_response({'blocks': []}), _groq_response(PLAY_GROUP_REPLY)])


class TestMergePages:
    def test_a_question_running_over_a_page_break_is_joined(self):
        def short(title, n, marks):
            return {'id': title + str(n), 'type': 'short_answer', 'title': title, 'marks': marks,
                    'data': {'items': [{'text': f'Q{i}'} for i in range(n)]}}
        merged = scan.merge_pages([
            (1, {'header': {'school_name': 'A'}, 'blocks': [short('Answer briefly.', 3, 6)], 'notes': ['x'],
                 'pictures': {'library': 1, 'cropped': 0, 'missing': 0}}),
            (2, {'header': {'school_name': 'B', 'subject': 'Science'}, 'blocks': [short('', 2, 4), short('Define.', 1, 2)],
                 'notes': [], 'pictures': {'library': 0, 'cropped': 2, 'missing': 1}}),
        ])
        assert merged['header'] == {'school_name': 'A', 'subject': 'Science'}
        assert len(merged['blocks']) == 2
        assert len(merged['blocks'][0]['data']['items']) == 5 and merged['blocks'][0]['marks'] == 10
        assert merged['blocks'][1]['page_number'] == 2
        assert merged['notes'] == ['Page 1: x'] and merged['pictures'] == {'library': 1, 'cropped': 2, 'missing': 1}

    def test_activity_blocks_are_never_joined(self):
        grid = {'id': 'g', 'type': 'writing_grid', 'title': '', 'data': {'rows': 1, 'cols': 1}}
        assert len(scan.merge_pages([(1, {'blocks': [grid]}), (2, {'blocks': [dict(grid, id='h')]})])['blocks']) == 2


@pytest.mark.django_db
class TestUploadEndpoints:
    def _upload(self, api, seed_data, mode=None):
        image = SimpleUploadedFile('page.jpg', _photo_bytes((200, 200)), content_type='image/jpeg')
        data = {'image': image, 'group_id': '5b6f3e57-1c39-4a43-9d34-7d0f0f2b9c11', 'page_number': 1}
        if mode:
            data['mode'] = mode
        with patch('core.storage.SupabaseStorageService.__init__', return_value=None), \
                patch('core.storage.SupabaseStorageService.upload_file', return_value=f'{STORAGE}/papers/p.jpg'), \
                patch('examinations.tasks.start_paper_ocr'):
            response = api.post_multipart('/api/examinations/paper-uploads/upload-image/', data,
                                          seed_data['tokens']['admin'], seed_data['SID_A'])
        assert response.status_code == 201, response.content
        return PaperUpload.objects.get(id=response.json()['id'])

    def test_block_mode_scans_to_blocks_and_group_status_returns_them(self, api, seed_data, settings):
        from examinations.tasks import process_paper_upload_ocr
        upload = self._upload(api, seed_data, mode='blocks')
        assert upload.ai_extracted_json == {'scan_mode': 'blocks'}
        result = {'scan_mode': 'blocks', 'header': {'subject': 'Math'}, 'notes': [], 'provider': 'groq', 'model': 'm',
                  'pictures': {'library': 0, 'cropped': 0, 'missing': 0},
                  'blocks': [{'id': 'a1', 'type': 'writing_grid', 'title': 'Write 1 to 20', 'marks': 10,
                              'data': {'rows': 4, 'cols': 5}}]}
        with patch('examinations.paper_scan_blocks.scan_page', return_value=result) as scan_page:
            process_paper_upload_ocr(upload.id)
        assert scan_page.call_args.args[1]['school_id'] == seed_data['SID_A']
        upload.refresh_from_db()
        assert upload.status == PaperUpload.Status.EXTRACTED and upload.ai_extracted_json['blocks'][0]['id'] == 'a1'

        status = api.get(f'/api/examinations/paper-uploads/group-status/?group_id={upload.group_id}&total_pages=1',
                         seed_data['tokens']['admin'], seed_data['SID_A']).json()
        assert status['complete'] and status['result']['scan_mode'] == 'blocks'
        assert status['result']['blocks'][0]['type'] == 'writing_grid'

    def test_scan_error_fails_the_page_with_its_message(self, api, seed_data):
        from examinations.tasks import process_paper_upload_ocr
        upload = self._upload(api, seed_data, mode='blocks')
        with patch('examinations.paper_scan_blocks.scan_page', side_effect=scan.ScanError(MSG_AI_BUSY)):
            process_paper_upload_ocr(upload.id)
        upload.refresh_from_db()
        assert upload.status == PaperUpload.Status.FAILED and upload.error_message == MSG_AI_BUSY

    def test_without_mode_the_upload_is_refused(self, api, seed_data):
        """Phase 7: the old questions scan is gone; an app from before Phase 6 (no mode) gets 409."""
        image = SimpleUploadedFile('page.jpg', _photo_bytes((200, 200)), content_type='image/jpeg')
        with patch('core.storage.SupabaseStorageService.upload_file') as upload_file:
            response = api.post_multipart('/api/examinations/paper-uploads/upload-image/', {'image': image},
                                          seed_data['tokens']['admin'], seed_data['SID_A'])
        assert response.status_code == 409
        upload_file.assert_not_called()
