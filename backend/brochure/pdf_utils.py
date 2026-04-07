"""
Utilities for converting stored section data to HTML and PDF.
"""

BROCHURE_CSS = """
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;800&display=swap');

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
    font-family: 'Inter', 'Segoe UI', sans-serif;
    background: #f0f2f5;
    color: #1a1a2e;
    line-height: 1.7;
    font-size: 15px;
}

.brochure-wrapper {
    max-width: 900px;
    margin: 0 auto;
    padding: 48px 32px;
}

/* ── Header ─────────────────────────────────────────────── */

.brochure-header {
    text-align: center;
    padding: 60px 32px 48px;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    color: #fff;
    border-radius: 16px;
    margin-bottom: 32px;
    box-shadow: 0 8px 32px rgba(15, 52, 96, 0.3);
}

.brochure-header .logo-badge {
    display: inline-block;
    background: rgba(255,255,255,0.15);
    border: 2px solid rgba(255,255,255,0.3);
    padding: 8px 20px;
    border-radius: 30px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-bottom: 20px;
    color: #e2b96f;
}

.brochure-header h1 {
    font-size: 42px;
    font-weight: 800;
    letter-spacing: -1px;
    margin-bottom: 12px;
}

.brochure-header h1 span { color: #e2b96f; }

.brochure-header p {
    font-size: 18px;
    opacity: 0.85;
    max-width: 560px;
    margin: 0 auto;
}

/* ── Section Cards ──────────────────────────────────────── */

.section {
    margin-bottom: 24px;
    padding: 36px 40px;
    border-radius: 16px;
    border-left: 5px solid;
    box-shadow: 0 2px 12px rgba(0,0,0,0.06);
    position: relative;
    overflow: hidden;
    background-image:
      radial-gradient(circle at 12% 18%, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0) 42%),
      radial-gradient(circle at 86% 16%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 36%),
      radial-gradient(circle at 82% 82%, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0) 40%),
      linear-gradient(145deg, var(--bg-a) 0%, var(--bg-b) 55%, var(--bg-c) 100%);
    background-size: auto, auto, auto, auto;
}

.section::before {
    content: '';
    position: absolute;
    top: 0; right: 0;
    width: 180px; height: 180px;
    border-radius: 50%;
    opacity: 0.04;
    transform: translate(40%, -40%);
    pointer-events: none;
}

.section::after {
    content: '';
    position: absolute;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140' viewBox='0 0 140 140'%3E%3Cg fill='none' stroke='rgba(255,255,255,0.12)' stroke-width='1'%3E%3Cpath d='M0 20h140M0 70h140M0 120h140'/%3E%3Cpath d='M20 0v140M70 0v140M120 0v140'/%3E%3C/g%3E%3C/svg%3E");
    opacity: 0.25;
    mix-blend-mode: soft-light;
    pointer-events: none;
}

/* ── Per-section color themes ───────────────────────────── */

.section-introduction {
    --bg-a: #dbeafe;
    --bg-b: #eff6ff;
    --bg-c: #f8fbff;
    border-left-color: #3b82f6;
}
.section-introduction::before { background: #3b82f6; }
.section-introduction .section-label { background: #dbeafe; color: #1d4ed8; }

.section-use-cases {
    --bg-a: #dcfce7;
    --bg-b: #f0fdf4;
    --bg-c: #f7fff9;
    border-left-color: #22c55e;
}
.section-use-cases::before { background: #22c55e; }
.section-use-cases .section-label { background: #dcfce7; color: #15803d; }

.section-benefits {
    --bg-a: #ffedd5;
    --bg-b: #fff7ed;
    --bg-c: #fffaf2;
    border-left-color: #f59e0b;
}
.section-benefits::before { background: #f59e0b; }
.section-benefits .section-label { background: #fef3c7; color: #b45309; }

.section-automations {
    --bg-a: #fce7f3;
    --bg-b: #fdf2f8;
    --bg-c: #fff3fa;
    border-left-color: #ec4899;
}
.section-automations::before { background: #ec4899; }
.section-automations .section-label { background: #fce7f3; color: #be185d; }

.section-pricing {
    --bg-a: #ede9fe;
    --bg-b: #f5f3ff;
    --bg-c: #fbf9ff;
    border-left-color: #8b5cf6;
}
.section-pricing::before { background: #8b5cf6; }
.section-pricing .section-label { background: #ede9fe; color: #6d28d9; }

.section-faq {
    --bg-a: #cffafe;
    --bg-b: #ecfeff;
    --bg-c: #f3fcff;
    border-left-color: #06b6d4;
}
.section-faq::before { background: #06b6d4; }
.section-faq .section-label { background: #cffafe; color: #0e7490; }

/* Fallback for any new sections */
.section-default {
    --bg-a: #f3f4f6;
    --bg-b: #f8fafc;
    --bg-c: #ffffff;
    border-left-color: #6b7280;
}
.section-default .section-label { background: #f3f4f6; color: #374151; }

/* ── Section inner elements ─────────────────────────────── */

.section-label {
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    padding: 5px 14px;
    border-radius: 6px;
    margin-bottom: 14px;
}

.section h2 {
    font-size: 28px;
    font-weight: 700;
    color: #1a1a2e;
    margin-bottom: 18px;
    line-height: 1.3;
}

.section p { color: #444; margin-bottom: 14px; }

.section ul, .section ol {
    padding-left: 22px;
    margin-bottom: 14px;
    color: #444;
}

.section li {
    margin-bottom: 8px;
    line-height: 1.6;
}

.section strong { color: #1a1a2e; }

.section h3 {
    font-size: 18px;
    font-weight: 600;
    color: #1a1a2e;
    margin: 28px 0 12px;
    padding-bottom: 6px;
    border-bottom: 2px solid rgba(0,0,0,0.06);
}

.section blockquote {
    border-left: 4px solid #e2b96f;
    padding: 14px 24px;
    background: rgba(255,255,255,0.7);
    border-radius: 0 10px 10px 0;
    font-style: italic;
    color: #555;
    margin: 18px 0;
    box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}

.section table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    margin: 20px 0;
    font-size: 14px;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 1px 6px rgba(0,0,0,0.06);
}

.section table th {
    background: #1a1a2e;
    color: #fff;
    padding: 12px 16px;
    text-align: left;
    font-weight: 600;
}

.section table td {
    padding: 11px 16px;
    border-bottom: 1px solid #e8e8e8;
    color: #444;
    background: #fff;
}

.section table tr:nth-child(even) td { background: #f8f9fa; }
.section table tr:last-child td { border-bottom: none; }

/* ── Footer ─────────────────────────────────────────────── */

.brochure-footer {
    text-align: center;
    padding: 32px;
    background: linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%);
    color: rgba(255,255,255,0.6);
    border-radius: 16px;
    margin-top: 8px;
    font-size: 13px;
    box-shadow: 0 4px 20px rgba(15, 52, 96, 0.2);
}

.brochure-footer strong { color: #e2b96f; }

@media print {
    body { background: #fff; }
    .brochure-header, .section, .brochure-footer {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    .section { page-break-inside: avoid; }
}
"""


def build_preview_html(sections):
    """Build full standalone HTML for preview (embedded in iframe)."""
    sections_html = _render_sections(sections)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>KoderEduAI — Platform Brochure</title>
<style>{BROCHURE_CSS}</style>
</head>
<body>
<div class="brochure-wrapper">
  <div class="brochure-header">
    <div class="logo-badge">KoderEduAI Platform</div>
    <h1>Smart School Management <span>&amp; Automation</span></h1>
    <p>The complete AI-powered ERP for modern educational institutions</p>
  </div>
  {sections_html}
  <div class="brochure-footer">
    <p>© 2025 <strong>KoderEduAI</strong> · All rights reserved · support@kodereduai.com</p>
  </div>
</div>
</body>
</html>"""


def render_brochure_html(sections):
    """Build full HTML suitable for WeasyPrint PDF rendering."""
    return build_preview_html(sections)


def _render_sections(sections):
    parts = []
    for section in sections:
        html = section.content_html or f'<p><em>(No content yet for "{section.title}")</em></p>'
        css_class = f'section-{section.key}' if section.key in (
            'introduction', 'use-cases', 'benefits', 'automations', 'pricing', 'faq'
        ) else 'section-default'
        parts.append(f"""<div class="section {css_class}">
  <div class="section-label">{section.key.replace('-', ' ')}</div>
  <h2>{section.title}</h2>
  {html}
</div>""")
    return '\n'.join(parts)
