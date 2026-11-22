"""Paper Builder v2 (examinations/paper_blocks): block data -> HTML page and Word file.

No database: the package is plain Python, and the two sample papers are the fixtures.
"""
import io
import json
from pathlib import Path

import pytest

from examinations.paper_blocks import layouts
from examinations.paper_blocks.docx_renderer import render_docx
from examinations.paper_blocks.html_renderer import render_html
from examinations.paper_blocks.pictures import LIBRARY_DIR, PictureStore
from examinations.paper_blocks.registry import BLOCK_TYPES, total_marks, validate_document
from examinations.paper_blocks.scene import to_png, to_svg

SAMPLES = Path(layouts.__file__).parent / 'samples'
SAMPLE_NAMES = ['play_group_math', 'play_group_english']


def _sample(name):
    return json.loads((SAMPLES / f'{name}.json').read_text(encoding='utf-8'))


@pytest.fixture(scope='module')
def store():
    return PictureStore([SAMPLES / 'pictures'])


def _paper(*blocks):
    return {'header': {'school_name': 'Test School'}, 'blocks': list(blocks)}


class TestRegistry:
    def test_every_block_type_has_a_way_to_print(self):
        from examinations.paper_blocks.registry import LAYOUT_BLOCKS
        from examinations.paper_blocks.text_blocks import DOCX_RENDERERS, HTML_RENDERERS
        assert set(HTML_RENDERERS) == set(DOCX_RENDERERS)
        assert set(BLOCK_TYPES) == set(layouts.SCENE_BUILDERS) | {'oral'} | set(HTML_RENDERERS) | LAYOUT_BLOCKS

    @pytest.mark.parametrize('name', SAMPLE_NAMES)
    def test_sample_papers_are_valid_and_total_50(self, name):
        document = _sample(name)
        assert validate_document(document) == []
        assert total_marks(document) == 50

    def test_problems_are_reported_per_question(self):
        errors = validate_document(_paper(
            {'type': 'writing_grid', 'data': {'rows': 4, 'cols': 5}, 'marks': 5},
            {'type': 'hologram', 'data': {}},
            {'type': 'writing_grid', 'data': {'rows': 4}},
            {'type': 'writing_grid', 'data': {'rows': 400, 'cols': True}},
            {'type': 'oral', 'data': {'items': []}, 'marks': -1},
        ))
        assert len(errors) == 5
        assert errors[0].startswith('Question 2') and 'hologram' in errors[0]
        assert errors[1] == 'Question 3: Columns: missing or the wrong kind of value.'
        assert errors[2] == 'Question 4: Rows: must be between 1 and 30.'
        assert errors[3].startswith('Question 4: Columns:')
        assert errors[4].startswith('Question 5') and 'marks' in errors[4]

    def test_empty_match_column_parts_do_not_flag_the_paper(self, store):
        # A new part is blank until filled; it used to look like a broken paper while editing (demo findings 4).
        document = _paper({'type': 'match_columns', 'marks': 5, 'data': {
            'left': [{'text': 'Cat'}, {}, {'text': '', 'picture': None}],
            'right': [{'text': 'Meow'}, {}],
        }})
        assert validate_document(document) == []
        render_html(document, store)

    def test_a_paper_without_blocks_is_rejected(self):
        assert validate_document({'header': {}}) == ['The paper has no list of blocks.']
        assert validate_document([]) == ['The paper must be an object.']


class TestPictures:
    def test_every_library_svg_has_its_png_copy(self):
        missing = [svg.name for svg in LIBRARY_DIR.glob('*.svg') if not svg.with_suffix('.png').is_file()]
        assert missing == [], 'run scripts/paper_pictures_to_png.py'

    def test_names_are_never_used_as_paths(self, store):
        for name in ('../samples/pictures/cat', '..\\secrets', 'cat.png', '/etc/passwd', '', None, 5):
            assert store.has(name) is False
            assert store.data_uri(name) is None
            assert store.png_image(name) is None

    def test_library_art_is_served_as_svg_and_uploads_as_png(self, store):
        assert store.data_uri('star').startswith('data:image/svg+xml;base64,')
        assert store.data_uri('cat').startswith('data:image/png;base64,')


class TestScenes:
    @pytest.mark.parametrize('name', SAMPLE_NAMES)
    def test_every_drawing_stays_inside_the_page_width(self, name):
        for block in _sample(name)['blocks']:
            scene = layouts.build_scene(block)
            if scene is None:
                continue
            assert scene.width == layouts.SCENE_WIDTH
            for kind, p in scene.items:
                if kind in ('rect', 'picture'):
                    assert p['x'] >= 0 and p['x'] + p['w'] <= scene.width, (block['type'], kind, p)
                    assert p['y'] >= 0 and p['y'] + p['h'] <= scene.height, (block['type'], kind, p)
                elif kind == 'circle':
                    assert p['cx'] - p['r'] >= 0 and p['cx'] + p['r'] <= scene.width, (block['type'], p)
                    assert p['cy'] + p['r'] <= scene.height, (block['type'], p)

    def test_find_and_colour_circles_never_overlap(self):
        scene = layouts.find_colour({'target': 'A', 'items': list('ABCDEFGHIJKLMNOPQRSTUVWX')})
        circles = [p for kind, p in scene.items if kind == 'circle']
        # 24 asked for, 20 fit: the extra ones are dropped rather than drawn off the page.
        assert len(circles) == layouts.FIND_COLOUR_MAX == 20
        for i, a in enumerate(circles):
            for b in circles[i + 1:]:
                distance = ((a['cx'] - b['cx']) ** 2 + (a['cy'] - b['cy']) ** 2) ** 0.5
                assert distance >= a['r'] + b['r']

    def test_a_short_last_row_is_centred(self):
        scene = layouts.missing_sequence({'shape': 'box', 'per_row': 4, 'items': ['1', '2', '3', '4', '5', '6']})
        xs = [p['x'] + p['w'] / 2 for kind, p in scene.items if kind == 'rect']
        assert xs[4] + xs[5] == pytest.approx(layouts.SCENE_WIDTH)

    def test_odd_data_still_draws(self, store):
        for block_type, builder in layouts.SCENE_BUILDERS.items():
            for data in ({}, {'rows': 'x', 'cols': None, 'items': None, 'left': None, 'right': None}):
                scene = builder(data)
                assert scene.height > 0, block_type
                to_svg(scene, store)

    def test_an_unknown_picture_prints_as_a_named_empty_box(self, store):
        scene = layouts.colour_picture({'picture': 'no_such_picture'})
        svg = to_svg(scene, store)
        assert '<image' not in svg and '>no_such_picture<' in svg
        assert to_png(scene, store, scale=1)[:8] == b'\x89PNG\r\n\x1a\n'

    def test_png_size_follows_the_scale(self, store):
        from PIL import Image
        scene = layouts.writing_grid({'rows': 2, 'cols': 3})
        image = Image.open(io.BytesIO(to_png(scene, store, scale=2)))
        assert image.size == (round(scene.width * 2), round(scene.height * 2))


class TestHtml:
    @pytest.mark.parametrize('name', SAMPLE_NAMES)
    def test_sample_paper_renders_every_question(self, name, store):
        document = _sample(name)
        html = render_html(document, store)
        for number, block in enumerate(document['blocks'], start=1):
            assert f'Q{number}: ' in html
        assert html.count('<section class="q">') == len(document['blocks'])
        assert 'THE FOCUS MONTESSORI &amp; SCHOOL' in html
        assert '2<sup>nd</sup> Term Examination' in html
        assert '<th>Total</th>' in html and '<td>50</td>' in html
        # Sample pictures are all known, so nothing falls back to the empty box.
        assert 'stroke-dasharray="6 5"/><text' not in html

    def test_teacher_text_cannot_inject_markup(self, store):
        document = _paper({'type': 'oral', 'title': '<script>alert(1)</script>', 'marks': 2,
                           'data': {'items': [{'text': '<img src=x onerror=alert(1)>', 'marks': 2}]}})
        document['header']['school_name'] = '</h1><script>x</script>'
        document['footer'] = 'a"; } body { display: none } /*'
        html = render_html(document, store)
        assert '<script>' not in html and '<img src=x' not in html
        assert 'content: "a\\"; } body { display: none } /*";' in html

    def test_marks_table_can_be_turned_off(self, store):
        document = _paper({'type': 'writing_grid', 'title': 'Write', 'marks': 5, 'data': {'rows': 1, 'cols': 2}})
        assert 'For office Use Only' in render_html(document, store)
        document['header']['marks_table'] = False
        assert 'For office Use Only' not in render_html(document, store)

    def test_right_to_left_papers_set_the_page_direction(self, store):
        document = _paper()
        document['direction'] = 'rtl'
        assert '<html lang="ur" dir="rtl">' in render_html(document, store)


class TestDocx:
    @pytest.mark.parametrize('name', SAMPLE_NAMES)
    def test_sample_paper_becomes_a_word_file(self, name, store):
        from docx import Document
        document = _sample(name)
        word = Document(io.BytesIO(render_docx(document, store)))
        text = '\n'.join(paragraph.text for paragraph in word.paragraphs)
        for number, block in enumerate(document['blocks'], start=1):
            assert f'Q{number}: {block["title"]}' in text
        drawings = [block for block in document['blocks'] if block['type'] != 'oral']
        assert len(word.inline_shapes) == len(drawings)
        table = word.tables[0]
        assert len(table.columns) == len(document['blocks']) + 2
        assert [cell.text for cell in table.rows[1].cells][-1] == '50'
        # Oral questions stay as text the teacher can edit in Word.
        assert document['blocks'][-1]['data']['items'][0]['text'] in text

    def test_drawings_are_exactly_as_wide_as_the_text_area(self, store):
        from docx import Document
        from docx.shared import Mm
        document = _paper({'type': 'writing_grid', 'title': 'Write', 'marks': 5, 'data': {'rows': 1, 'cols': 2}})
        word = Document(io.BytesIO(render_docx(document, store)))
        section = word.sections[0]
        text_width = section.page_width - section.left_margin - section.right_margin
        assert abs(word.inline_shapes[0].width - text_width) <= Mm(0.1)
