"""
Question/instruction text is authored in the frontend as TipTap HTML (RichTextEditor.jsx)
and can now include inline LaTeX equations rendered by the KaTeX-based math extension, plus
an RTL language wrapper (`<div dir=".." lang="..">`). Feeding that raw into either exporter
breaks things:

- PDF (pdf_generator.py) hands question_text straight to a ReportLab `Paragraph`, which
  parses a tiny, strict XML dialect — any `class`/`style` attribute (which is exactly what
  KaTeX's `<span class="katex-html" style="...">` visual tree and TipTap's table cells emit)
  raises `paraparser: syntax error` and aborts the whole paper's PDF generation. A stray
  unescaped `<`/`&`/`>` in a teacher's plain question text has always been able to trigger
  this too — it's not new to equations.
- DOCX (docx_generator.py) uses Django's `strip_tags`, which doesn't crash but concatenates
  both of KaTeX's parallel representations — the MathML glyphs (`<mi>x</mi><mn>2</mn>...`)
  *and* the `<annotation>` raw LaTeX source *and* the visual span tree's stray text — into
  duplicated/garbled output for any equation.

Both exporters go through this module instead. A KaTeX node renders as:

    <span class="katex">
      <span class="katex-mathml"><math>...glyphs...<annotation>x^2</annotation></math></span>
      <span class="katex-html" aria-hidden="true">...CSS-positioned visual tree...</span>
    </span>

We drop `.katex-html` outright (pure CSS positioning, no meaningful text) and drop the
MathML glyph markup too, keeping only the `<annotation>` text — so an equation prints as
readable LaTeX (e.g. "x^2") instead of crashing or garbling. Everything else is either kept
(a small inline allowlist for PDF) or unwrapped to plain text.

RTL/right-to-left rendering is NOT solved here — ReportLab has no bidi text shaping and
python-docx's paragraph direction needs separate handling per run. The `dir`/`lang` wrapper
is simply dropped (unwrapped) by both paths for now; Urdu/Arabic/Pashto/Sindhi question text
still prints left-to-right until that's built.
"""
import re
from html import escape
from html.parser import HTMLParser

from django.utils.html import strip_tags

# ReportLab's Paragraph markup parser only understands this handful of inline tags, and only
# with no attributes at all — anything else (div, span, table, h1, ul/li, or any class/style
# attribute) raises a hard exception rather than degrading gracefully.
_PDF_SAFE_TAGS = {'b', 'strong', 'i', 'em', 'u', 'strike', 's', 'sup', 'sub', 'br'}
_PDF_TAG_MAP = {'strong': 'b', 'em': 'i', 's': 'strike'}

# DOCX renders question_text as plain text (no inline tags at all), but the original
# `_html_to_text` helper it replaces turned `<br>` into a line break and `</p>` into a
# paragraph break before stripping tags — replicate that so multi-paragraph questions don't
# collapse onto one line.
_DOCX_VOID_NEWLINE_TAGS = {'br'}
_DOCX_CLOSE_NEWLINE_TAGS = {'p'}

# Modes for the tag-stack walk below:
#  - 'normal'    : re-emit per _keep_tags, keep text
#  - 'skip-hard' : drop this subtree entirely, no exceptions (katex-html visual tree)
#  - 'skip-soft' : drop text in this subtree, but a nested <annotation> switches to 'annotation'
#                  (katex-mathml: its own glyphs are noise, but its <annotation> child isn't)
#  - 'annotation': keep text raw (the actual LaTeX source)


class _MathAwareStripper(HTMLParser):
    """Walks question_text HTML, keeping only an allowlisted set of inline tags (everything
    else unwrapped) and collapsing each KaTeX node down to its plain-LaTeX <annotation>."""

    def __init__(self, keep_tags, tag_map, escape_text, void_newline_tags=frozenset(), close_newline_tags=frozenset()):
        super().__init__(convert_charrefs=True)
        self.out = []
        self._keep_tags = keep_tags
        self._tag_map = tag_map
        self._escape = escape_text
        self._void_newline_tags = void_newline_tags
        self._close_newline_tags = close_newline_tags
        self._mode_stack = []  # list of (tag, mode)

    def _parent_mode(self):
        return self._mode_stack[-1][1] if self._mode_stack else 'normal'

    def handle_starttag(self, tag, attrs):
        parent_mode = self._parent_mode()

        if parent_mode == 'skip-hard':
            self._mode_stack.append((tag, 'skip-hard'))
            return

        if parent_mode == 'skip-soft':
            self._mode_stack.append((tag, 'annotation' if tag == 'annotation' else 'skip-soft'))
            return

        if parent_mode == 'annotation':
            self._mode_stack.append((tag, 'annotation'))
            return

        if tag in self._void_newline_tags:
            # e.g. DOCX's bare `<br>` (no self-closing slash) — html.parser has no notion of
            # HTML5 void elements, so without this it would sit on the stack unmatched.
            self.out.append('\n')
            return

        cls = dict(attrs).get('class') or ''
        if 'katex-html' in cls:
            self._mode_stack.append((tag, 'skip-hard'))
            return
        if 'katex-mathml' in cls:
            self._mode_stack.append((tag, 'skip-soft'))
            return
        if tag == 'annotation':
            self._mode_stack.append((tag, 'annotation'))
            return

        if tag in self._keep_tags and tag != 'br':
            self.out.append(f'<{self._tag_map.get(tag, tag)}>')
        self._mode_stack.append((tag, 'normal'))

    def handle_startendtag(self, tag, attrs):
        if self._parent_mode() in ('skip-hard', 'skip-soft'):
            return
        if tag in self._void_newline_tags:
            self.out.append('\n')
            return
        if tag == 'br' and 'br' in self._keep_tags:
            self.out.append('<br/>')

    def handle_endtag(self, tag):
        # html.parser reports end tags exactly as seen in the source, including ones that
        # overlap or don't match the current stack top (e.g. "<b>x<i>y</b></i>", which
        # browsers tolerate). Find the matching open tag and close everything above it too,
        # so output is always well-nested — ReportLab's Paragraph parser has no tolerance
        # for overlapping tags and a stray/mismatched end tag would otherwise crash it.
        match_index = None
        for i in range(len(self._mode_stack) - 1, -1, -1):
            if self._mode_stack[i][0] == tag:
                match_index = i
                break
        if match_index is None:
            return  # stray end tag with no corresponding open tag — ignore
        while len(self._mode_stack) > match_index:
            popped_tag, mode = self._mode_stack.pop()
            if mode == 'normal' and popped_tag in self._keep_tags and popped_tag != 'br':
                self.out.append(f'</{self._tag_map.get(popped_tag, popped_tag)}>')
            if mode == 'normal' and popped_tag in self._close_newline_tags:
                self.out.append('\n\n')

    def handle_data(self, data):
        if self._parent_mode() in ('skip-hard', 'skip-soft'):
            return
        self.out.append(escape(data) if self._escape else data)


def _run(html_value, keep_tags, tag_map, escape_text, void_newline_tags=frozenset(), close_newline_tags=frozenset()):
    if not html_value:
        return ''
    parser = _MathAwareStripper(keep_tags, tag_map, escape_text, void_newline_tags, close_newline_tags)
    try:
        parser.feed(html_value)
        parser.close()
        # html.parser tolerates missing/mismatched end tags silently (it just leaves them
        # on the mode stack) — ReportLab's Paragraph parser doesn't, so auto-close anything
        # a malformed source left open rather than emitting unbalanced markup.
        for tag, mode in reversed(parser._mode_stack):
            if mode == 'normal' and tag in keep_tags and tag != 'br':
                parser.out.append(f'</{tag_map.get(tag, tag)}>')
        return ''.join(parser.out)
    except Exception:
        # Anything else genuinely unparseable should degrade to plain text, not take down
        # PDF/DOCX generation for the whole paper.
        return strip_tags(html_value)


def sanitize_for_pdf(html_value):
    """question_text -> ReportLab-safe markup (b/i/u/strike/sup/sub/br only, text escaped)."""
    return _run(html_value, _PDF_SAFE_TAGS, _PDF_TAG_MAP, escape_text=True)


def sanitize_for_docx(html_value):
    """question_text -> plain text for DOCX (mirrors the old `_html_to_text` behavior —
    <br>/</p> become line/paragraph breaks — minus the katex-mathml/katex-html/annotation
    duplication)."""
    text = _run(
        html_value, keep_tags=frozenset(), tag_map={}, escape_text=False,
        void_newline_tags=_DOCX_VOID_NEWLINE_TAGS, close_newline_tags=_DOCX_CLOSE_NEWLINE_TAGS,
    )
    return re.sub(r'\n{3,}', '\n\n', text).strip()
