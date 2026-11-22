"""Paper Builder v2, Phase 5: Urdu (right-to-left) papers. Page, Word file, drawings and the scan."""
import io
import uuid
import zipfile

import pytest
from PIL import Image

from examinations import paper_scan_blocks as scan
from examinations.paper_blocks import layouts
from examinations.paper_blocks.docx_renderer import render_docx
from examinations.paper_blocks.docx_urdu import _segments, obfuscate
from examinations.paper_blocks.html_renderer import render_html
from examinations.paper_blocks.pictures import PictureStore
from examinations.paper_blocks.scene import Scene, to_png, to_svg
from examinations.paper_blocks.text_blocks import part_label
from examinations.paper_blocks.urdu import LABELS, URDU_FONT, font_bytes, has_urdu, labels_for


@pytest.fixture(scope='module')
def store():
    return PictureStore()


def _urdu_paper(*blocks, direction='rtl'):
    return {'direction': direction, 'footer': 'سالانہ امتحان',
            'header': {'school_name': 'فوکس سکول', 'subject': 'اردو', 'class_name': 'اول', 'time_label': '1 گھنٹہ',
                       'show_time_marks': True, 'sign_label': 'Teacher’s Sign', 'instructions': 'صاف لکھیں۔'},
            'blocks': list(blocks)}


MCQ = {'id': 'm', 'type': 'mcq', 'title': 'درست جواب چنیں۔', 'marks': 2, 'data': {'items': [
    {'text': 'پاکستان کا دارالحکومت؟', 'options': [{'text': 'لاہور'}, {'text': 'اسلام آباد'}]},
    {'text': 'Computer ایک ____ ہے۔', 'options': [{'text': 'مشین'}, {'text': 'پھل'}]},
]}}
TRAIN = {'id': 't', 'type': 'missing_sequence', 'title': 'حروف لکھیں۔', 'marks': 3,
         'data': {'items': ['ا', '', 'پ'], 'per_row': 3, 'shape': 'train'}}


class TestFont:
    def test_the_font_files_ship_with_the_app(self):
        for bold in (False, True):
            assert font_bytes(bold)[:4] == b'\x00\x01\x00\x00'  # TrueType

    def test_drawings_join_urdu_letters(self, store):
        """Pillow must shape Urdu (raqm): joined letters are narrower than the same letters drawn apart."""
        from PIL import features
        assert features.check('raqm'), 'Pillow cannot shape Urdu here; Word drawings would show broken letters'

        def ink_width(text):
            scene = Scene(300, 60)
            scene.text(150, 30, text, size=30)
            image = Image.open(io.BytesIO(to_png(scene, store))).convert('L')
            box = image.point(lambda v: 255 if v < 128 else 0).getbbox()
            return box[2] - box[0]
        assert ink_width('سیب') < ink_width('س ی ب') * 0.8


class TestMirror:
    def test_drawings_are_laid_out_from_the_right(self):
        ltr, rtl = layouts.build_scene(TRAIN), layouts.build_scene(TRAIN, rtl=True)
        assert ltr.width == rtl.width and len(ltr.items) == len(rtl.items)
        first_car_ltr = next(p for kind, p in ltr.items if kind == 'text')
        first_car_rtl = next(p for kind, p in rtl.items if kind == 'text')
        assert first_car_ltr['text'] == first_car_rtl['text'] == 'ا'
        assert first_car_ltr['x'] < ltr.width / 2 < first_car_rtl['x']

    def test_mirror_flips_boxes_and_keeps_text_anchors_readable(self):
        scene = Scene(100, 10)
        scene.rect(0, 0, 20, 10)
        scene.text(5, 5, 'x', anchor='start')
        scene.picture('star', 10, 0, 30, 10)
        flipped = scene.mirrored()
        (_, rect), (_, text), (_, picture) = flipped.items
        assert rect['x'] == 80 and text['x'] == 95 and text['anchor'] == 'end' and picture['x'] == 60

    def test_match_columns_put_column_a_on_the_right(self):
        block = {'type': 'match_columns', 'data': {'left': [{'text': 'سیب'}], 'right': [{'text': 'apple'}]}}
        texts = {p['text']: p['x'] for kind, p in layouts.build_scene(block, rtl=True).items if kind == 'text'}
        assert texts['سیب'] > texts['apple']

    def test_urdu_text_in_drawings_uses_the_urdu_font(self, store):
        svg = to_svg(layouts.build_scene(TRAIN, rtl=True), store)
        assert URDU_FONT in svg and 'پ' in svg


class TestLabels:
    def test_parts_and_options_use_urdu_letters(self):
        ur = labels_for({'direction': 'rtl'})
        assert [part_label(i, 'roman', ur) for i in (1, 2, 3)] == ['الف', 'ب', 'ج']
        assert part_label(2, 'number', ur) == '2'
        assert part_label(2, 'roman') == 'ii'

    def test_english_papers_keep_english_words(self):
        assert labels_for({}) == LABELS['en']


class TestHtml:
    def test_urdu_paper_page(self, store):
        html = render_html(_urdu_paper(MCQ, TRAIN), store)
        assert '<html lang="ur" dir="rtl">' in html
        assert '@font-face' in html and URDU_FONT in html
        for word in ('سوال 1:', 'نام:', 'رول نمبر:', 'کل نمبر:', 'برائے دفتری استعمال', 'دستخط استاد', 'ہدایات',
                     '(الف)', '<b>ب.</b>'):
            assert word in html, word
        assert 'Teacher’s Sign' not in html and 'Total Marks' not in html and 'Q1:' not in html
        # The footer and page number swap sides.
        assert '@bottom-right { content: "سالانہ امتحان"' in html and '"صفحہ " counter(page)' in html

    def test_a_typed_sign_label_is_kept(self, store):
        paper = _urdu_paper(MCQ)
        paper['header']['sign_label'] = 'دستخط ہیڈ ماسٹر'
        assert 'دستخط ہیڈ ماسٹر' in render_html(paper, store)

    def test_true_false_and_matching_in_urdu(self, store):
        html = render_html(_urdu_paper(
            {'id': 'a', 'type': 'true_false', 'title': 'درست یا غلط', 'marks': 1, 'data': {'items': [{'text': 'سورج'}]}},
            {'id': 'b', 'type': 'matching', 'title': 'ملائیں', 'marks': 2,
             'data': {'items': [{'left': 'دن', 'right': 'رات'}, {'left': 'اوپر', 'right': 'نیچے'}]}},
        ), store)
        assert 'درست / غلط' in html and 'کالم (الف)' in html and 'کالم (ب)' in html

    def test_english_papers_are_unchanged_and_carry_no_font(self, store):
        html = render_html({'header': {'school_name': 'A'}, 'blocks': [dict(MCQ, title='Choose.', data={'items': [
            {'text': 'Capital?', 'options': [{'text': 'Lahore'}]}]})]}, store)
        assert '@font-face' not in html and 'Q1:' in html and '<b>A.</b>' in html

    def test_urdu_text_on_an_english_paper_still_gets_the_font(self, store):
        html = render_html(_urdu_paper(MCQ, direction='ltr'), store)
        assert '@font-face' in html and 'dir="ltr"' in html and 'Q1:' in html


def _docx_xml(data):
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        return {name: package.read(name) for name in package.namelist()}


class TestWord:
    def test_paragraphs_and_tables_read_right_to_left(self, store):
        parts = _docx_xml(render_docx(_urdu_paper(MCQ, TRAIN), store))
        body = parts['word/document.xml'].decode('utf-8')
        assert '<w:bidi/>' in body and '<w:bidiVisual/>' in body and '<w:rtl/>' in body
        assert f'w:cs="{URDU_FONT}"' in body
        assert 'سوال 1:' in body and 'برائے دفتری استعمال' in body
        assert 'رول نمبر' in body

    def test_run_settings_are_in_schema_order(self, store):
        """Word ignores run settings written out of order (found in Word itself: the Urdu font was dropped)."""
        from docx import Document
        from docx.oxml.ns import qn
        from examinations.paper_blocks.docx_urdu import _RPR_ORDER
        document = Document(io.BytesIO(render_docx(_urdu_paper(MCQ), store)))
        order = [qn(tag) for tag in _RPR_ORDER]
        for r_pr in document.element.body.iter(qn('w:rPr')):
            positions = [order.index(child.tag) for child in r_pr if child.tag in order]
            assert positions == sorted(positions)

    def test_latin_words_and_answer_lines_stay_left_to_right(self):
        assert _segments('Computer ایک ____ ہے۔', rtl=True) == [
            ('Computer', False), (' ایک ', True), ('____', False), (' ہے۔', True)]
        assert _segments('Apples سیب are red', rtl=False) == [
            ('Apples', False), (' سیب ', True), ('are red', False)]

    def test_the_urdu_font_is_embedded(self, store):
        parts = _docx_xml(render_docx(_urdu_paper(MCQ), store))
        fonts = [name for name in parts if name.endswith('.odttf')]
        assert len(fonts) == 2
        assert b'<w:embedTrueTypeFonts/>' in parts['word/settings.xml']
        table = parts['word/fontTable.xml'].decode('utf-8')
        assert f'w:name="{URDU_FONT}"' in table and 'w:embedRegular' in table and 'w:embedBold' in table
        assert 'odttf' in parts['[Content_Types].xml'].decode('utf-8')
        assert b'Target="fonts/urdu1.odttf"' in parts['word/_rels/fontTable.xml.rels']

    def test_font_scrambling_round_trips(self):
        key = uuid.uuid4()
        data = font_bytes(False)
        scrambled = obfuscate(data, key)
        assert scrambled[:32] != data[:32] and scrambled[32:] == data[32:]
        assert obfuscate(scrambled, key) == data

    def test_english_papers_carry_no_font(self, store):
        parts = _docx_xml(render_docx({'header': {'school_name': 'A'}, 'blocks': []}, store))
        assert not any(name.endswith('.odttf') for name in parts)
        assert b'<w:bidi/>' not in parts['word/document.xml']


class TestScan:
    def test_prompt_explains_urdu_reading_order(self):
        prompt = scan.build_prompt({})
        assert 'starts at the RIGHT' in prompt and 'never translate' in prompt

    @pytest.mark.parametrize('printed, kept', [
        ('سوال 1: خالی ڈبے بھریں', 'خالی ڈبے بھریں'), ('سوال نمبر ۲۔ لکھیں', 'لکھیں'),
        ('3۔ ملائیں', 'ملائیں'), ('سوالات حل کریں', 'سوالات حل کریں'),
    ])
    def test_urdu_question_numbers_are_dropped(self, printed, kept):
        assert scan._QUESTION_NUMBER.sub('', printed, count=1) == kept

    @pytest.mark.parametrize('printed, kept', [
        ('(الف) سیب', 'سیب'), ('ب) بلی', 'بلی'), ('ج۔ کتا', 'کتا'), ('بلی کا بچہ', 'بلی کا بچہ'),
    ])
    def test_urdu_part_letters_are_dropped(self, printed, kept):
        assert scan._PART_NUMBER.sub('', printed, count=1) == kept

    def test_direction_is_judged_from_the_words_read(self):
        urdu = [{'type': 'mcq', 'title': 'درست جواب چنیں', 'data': {'items': [{'text': '<p>پاکستان کا دارالحکومت</p>'}]}}]
        english = [{'type': 'count_write', 'title': 'Count and write', 'data': {'rows': [{'picture': 'apple'}]}}]
        assert scan.text_direction({'school_name': 'The Focus School'}, urdu) == 'rtl'
        assert scan.text_direction({}, english) == 'ltr'
        # Picture names are English on every paper and do not count.
        picture_heavy = [{'type': 'count_write', 'title': 'گنیں', 'data': {'rows': [{'picture': 'butterfly'}] * 5}}]
        assert scan.text_direction({}, picture_heavy) == 'rtl'

    def test_merged_pages_keep_the_direction(self):
        merged = scan.merge_pages([(1, {'direction': 'rtl', 'blocks': []}), (2, {'direction': 'rtl', 'blocks': []})])
        assert merged['direction'] == 'rtl'
        assert scan.merge_pages([(1, {'blocks': []})])['direction'] == 'ltr'

    def test_has_urdu(self):
        assert has_urdu('Class اول') and not has_urdu('Class One')


def test_time_label_in_urdu():
    from examinations.paper_document import _time_label
    assert _time_label(60, urdu=True) == '1 گھنٹہ'
    assert _time_label(150, urdu=True) == '2 گھنٹے 30 منٹ'
    assert _time_label(45, urdu=True) == '45 منٹ'
    assert _time_label(90) == '1 h 30 min'


class TestEnglishInsideUrdu:
    """Found on a real board paper (Tamil Nadu HSC Urdu, 2019): English inside Urdu lost its order."""

    def test_english_stretches_are_isolated_on_the_page(self):
        from examinations.paper_blocks.urdu import isolate_latin
        assert isolate_latin('<p>inform the Hall Supervisor immediately.</p>') == \
            '<p><bdi>inform the Hall Supervisor immediately.</bdi></p>'
        assert isolate_latin('<b>الف.</b> (ii), (iii), (i)') == '<b>الف.</b> <bdi>(ii), (iii), (i)</bdi>'
        # Entities, drawings and styles are left alone; numbers inside Urdu are not English.
        assert isolate_latin('کہا &quot;سیب&quot; اور 7 دن') == 'کہا &quot;سیب&quot; اور 7 دن'
        assert isolate_latin('<svg><text>x</text></svg>') == '<svg><text>x</text></svg>'

    def test_urdu_page_isolates_english_in_titles_and_options(self, store):
        html = render_html(_urdu_paper({'id': 'x', 'type': 'mcq', 'title': 'جواب چنیں Choose the answer.', 'marks': 1,
                                        'data': {'items': [{'text': 'ترتیب', 'options': [{'text': '(ii), (i)'}, {'text': 'ب'}]}]}}), store)
        assert '<bdi>Choose the answer.</bdi>' in html and '<bdi>(ii), (i)</bdi>' in html

    def test_word_keeps_english_lists_whole(self):
        assert _segments('(ii), (iii), (iv), (i)', rtl=True) == [('(ii), (iii), (iv), (i)', False)]
        assert _segments('کیا ہے؟ Supervisor immediately.', rtl=True) == [
            ('کیا ہے؟ ', True), ('Supervisor immediately.', False)]


class TestRichTextInWord:
    def test_a_table_in_a_question_becomes_a_word_table(self, store):
        from docx import Document
        block = {'id': 't', 'type': 'short_answer', 'title': 'تشریح کیجیے', 'marks': 2, 'data': {'items': [{'text':
                 '<div dir="rtl"><p>اشعار</p><table><tr><td>محبت ہے</td><td>چمن سے</td></tr>'
                 '<tr><td>ہمیں پیار</td><td>گاؤں سے</td></tr></table><p>آخر</p></div>'}]}}
        word = Document(io.BytesIO(render_docx(_urdu_paper(block), store)))
        couplets = [t for t in word.tables if t.cell(0, 0).text == 'محبت ہے']
        assert couplets and couplets[0].cell(1, 1).text == 'گاؤں سے'
        texts = [p.text for p in word.paragraphs]
        assert any('اشعار' in t for t in texts) and 'آخر' in texts

    def test_paragraphs_are_single_line_breaks(self, store):
        from docx import Document
        block = {'id': 's', 'type': 'short_answer', 'title': 'لکھیے', 'marks': 1,
                 'data': {'items': [{'text': '<p>ایک</p><p>دو</p>'}]}}
        word = Document(io.BytesIO(render_docx(_urdu_paper(block), store)))
        part = next(p for p in word.paragraphs if 'ایک' in p.text)
        assert part.text.endswith('ایک\nدو')


def test_the_board_paper_sample_renders(store):
    """samples/urdu_board_paper1.json: part of the Tamil Nadu HSC Urdu Paper I (March 2019), rebuilt by hand."""
    import json
    from pathlib import Path
    from examinations.paper_blocks.registry import validate_document
    document = json.loads((Path(layouts.__file__).parent / 'samples' / 'urdu_board_paper1.json').read_text(encoding='utf-8'))
    assert validate_document(document) == []
    html = render_html(document, store)
    assert '<bdi>Choose the correct answer from the given option.</bdi>' in html and 'سوال 4:' in html
    assert render_docx(document, store)[:2] == b'PK'


class TestScanFixesFromRealPapers:
    """Found scanning the Tamil Nadu Urdu board paper with Gemini (2026-11-16)."""

    def test_line_breaks_in_scanned_text_are_kept(self):
        assert scan.rich_text('اشعار\n(i) پاس    تھی\n(ii) وہ') == 'اشعار<br>(i) پاس    تھی<br>(ii) وہ'

    def test_a_bare_br_from_the_editor_prints_as_a_line_break(self):
        from examinations.html_sanitize import sanitize_for_docx, sanitize_for_html
        assert sanitize_for_html('<p>سطر ایک<br>سطر دو</p>') == '<p>سطر ایک<br/>سطر دو</p>'
        assert sanitize_for_docx('a<br>b') == 'a\nb'

    def test_a_section_heading_with_no_words_is_left_out(self):
        with pytest.raises(ValueError, match='no words'):
            scan.clean_block({'type': 'section_heading'}, scan._PictureResolver('x', None, b''))

    def test_prompt_asks_for_the_papers_own_numbering(self):
        prompt = scan.build_prompt({})
        assert '"number" for 1. 2. 3.' in prompt and '(الف)' in prompt
