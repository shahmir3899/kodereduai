"""
Question/instruction text is authored in the frontend as TipTap HTML (RichTextEditor.jsx)
and can now include inline LaTeX equations rendered by the KaTeX-based math extension, plus
an RTL language wrapper (`<div dir=".." lang="..">`). Feeding that raw into either exporter
breaks things. (History: the two exporters below were the old ReportLab PDF and python-docx
Word generators, removed in Paper Builder v2 Phase 7; the block renderers use
sanitize_for_html and sanitize_for_docx now.)

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

    def __init__(self, keep_tags, tag_map, escape_text, void_newline_tags=frozenset(), close_newline_tags=frozenset(),
                 math_wrapper=None, keep_dir_tags=frozenset()):
        super().__init__(convert_charrefs=True)
        # (open, close) put around each equation's LaTeX, e.g. a span the page's KaTeX script draws.
        self._math_wrapper = math_wrapper
        self._keep_dir_tags = keep_dir_tags
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
            if tag == 'annotation':
                self._open_math()
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
        if tag == 'br' and 'br' in self._keep_tags:
            # The editor writes a line break as a bare `<br>`; it used to be dropped here (only `<br/>`
            # survived), so a poem or a list typed with Shift+Enter printed as one run-on line.
            self.out.append('<br/>')
            return

        attributes = dict(attrs)
        if attributes.get('data-type') == 'inlineMath':
            # The rich editor's own equation node (@aarkue/tiptap-math-extension). It saves the LaTeX in
            # data-latex and "$...$" as the text, so without this an equation printed as "$x^2$".
            self._equation(attributes.get('data-latex') or '')
            self._mode_stack.append((tag, 'skip-hard'))
            return

        cls = attributes.get('class') or ''
        if 'katex-html' in cls or tag in ('script', 'style'):
            self._mode_stack.append((tag, 'skip-hard'))
            return
        if 'katex-mathml' in cls:
            self._mode_stack.append((tag, 'skip-soft'))
            return
        if tag == 'annotation':
            self._open_math()
            self._mode_stack.append((tag, 'annotation'))
            return

        if tag in self._keep_tags and tag != 'br':
            direction = dict(attrs).get('dir') if tag in self._keep_dir_tags else None
            dir_attr = f' dir="{direction}"' if direction in ('rtl', 'ltr') else ''
            self.out.append(f'<{self._tag_map.get(tag, tag)}{dir_attr}>')
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
            if mode == 'annotation' and self._parent_mode() != 'annotation':
                self._close_math()
            if mode == 'normal' and popped_tag in self._keep_tags and popped_tag != 'br':
                self.out.append(f'</{self._tag_map.get(popped_tag, popped_tag)}>')
            if mode == 'normal' and popped_tag in self._close_newline_tags:
                self.out.append('\n\n')

    def _equation(self, latex):
        latex = latex.strip()
        if not latex:
            return
        self._open_math()
        self.out.append(escape(latex) if self._escape else latex)
        self._close_math()

    def _open_math(self):
        if self._math_wrapper:
            self.out.append(self._math_wrapper[0])

    def _close_math(self):
        if self._math_wrapper:
            self.out.append(self._math_wrapper[1])

    def handle_data(self, data):
        if self._parent_mode() in ('skip-hard', 'skip-soft'):
            return
        self.out.append(escape(data) if self._escape else data)


def _run(html_value, keep_tags, tag_map, escape_text, void_newline_tags=frozenset(), close_newline_tags=frozenset(),
         math_wrapper=None, keep_dir_tags=frozenset()):
    if not html_value:
        return ''
    parser = _MathAwareStripper(keep_tags, tag_map, escape_text, void_newline_tags, close_newline_tags,
                                math_wrapper, keep_dir_tags)
    try:
        parser.feed(html_value)
        parser.close()
        # html.parser tolerates missing/mismatched end tags silently (it just leaves them
        # on the mode stack) — ReportLab's Paragraph parser doesn't, so auto-close anything
        # a malformed source left open rather than emitting unbalanced markup.
        for tag, mode in reversed(parser._mode_stack):
            if mode == 'annotation' and math_wrapper:
                parser.out.append(math_wrapper[1])
                break
        for tag, mode in reversed(parser._mode_stack):
            if mode == 'normal' and tag in keep_tags and tag != 'br':
                parser.out.append(f'</{tag_map.get(tag, tag)}>')
        return ''.join(parser.out)
    except Exception:
        # Anything else genuinely unparseable should degrade to plain text, not take down
        # PDF/DOCX generation for the whole paper.
        return strip_tags(html_value)


def sanitize_for_docx(html_value):
    """question_text -> plain text for DOCX (mirrors the old `_html_to_text` behavior —
    <br>/</p> become line/paragraph breaks — minus the katex-mathml/katex-html/annotation
    duplication)."""
    text = _run(
        html_value, keep_tags=frozenset(), tag_map={}, escape_text=False,
        void_newline_tags=_DOCX_VOID_NEWLINE_TAGS, close_newline_tags=_DOCX_CLOSE_NEWLINE_TAGS,
    )
    return re.sub(r'\n{3,}', '\n\n', text).strip()


# The block-based Paper Builder prints question text as an HTML page, so it can keep real structure:
# paragraphs, lists, tables and right-to-left paragraphs. Still an allowlist with no attributes (bar a
# checked dir), so teacher text can never carry a script, a style or a link into the printed page.
_HTML_SAFE_TAGS = frozenset({
    'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sup', 'sub', 'br', 'p', 'div', 'span',
    'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
})
MATH_OPEN = '<span class="math">'
MATH_CLOSE = '</span>'


def sanitize_for_html(html_value):
    """question_text -> safe HTML for the printed page. Each equation becomes its LaTeX inside
    ``<span class="math">``, which the page's KaTeX script draws."""
    return _run(html_value, _HTML_SAFE_TAGS, {}, escape_text=True,
                math_wrapper=(MATH_OPEN, MATH_CLOSE), keep_dir_tags=frozenset({'p', 'div'}))
