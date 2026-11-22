"""Block list -> one self-contained HTML page (A4). The page is the preview, and the PDF is made by
printing it on the device, so no PDF engine runs on the server and the browser does Urdu shaping."""
import re
from html import escape
from typing import Any, Dict, List

from .layouts import build_scene
from .registry import block_marks, block_to_fill, format_marks, is_question, question_blocks, total_marks
from .scene import to_svg
from .text_blocks import HTML_RENDERERS, TEXT_CSS, attempt_note, has_math
from .urdu import URDU_FONT, document_has_urdu, font_face_css, is_rtl, isolate_latin, labels_for

_ORDINAL = re.compile(r'\b(\d+)(st|nd|rd|th)\b')

CSS = """
@page {
  size: A4;
  margin: 15mm 18mm 16mm 18mm;
  @%(footer_side)s { content: "%(footer)s"; font: 8pt %(fonts)s; color: #64748b; }
  @%(page_side)s { content: "%(page)s " counter(page) " %(of)s " counter(pages);
                  font: 8pt %(fonts)s; color: #64748b; }
}
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #1f2937; font: 11pt "Trebuchet MS", "Segoe UI", Arial, sans-serif; }
@media screen { body { max-width: 174mm; margin: 12mm auto; } }
.head { font-family: Georgia, "Times New Roman", serif; text-align: center; }
.head h1 { margin: 0 0 3mm; font-size: 19pt; text-decoration: underline; letter-spacing: .2px; }
.head p { margin: 0 0 2mm; font-size: 12pt; font-weight: 700; }
.head .meta span { margin: 0 3mm; }
.cand { margin: 4mm 12mm 3mm; font-family: Georgia, "Times New Roman", serif; font-weight: 700; font-size: 11pt; }
.cand .row { display: flex; align-items: flex-end; gap: 2mm; margin-bottom: 3.5mm; }
.cand .fill { flex: 1; border-bottom: 1.5px solid #1f2937; height: 5mm; }
.cand .gap { width: 10mm; }
.office { border: 2px solid #1f2937; padding: 3mm; margin-bottom: 6mm; break-inside: avoid;
          font-family: Georgia, "Times New Roman", serif; }
.office .title { font-weight: 700; text-decoration: underline; margin-bottom: 2.5mm; }
.office table { width: 100%%; border-collapse: collapse; table-layout: fixed; }
.office td, .office th { border: 1.5px solid #1f2937; height: 7.5mm; text-align: center; font-size: 10pt; font-weight: 700; }
.office th:first-child, .office td:first-child { width: 16%%; }
.office .sign { display: flex; justify-content: flex-end; align-items: flex-end; gap: 2mm; margin-top: 3mm; font-weight: 700; }
.office .sign i { width: 35mm; border-bottom: 1.5px solid #1f2937; height: 5mm; }
.q { break-inside: avoid; padding: 0 0 3mm; margin-bottom: 3mm; border-bottom: 1px dashed #cbd5e1; }
.q:last-child { border-bottom: 0; }
.q-title { display: flex; justify-content: space-between; align-items: baseline; gap: 4mm;
           font-weight: 700; font-size: 12pt; margin-bottom: 3mm; }
.q-title .marks { color: #1e3a8a; white-space: nowrap; }
.q.text { break-inside: auto; }
.q.text .q-title { break-after: avoid; }
.scene { display: block; width: 100%%; height: auto; }
.scene text { font-family: "Trebuchet MS", "Segoe UI", Arial, sans-serif; }
.oral { border: 1.5px solid #1e3a8a; border-radius: 2mm; background: #f8fafc; padding: 3mm 4mm 1mm; }
.oral .q-title { margin-bottom: 2mm; }
.oral .item { display: flex; justify-content: space-between; margin-bottom: 2mm; }
.oral .item b { color: #1e3a8a; }
.facts { display: flex; justify-content: space-between; margin: 0 12mm 3mm; font: 700 11pt Georgia, "Times New Roman", serif; }
.instructions { margin: 0 0 4mm; padding: 2.5mm 4mm; border-inline-start: 3px solid #1e3a8a; background: #f8fafc; }
.instructions b { display: block; margin-bottom: 1mm; }
.instructions p { margin: 0 0 .8mm; }
[dir="rtl"] .q-title, [dir="rtl"] .part { direction: rtl; }
/* Urdu: Nastaliq first (it has no Latin letters, so English words fall through to the Latin fonts). Its
   letters are tall, so lines get more room. */
html[dir="rtl"] body, html[dir="rtl"] .head, html[dir="rtl"] .cand, html[dir="rtl"] .office, html[dir="rtl"] .facts,
html[dir="rtl"] h2.section, [dir="rtl"] .pt, :lang(ur) {
  font-family: "%(urdu)s", "Trebuchet MS", "Segoe UI", Arial, serif; }
html[dir="rtl"] body { line-height: 2; }
html[dir="rtl"] .head h1 { font-size: 21pt; }
html[dir="rtl"] .q-title { font-size: 13pt; }
/* Numbers, marks and equations keep their own direction inside an Urdu line. */
.marks, .math, .katex, .blank { unicode-bidi: isolate; }
.math, .katex { direction: ltr; }
""" + TEXT_CSS.replace('%', '%%')


def _text(value: Any) -> str:
    return escape(str(value if value is not None else ''))


def _with_ordinals(value: Any) -> str:
    """"2nd Term" prints with the "nd" raised, as schools write it."""
    return _ORDINAL.sub(r'\1<sup>\2</sup>', _text(value))


def _css_string(value: Any) -> str:
    return str(value or '').replace('\\', '\\\\').replace('"', '\\"').replace('\n', ' ').replace('\r', ' ')


def _header_html(document: Dict[str, Any], labels: Dict[str, str]) -> str:
    header = document.get('header') or {}
    parts: List[str] = ['<header class="head">']
    parts.append(f'<h1>{_text(header.get("school_name"))}</h1>')
    if header.get('exam_title'):
        parts.append(f'<p>{_with_ordinals(header["exam_title"])}</p>')
    meta = []
    if header.get('subject'):
        meta.append(f'<span>{labels[subject_label_key(header)]}: {_text(header["subject"])}</span>')
    if header.get('class_name'):
        meta.append(f'<span>{labels["class"]}: {_text(header["class_name"])}</span>')
    if meta:
        parts.append(f'<p class="meta">{"".join(meta)}</p>')
    parts.append('</header>')
    parts.append(
        '<div class="cand">'
        f'<div class="row"><span>{labels["name"]}:</span><span class="fill"></span></div>'
        f'<div class="row"><span>{labels["roll"]}:</span><span class="fill"></span><span class="gap"></span>'
        f'<span>{labels["date"]}:</span><span class="fill"></span></div>'
        '</div>'
    )
    if header.get('show_time_marks'):
        facts = []
        if header.get('time_label'):
            facts.append(f'<span>{labels["time"]}: {_text(header["time_label"])}</span>')
        facts.append(f'<span>{labels["total_marks"]}: {format_marks(total_marks(document))}</span>')
        parts.append(f'<div class="facts">{"".join(facts)}</div>')
    blocks = question_blocks(document)
    if header.get('marks_table', True) and blocks:
        numbers = ''.join(f'<th>{i}</th>' for i in range(1, len(blocks) + 1))
        totals = ''.join(f'<td>{format_marks(block_marks(block))}</td>' for block in blocks)
        empty = '<td></td>' * (len(blocks) + 1)
        parts.append(
            f'<div class="office"><div class="title">{labels["office"]}</div><table>'
            f'<tr><th>{labels["office_question"]}</th>{numbers}<th>{labels["office_total"]}</th></tr>'
            f'<tr><td>{labels["office_total"]}</td>{totals}<td>{format_marks(total_marks(document))}</td></tr>'
            f'<tr><td>{labels["office_obtained"]}</td>{empty}</tr>'
            f'</table><div class="sign"><span>{_text(sign_label(header, labels))}:</span><i></i></div></div>'
        )
    instructions = [line.strip() for line in str(header.get('instructions') or '').splitlines() if line.strip()]
    if instructions:
        lines = ''.join(f'<p>{_text(line)}</p>' for line in instructions)
        parts.append(f'<div class="instructions"><b>{labels["instructions"]}</b>{lines}</div>')
    return ''.join(parts)


def subject_label_key(header: Dict[str, Any]) -> str:
    """"Paper: Maths" on a paper, "Subject: Maths" on a worksheet."""
    return 'subject' if header.get('kind') == 'worksheet' else 'paper'


def sign_label(header: Dict[str, Any], labels: Dict[str, str]) -> str:
    """The teacher's own wording wins; the stock English default is swapped for Urdu on Urdu papers."""
    typed = str(header.get('sign_label') or '').strip()
    return labels['sign'] if not typed or typed == 'Teacher’s Sign' else typed


def _title_html(number: int, block: Dict[str, Any], labels: Dict[str, str]) -> str:
    marks = block.get('marks')
    marks_html = f'<span class="marks">({format_marks(block_marks(block))})</span>' if marks is not None else ''
    note = attempt_note(block, labels)
    note_html = f'<span class="note">{_text(note)}</span>' if note else ''
    question = labels['question'].format(n=number)
    return f'<div class="q-title"><span>{question} {_text(block.get("title"))}{note_html}</span>{marks_html}</div>'


def _open(block: Dict[str, Any], classes: str, interactive: bool) -> str:
    """A question's opening tag. The preview marks each question with its block id so the editor can scroll to
    the one being typed and a tap on the page can choose it; a question with empty parts gets a "still to fill"
    frame there (Structure step). The printed page has neither."""
    if not interactive:
        return f'<section class="{classes}">'
    if block_to_fill(block):
        classes += ' todo'
    return f'<section class="{classes}" data-block="{escape(str(block.get("id") or ""), quote=True)}">'


def _oral_html(number: int, block: Dict[str, Any], labels: Dict[str, str], interactive: bool = False) -> str:
    rows = []
    for index, item in enumerate((block.get('data') or {}).get('items') or [], start=1):
        item = item if isinstance(item, dict) else {'text': item}
        marks = f'<b>({format_marks(float(item["marks"]))})</b>' if isinstance(item.get('marks'), (int, float)) else ''
        rows.append(f'<div class="item"><span>{index}. {_text(item.get("text"))}</span>{marks}</div>')
    return f'{_open(block, "q", interactive)}<div class="oral">{_title_html(number, block, labels)}{"".join(rows)}</div></section>'


def render_html(document: Dict[str, Any], store, interactive: bool = False, show: str = '') -> str:
    """The whole paper as one HTML page. Pictures are embedded, so the page works offline and in a
    phone's print view. ``interactive``: the editors' preview (questions marked, tap to choose, ``show`` = the
    block to scroll to when the page opens, since every edit loads a new page)."""
    rtl = is_rtl(document)
    labels = labels_for(document)
    body: List[str] = [_header_html(document, labels)]
    number = 0
    for block in document.get('blocks') or []:
        if not isinstance(block, dict):
            continue
        if not is_question(block):
            mark = f' data-block="{escape(str(block.get("id") or ""), quote=True)}"' if interactive else ''
            body.append(f'<h2 class="section"{mark}>{_text(block.get("title"))}</h2>')
            continue
        number += 1
        text_renderer = HTML_RENDERERS.get(block.get('type'))
        if text_renderer is not None:
            body.append(f'{_open(block, "q text", interactive)}{_title_html(number, block, labels)}{text_renderer(block, store, labels)}</section>')
            continue
        scene = build_scene(block, rtl)
        if scene is None:
            body.append(_oral_html(number, block, labels, interactive))
        else:
            body.append(f'{_open(block, "q", interactive)}{_title_html(number, block, labels)}{to_svg(scene, store)}</section>')
    if not interactive:
        return page_html(document, ''.join(body))
    show_attr = escape(str(show or ''), quote=True)
    return page_html(document, ''.join(body) + PREVIEW_SCRIPT, extra_css=PREVIEW_CSS).replace(
        '<body>', f'<body data-show="{show_attr}">', 1)


PREVIEW_CSS = """
@media screen {
  [data-block] { cursor: pointer; border-radius: 2mm; }
  [data-block]:hover { background: #f8fafc; }
  .todo { outline: 1.5px dashed #f59e0b; outline-offset: 1.5mm; position: relative; }
  .todo::before { content: "still to fill"; position: absolute; top: -3.2mm; right: 2mm; background: #fffbeb;
                  color: #b45309; font: 8pt Arial, sans-serif; padding: 0 1.5mm; border-radius: 1mm; }
  .current { outline: 2px solid #3b82f6; outline-offset: 1.5mm; }
}
"""

# The preview frame is sandboxed (no origin), so the page and the editor talk by messages only: the page says which
# question was tapped, the editor says which one to show. The phone's WebView uses ReactNativeWebView instead.
# It scrolls its own window, never scrollIntoView: that also scrolled the editor page around the frame, so choosing a
# question in the list moved the whole screen to the preview.
PREVIEW_SCRIPT = """<script>(function(){
function send(m){try{if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify(m));}else{parent.postMessage(m,'*');}}catch(e){}}
function show(id,smooth){var old=document.querySelector('.current');if(old){old.classList.remove('current');}
if(!id){return;}var el=null;document.querySelectorAll('[data-block]').forEach(function(x){if(x.getAttribute('data-block')===id){el=x;}});
if(el){el.classList.add('current');var r=el.getBoundingClientRect();
var top=window.scrollY+r.top-Math.max(16,(window.innerHeight-r.height)/2);
window.scrollTo({top:Math.max(0,top),behavior:smooth?'smooth':'auto'});}}
document.addEventListener('click',function(e){var el=e.target.closest&&e.target.closest('[data-block]');if(el){send({paperBlock:el.getAttribute('data-block')});}});
function onMessage(e){var d=e.data;if(typeof d==='string'){try{d=JSON.parse(d);}catch(x){return;}}if(d&&typeof d.paperShow==='string'){show(d.paperShow,true);}}
window.addEventListener('message',onMessage);document.addEventListener('message',onMessage);
window.paperShow=function(id){show(id,true);};
show(document.body.getAttribute('data-show'),false);
})();</script>"""


def page_html(document: Dict[str, Any], body_html: str, extra_css: str = '') -> str:
    """The A4 page around a body: styles, footer and page numbers, Urdu font and direction, maths.
    Shared by the paper and its answer key (answer_key.py)."""
    rtl = is_rtl(document)
    direction = 'rtl' if rtl else 'ltr'
    labels = labels_for(document)
    title = _text(document.get('footer') or (document.get('header') or {}).get('exam_title') or 'Paper')
    latin = '"Trebuchet MS", "Segoe UI", Arial, sans-serif'
    css = CSS % {
        'footer': _css_string(document.get('footer')), 'urdu': URDU_FONT,
        'page': labels['page'], 'of': labels['of'],
        'fonts': f'"{URDU_FONT}", {latin}' if rtl else latin,
        # The footer starts on the reading side: the right on an Urdu paper.
        'footer_side': 'bottom-right' if rtl else 'bottom-left',
        'page_side': 'bottom-left' if rtl else 'bottom-right',
    }
    if document_has_urdu(document):
        css = font_face_css() + css
    css += extra_css
    if rtl:
        # English inside Urdu keeps its own order (see urdu.isolate_latin).
        body_html = isolate_latin(body_html)
    return (
        f'<!DOCTYPE html><html lang="{"ur" if rtl else "en"}" dir="{direction}"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<title>{title}</title><style>{css}</style>{_katex(document)}</head><body>{body_html}</body></html>'
    )


KATEX_VERSION = '0.16.11'


def _katex(document: Dict[str, Any]) -> str:
    """Equations are drawn by KaTeX in the page (the user accepted loading it from the internet at print
    time; offline, an equation shows as its LaTeX source). Only added when the paper has maths."""
    if not has_math(document):
        return ''
    base = f'https://cdn.jsdelivr.net/npm/katex@{KATEX_VERSION}/dist'
    return (
        f'<link rel="stylesheet" href="{base}/katex.min.css">'
        f'<script defer src="{base}/katex.min.js" onload="document.querySelectorAll(&quot;.math&quot;).forEach('
        f'function(el){{katex.render(el.textContent, el, {{throwOnError: false}});}})"></script>'
    )
