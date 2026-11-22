"""Urdu in the Word file: right-to-left paragraphs and tables, Urdu runs marked as right-to-left text in the
Nastaliq font, and the font itself embedded in the file so a teacher's PC without it still shows Nastaliq.

The renderers write runs as usual; ``apply_urdu`` goes over the finished document once, so every place that
adds text (headings, parts, options, tables, footer) is covered without each one knowing about Urdu.
"""
import copy
import io
import re
import uuid
import zipfile
from typing import Iterable

from .urdu import ARABIC_SCRIPT, URDU_FONT, font_bytes, latin_stretches

# English stretches (the page's rule, urdu.latin_stretches) and the ASCII signs the Nastaliq font has no
# letter for ("_" answer lines, $, ?, @ ...) stay left-to-right runs in the Latin font inside an Urdu line;
# digits, spaces and other punctuation go with the Urdu. (Found with fontTools: the font lacks these signs
# and every Latin letter.)
_NO_URDU_GLYPH = '"#$%&\'*;<>?@^_`~'
_NO_GLYPH_RUN = re.compile(f"([{re.escape(_NO_URDU_GLYPH)}]+)")
_URDU_PIECE = re.compile(
    f'(?:{ARABIC_SCRIPT.pattern}|[\\s،؟۔])*{ARABIC_SCRIPT.pattern}(?:{ARABIC_SCRIPT.pattern}|[\\s،؟۔])*'
)

# Word ignores settings written out of the schema's order, so new ones go in their place.
_RPR_ORDER = ('w:rStyle', 'w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:caps', 'w:smallCaps', 'w:strike',
              'w:dstrike', 'w:outline', 'w:shadow', 'w:emboss', 'w:imprint', 'w:noProof', 'w:snapToGrid',
              'w:vanish', 'w:webHidden', 'w:color', 'w:spacing', 'w:w', 'w:kern', 'w:position', 'w:sz',
              'w:szCs', 'w:highlight', 'w:u', 'w:effect', 'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign',
              'w:rtl', 'w:cs', 'w:em', 'w:lang', 'w:eastAsianLayout', 'w:specVanish', 'w:oMath')
_PPR_ORDER = ('w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore', 'w:framePr', 'w:widowControl',
              'w:numPr', 'w:suppressLineNumbers', 'w:pBdr', 'w:shd', 'w:tabs', 'w:suppressAutoHyphens',
              'w:kinsoku', 'w:wordWrap', 'w:overflowPunct', 'w:topLinePunct', 'w:autoSpaceDE', 'w:autoSpaceDN',
              'w:bidi', 'w:adjustRightInd', 'w:snapToGrid', 'w:spacing', 'w:ind', 'w:contextualSpacing',
              'w:mirrorIndents', 'w:suppressOverlap', 'w:jc', 'w:textDirection', 'w:textAlignment',
              'w:textboxTightWrap', 'w:outlineLvl', 'w:divId', 'w:cnfStyle', 'w:rPr', 'w:sectPr', 'w:pPrChange')
_TBLPR_ORDER = ('w:tblStyle', 'w:tblpPr', 'w:tblOverlap', 'w:bidiVisual', 'w:tblStyleRowBandSize',
                'w:tblStyleColBandSize', 'w:tblW', 'w:jc', 'w:tblCellSpacing', 'w:tblInd', 'w:tblBorders',
                'w:shd', 'w:tblLayout', 'w:tblCellMar', 'w:tblLook', 'w:tblCaption', 'w:tblDescription')
_ORDERS = {'w:rPr': _RPR_ORDER, 'w:pPr': _PPR_ORDER, 'w:tblPr': _TBLPR_ORDER}


def _qn(tag):
    from docx.oxml.ns import qn
    return qn(tag)


def _child(parent, tag, *, first=False):
    """The existing child element ``tag`` or a new one, placed where the schema wants it."""
    from docx.oxml import OxmlElement
    found = parent.find(_qn(tag))
    if found is not None:
        return found
    found = OxmlElement(tag)
    order = next((seq for name, seq in _ORDERS.items() if parent.tag == _qn(name)), None)
    if order and tag in order:
        later = {_qn(name) for name in order[order.index(tag) + 1:]}
        for index, existing in enumerate(parent):
            if existing.tag in later:
                parent.insert(index, found)
                return found
        parent.append(found)
    elif first:
        parent.insert(0, found)
    else:
        parent.append(found)
    return found


def _paragraphs(doc) -> Iterable:
    def walk(container):
        for paragraph in container.paragraphs:
            yield paragraph
        for table in container.tables:
            for row in table.rows:
                for cell in row.cells:
                    yield from walk(cell)
    yield from walk(doc)
    for section in doc.sections:
        yield from walk(section.footer)
        yield from walk(section.header)


def _tables(doc):
    def walk(container):
        for table in container.tables:
            yield table
            for row in table.rows:
                for cell in row.cells:
                    yield from walk(cell)
    yield from walk(doc)


def _segments(text: str, rtl: bool):
    """(piece, is_rtl) in reading order. On an Urdu paper everything but Latin words is right-to-left;
    on an English paper only the pieces with Urdu letters are."""
    out, position = [], 0
    if not rtl:
        for match in _URDU_PIECE.finditer(text):
            if match.start() > position:
                out.append((text[position:match.start()], False))
            out.append((match.group(), True))
            position = match.end()
        if position < len(text):
            out.append((text[position:], False))
        return out
    for start, end in latin_stretches(text) + [(len(text), len(text))]:
        for piece in _NO_GLYPH_RUN.split(text[position:start]):
            if piece:
                out.append((piece, not _NO_GLYPH_RUN.fullmatch(piece)))
        if end > start:
            out.append((text[start:end], False))
        position = end
    return out


def _mark_rtl(r_element) -> None:
    """Right-to-left run in the Urdu font, with bold and size copied to their complex-script twins (Word
    uses those, not the plain ones, for Urdu letters)."""
    r_pr = _child(r_element, 'w:rPr', first=True)
    _child(r_pr, 'w:rFonts').set(_qn('w:cs'), URDU_FONT)
    if r_pr.find(_qn('w:b')) is not None:
        _child(r_pr, 'w:bCs')
    size = r_pr.find(_qn('w:sz'))
    if size is not None:
        _child(r_pr, 'w:szCs').set(_qn('w:val'), size.get(_qn('w:val')))
    _child(r_pr, 'w:rtl')


def _split_run(run, rtl: bool) -> None:
    from docx.oxml import OxmlElement
    r = run._r
    text = run.text
    if not text or (not rtl and not ARABIC_SCRIPT.search(text)):
        return
    # A run holding a field, a tab or a picture is kept whole and marked as a unit.
    if any(child.tag not in (_qn('w:rPr'), _qn('w:t')) for child in r):
        _mark_rtl(r)
        return
    segments = _segments(text, rtl)
    if len(segments) == 1:
        if segments[0][1]:
            _mark_rtl(r)
        return
    anchor = r
    for piece, is_rtl in segments:
        clone = copy.deepcopy(r)
        for t in clone.findall(_qn('w:t')):
            clone.remove(t)
        t = OxmlElement('w:t')
        t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
        t.text = piece
        clone.append(t)
        if is_rtl:
            _mark_rtl(clone)
        anchor.addnext(clone)
        anchor = clone
    r.getparent().remove(r)


def apply_urdu(doc, rtl: bool) -> None:
    """``rtl``: the whole paper reads right to left. Otherwise only Urdu pieces of an English paper are
    marked, so they still join and use the Urdu font."""
    defaults = doc.styles.element.find(_qn('w:docDefaults'))
    if defaults is not None:
        r_pr = _child(_child(defaults, 'w:rPrDefault'), 'w:rPr')
        _child(r_pr, 'w:rFonts').set(_qn('w:cs'), URDU_FONT)
        _child(r_pr, 'w:lang').set(_qn('w:bidi'), 'ur-PK')
    for paragraph in list(_paragraphs(doc)):
        if rtl:
            _child(paragraph._p.get_or_add_pPr(), 'w:bidi')
        for run in list(paragraph.runs):
            _split_run(run, rtl)
    if rtl:
        for table in _tables(doc):
            _child(table._tbl.tblPr, 'w:bidiVisual')


# ---------------------------------------------------------------- embedded font

_FONT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font'
_FONT_TYPE = 'application/vnd.openxmlformats-officedocument.obfuscatedFont'
_R_NS = b'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'


def obfuscate(data: bytes, key: uuid.UUID) -> bytes:
    """Word's embedded-font scrambling (ECMA-376 Part 2, ODTTF): the first 32 bytes are XORed with the
    font key's 16 bytes taken in reverse order. Doing it twice gives the font back."""
    key_bytes = bytes.fromhex(key.hex)[::-1]
    return bytes(b ^ key_bytes[i % 16] for i, b in enumerate(data[:32])) + data[32:]


def embed_urdu_font(docx_bytes: bytes) -> bytes:
    """The same .docx with Noto Nastaliq Urdu (regular and bold) inside, so it shows on a PC that does not
    have it. Word only uses embedded fonts when the file asks (``w:embedTrueTypeFonts``)."""
    source = zipfile.ZipFile(io.BytesIO(docx_bytes))
    fonts = []
    for bold, tag in ((False, 'embedRegular'), (True, 'embedBold')):
        key = uuid.uuid4()
        fonts.append((f'fonts/urdu{len(fonts) + 1}.odttf', tag, key, obfuscate(font_bytes(bold), key)))

    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as target:
        for name in source.namelist():
            data = source.read(name)
            if name == '[Content_Types].xml' and b'Extension="odttf"' not in data:
                data = data.replace(b'</Types>', f'<Default Extension="odttf" ContentType="{_FONT_TYPE}"/></Types>'.encode())
            elif name == 'word/settings.xml' and b'embedTrueTypeFonts' not in data:
                data = re.sub(rb'(<w:settings\b[^>]*>)', rb'\1<w:embedTrueTypeFonts/>', data, count=1)
            elif name == 'word/fontTable.xml':
                entries = ''.join(
                    f'<w:{tag} r:id="rIdUrduFont{i}" w:fontKey="{{{str(key).upper()}}}"/>'
                    for i, (_, tag, key, _) in enumerate(fonts, start=1)
                )
                font_xml = (
                    f'<w:font w:name="{URDU_FONT}"><w:charset w:val="00"/><w:family w:val="auto"/>'
                    f'<w:pitch w:val="variable"/>{entries}</w:font>'
                )
                data = data.replace(b'</w:fonts>', font_xml.encode('utf-8') + b'</w:fonts>')
                opening = re.search(rb'<w:fonts\b[^>]*>', data)
                if opening and b'xmlns:r=' not in opening.group():
                    data = data.replace(b'<w:fonts', b'<w:fonts ' + _R_NS, 1)
            target.writestr(name, data)
        relationships = ''.join(
            f'<Relationship Id="rIdUrduFont{i}" Type="{_FONT_REL}" Target="{path}"/>'
            for i, (path, _, _, _) in enumerate(fonts, start=1)
        )
        target.writestr(
            'word/_rels/fontTable.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'{relationships}</Relationships>',
        )
        for path, _, _, data in fonts:
            target.writestr(f'word/{path}', data)
    return out.getvalue()
