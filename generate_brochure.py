"""
KoderEduAI — rich marketing brochure generator.
Output: KoderEduAI_Brochure.pdf  (A4, slide-style pages)
Requires: reportlab, Pillow
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm, cm
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer,
    Table, TableStyle, HRFlowable, KeepTogether, PageBreak,
)
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY
from reportlab.platypus.flowables import Flowable
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics.shapes import Drawing, Rect, String, Circle, Line, Polygon
from reportlab.graphics import renderPDF
import os, sys, math

# ─────────────────────────────────────────────
# BRAND PALETTE
# ─────────────────────────────────────────────
BRAND_NAVY    = colors.HexColor("#0B1D3A")   # deep trust
BRAND_BLUE    = colors.HexColor("#1A56DB")   # CTA / active
BRAND_CYAN    = colors.HexColor("#06B6D4")   # accent highlight
BRAND_GOLD    = colors.HexColor("#F59E0B")   # warm attention
BRAND_GREEN   = colors.HexColor("#10B981")   # success / benefit
BRAND_ORANGE  = colors.HexColor("#F97316")   # energy / automation
BRAND_PURPLE  = colors.HexColor("#7C3AED")   # premium / AI
BRAND_LIGHT   = colors.HexColor("#F0F6FF")   # soft background
BRAND_WHITE   = colors.white
BRAND_GRAY    = colors.HexColor("#6B7280")
BRAND_DARK    = colors.HexColor("#111827")
DIVIDER_COLOR = colors.HexColor("#E5E7EB")

W, H = A4   # 595.27 x 841.89 pts

# ─────────────────────────────────────────────
# CUSTOM FLOWABLES
# ─────────────────────────────────────────────

class GradientRect(Flowable):
    """Full-width gradient background rect."""
    def __init__(self, width, height, color1, color2, steps=40):
        Flowable.__init__(self)
        self.width = width
        self.height = height
        self.color1 = color1
        self.color2 = color2
        self.steps = steps

    def draw(self):
        for i in range(self.steps):
            t = i / self.steps
            r = self.color1.red   + t * (self.color2.red   - self.color1.red)
            g = self.color1.green + t * (self.color2.green - self.color1.green)
            b = self.color1.blue  + t * (self.color2.blue  - self.color1.blue)
            self.canv.setFillColorRGB(r, g, b)
            y = self.height * (1 - (i + 1) / self.steps)
            h = self.height / self.steps + 1
            self.canv.rect(0, y, self.width, h, stroke=0, fill=1)


class ColorBand(Flowable):
    """Solid colour band — used as section dividers."""
    def __init__(self, width, height, fill_color, radius=4):
        Flowable.__init__(self)
        self.width = width
        self.height = height
        self.fill_color = fill_color
        self.radius = radius

    def draw(self):
        self.canv.setFillColor(self.fill_color)
        self.canv.roundRect(0, 0, self.width, self.height,
                            self.radius, stroke=0, fill=1)


class IconBullet(Flowable):
    """Coloured circle with a text label to the right."""
    def __init__(self, icon_char, label, icon_color, width=160*mm, font_size=10):
        Flowable.__init__(self)
        self.icon_char = icon_char
        self.label = label
        self.icon_color = icon_color
        self.width = width
        self.font_size = font_size
        self.height = 22

    def draw(self):
        c = self.canv
        r = 9
        c.setFillColor(self.icon_color)
        c.circle(r, self.height / 2, r, stroke=0, fill=1)
        c.setFillColor(BRAND_WHITE)
        c.setFont("Helvetica-Bold", self.font_size - 1)
        c.drawCentredString(r, self.height / 2 - 3, self.icon_char)
        c.setFillColor(BRAND_DARK)
        c.setFont("Helvetica", self.font_size)
        c.drawString(r * 2 + 6, self.height / 2 - 3, self.label)


class DecorativeLine(Flowable):
    def __init__(self, width, color=BRAND_BLUE, thickness=2):
        Flowable.__init__(self)
        self.width = width
        self.height = thickness + 4
        self.line_color = color
        self.thickness = thickness

    def draw(self):
        self.canv.setStrokeColor(self.line_color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, self.thickness / 2, self.width, self.thickness / 2)


class SectionBadge(Flowable):
    """Pill badge used before section headings."""
    def __init__(self, text, bg_color, text_color=BRAND_WHITE, width=None):
        Flowable.__init__(self)
        self.text = text
        self.bg_color = bg_color
        self.text_color = text_color
        self._w = width or (len(text) * 7 + 20)
        self.width = self._w
        self.height = 18

    def draw(self):
        c = self.canv
        c.setFillColor(self.bg_color)
        c.roundRect(0, 0, self._w, self.height, 9, stroke=0, fill=1)
        c.setFillColor(self.text_color)
        c.setFont("Helvetica-Bold", 9)
        c.drawCentredString(self._w / 2, 4, self.text)


class StatCard(Flowable):
    """Single stat card: big number + label."""
    def __init__(self, number, label, accent_color, card_w=120, card_h=70):
        Flowable.__init__(self)
        self.number = number
        self.label = label
        self.accent_color = accent_color
        self.width = card_w
        self.height = card_h

    def draw(self):
        c = self.canv
        c.setFillColor(BRAND_LIGHT)
        c.roundRect(0, 0, self.width, self.height, 8, stroke=0, fill=1)
        c.setStrokeColor(self.accent_color)
        c.setLineWidth(3)
        c.line(8, 0, self.width - 8, 0)
        c.setFillColor(self.accent_color)
        c.setFont("Helvetica-Bold", 20)
        c.drawCentredString(self.width / 2, self.height - 32, self.number)
        c.setFillColor(BRAND_GRAY)
        c.setFont("Helvetica", 8)
        # wrap label
        words = self.label.split()
        line1 = " ".join(words[:3])
        line2 = " ".join(words[3:]) if len(words) > 3 else ""
        c.drawCentredString(self.width / 2, self.height - 46, line1)
        if line2:
            c.drawCentredString(self.width / 2, self.height - 56, line2)


class ModuleCard(Flowable):
    """Coloured card for a module with icon, name, price."""
    def __init__(self, icon, name, price, color, card_w=120, card_h=80):
        Flowable.__init__(self)
        self.icon = icon
        self.name = name
        self.price = price
        self.color = color
        self.width = card_w
        self.height = card_h

    def draw(self):
        c = self.canv
        # card shadow
        c.setFillColor(colors.HexColor("#D1D5DB"))
        c.roundRect(3, -3, self.width, self.height, 10, stroke=0, fill=1)
        # card body
        c.setFillColor(BRAND_WHITE)
        c.roundRect(0, 0, self.width, self.height, 10, stroke=0, fill=1)
        # top color strip
        c.setFillColor(self.color)
        c.roundRect(0, self.height - 28, self.width, 28, 10, stroke=0, fill=1)
        c.rect(0, self.height - 28, self.width, 14, stroke=0, fill=1)
        # icon circle
        c.setFillColor(BRAND_WHITE)
        c.circle(22, self.height - 14, 11, stroke=0, fill=1)
        c.setFillColor(self.color)
        c.setFont("Helvetica-Bold", 13)
        c.drawCentredString(22, self.height - 18, self.icon)
        # module name
        c.setFillColor(BRAND_DARK)
        c.setFont("Helvetica-Bold", 8.5)
        c.drawString(38, self.height - 19, self.name)
        # price
        c.setFillColor(self.color)
        c.setFont("Helvetica-Bold", 14)
        c.drawCentredString(self.width / 2, 18, self.price)
        c.setFillColor(BRAND_GRAY)
        c.setFont("Helvetica", 7.5)
        c.drawCentredString(self.width / 2, 7, "PKR / month")


class UseCase(Flowable):
    """Horizontal use-case card."""
    def __init__(self, number, title, body, color, width, height=90):
        Flowable.__init__(self)
        self.number = number
        self.title = title
        self.body = body
        self.color = color
        self.width = width
        self.height = height

    def draw(self):
        c = self.canv
        # bg
        c.setFillColor(BRAND_LIGHT)
        c.roundRect(0, 0, self.width, self.height, 8, stroke=0, fill=1)
        # left accent
        c.setFillColor(self.color)
        c.roundRect(0, 0, 8, self.height, 4, stroke=0, fill=1)
        c.rect(4, 0, 4, self.height, stroke=0, fill=1)
        # number circle
        c.setFillColor(self.color)
        c.circle(28, self.height - 22, 14, stroke=0, fill=1)
        c.setFillColor(BRAND_WHITE)
        c.setFont("Helvetica-Bold", 14)
        c.drawCentredString(28, self.height - 26, str(self.number))
        # title
        c.setFillColor(BRAND_DARK)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(50, self.height - 22, self.title)
        # body text wrap
        c.setFillColor(BRAND_GRAY)
        c.setFont("Helvetica", 8.5)
        from textwrap import wrap
        lines = wrap(self.body, width=int(self.width * 0.145))
        y = self.height - 38
        for line in lines[:4]:
            if y < 10:
                break
            c.drawString(50, y, line)
            y -= 13


class BenefitRow(Flowable):
    """Two-column benefit row."""
    def __init__(self, role, bullets, accent, width):
        Flowable.__init__(self)
        self.role = role
        self.bullets = bullets
        self.accent = accent
        self.width = width
        self.height = max(55, 20 + len(bullets) * 17)

    def draw(self):
        c = self.canv
        col1 = self.width * 0.28
        col2 = self.width * 0.70
        # role pill
        c.setFillColor(self.accent)
        c.roundRect(0, self.height - 22, col1 - 6, 20, 10, stroke=0, fill=1)
        c.setFillColor(BRAND_WHITE)
        c.setFont("Helvetica-Bold", 9)
        c.drawCentredString((col1 - 6) / 2, self.height - 16, self.role)
        # bullets
        c.setFillColor(BRAND_DARK)
        c.setFont("Helvetica", 9)
        y = self.height - 22
        for b in self.bullets:
            c.setFillColor(self.accent)
            c.circle(col1 + 6, y + 4, 3, stroke=0, fill=1)
            c.setFillColor(BRAND_DARK)
            c.drawString(col1 + 14, y, b)
            y -= 16


class AutomationFlow(Flowable):
    """3-step automation arrow flow: Input → Process → Output."""
    def __init__(self, step1, process, step3, color, width):
        Flowable.__init__(self)
        self.step1 = step1
        self.process = process
        self.step3 = step3
        self.color = color
        self.width = width
        self.height = 62

    def _box(self, c, x, y, w, h, text, bg, text_color, bold=False):
        c.setFillColor(bg)
        c.roundRect(x, y, w, h, 6, stroke=0, fill=1)
        c.setFillColor(text_color)
        font = "Helvetica-Bold" if bold else "Helvetica"
        from textwrap import wrap
        lines = wrap(text, width=int(w / 5.5))
        line_h = 11
        start_y = y + h / 2 + (len(lines) - 1) * line_h / 2 - 4
        for line in lines:
            c.setFont(font, 8)
            c.drawCentredString(x + w / 2, start_y, line)
            start_y -= line_h

    def draw(self):
        c = self.canv
        bw = (self.width - 40) / 3
        bh = 44
        by = (self.height - bh) / 2

        self._box(c, 0, by, bw, bh, self.step1, BRAND_LIGHT, BRAND_DARK)
        # arrow 1
        c.setFillColor(self.color)
        ax = bw + 2
        mid_y = self.height / 2
        p = c.beginPath()
        p.moveTo(ax, mid_y - 4); p.lineTo(ax + 16, mid_y - 4); p.lineTo(ax + 20, mid_y)
        p.lineTo(ax + 16, mid_y + 4); p.lineTo(ax, mid_y + 4); p.close()
        c.drawPath(p, stroke=0, fill=1)

        self._box(c, bw + 22, by, bw, bh, self.process, self.color, BRAND_WHITE, bold=True)
        # arrow 2
        ax2 = bw * 2 + 24
        p2 = c.beginPath()
        p2.moveTo(ax2, mid_y - 4); p2.lineTo(ax2 + 16, mid_y - 4); p2.lineTo(ax2 + 20, mid_y)
        p2.lineTo(ax2 + 16, mid_y + 4); p2.lineTo(ax2, mid_y + 4); p2.close()
        c.drawPath(p2, stroke=0, fill=1)

        self._box(c, bw * 2 + 44, by, bw, bh, self.step3, BRAND_GREEN, BRAND_WHITE)


class PricingTierCard(Flowable):
    """Full-width compact pricing-tier card."""
    def __init__(self, tier, students, price, included, color, width, highlight=False):
        Flowable.__init__(self)
        self.tier = tier
        self.students = students
        self.price = price
        self.included = included
        self.color = color
        self.width = width
        self.highlight = highlight
        self.height = 72

    def draw(self):
        c = self.canv
        if self.highlight:
            c.setFillColor(self.color)
            c.roundRect(0, 0, self.width, self.height, 10, stroke=0, fill=1)
            text_c = BRAND_WHITE
            sub_c = colors.HexColor("#DBEAFE")
        else:
            c.setFillColor(BRAND_LIGHT)
            c.roundRect(0, 0, self.width, self.height, 10, stroke=0, fill=1)
            c.setFillColor(self.color)
            c.roundRect(0, 0, 6, self.height, 3, stroke=0, fill=1)
            c.rect(3, 0, 3, self.height, stroke=0, fill=1)
            text_c = BRAND_DARK
            sub_c = BRAND_GRAY

        col_price = self.width * 0.72
        # tier name
        c.setFillColor(text_c)
        c.setFont("Helvetica-Bold", 14)
        c.drawString(18, self.height - 24, self.tier)
        # students
        c.setFillColor(sub_c)
        c.setFont("Helvetica", 9)
        c.drawString(18, self.height - 38, self.students)
        # included
        c.setFont("Helvetica", 8.5)
        from textwrap import wrap
        lines = wrap(self.included, width=46)
        y = self.height - 52
        for line in lines[:2]:
            c.drawString(18, y, line)
            y -= 12
        # price
        if self.highlight:
            c.setFillColor(BRAND_GOLD)
        else:
            c.setFillColor(self.color)
        c.setFont("Helvetica-Bold", 24)
        c.drawRightString(self.width - 16, self.height - 28, self.price)
        c.setFillColor(sub_c)
        c.setFont("Helvetica", 8)
        c.drawRightString(self.width - 16, self.height - 40, "PKR / month")


# ─────────────────────────────────────────────
# STYLE HELPERS
# ─────────────────────────────────────────────

def style(name, **kw):
    base = {
        "fontName": "Helvetica",
        "fontSize": 10,
        "textColor": BRAND_DARK,
        "leading": 14,
        "spaceAfter": 4,
    }
    base.update(kw)
    return ParagraphStyle(name, **base)


H1 = style("H1", fontName="Helvetica-Bold", fontSize=32, leading=38,
           textColor=BRAND_WHITE, alignment=TA_CENTER, spaceAfter=6)
H2 = style("H2", fontName="Helvetica-Bold", fontSize=22, leading=28,
           textColor=BRAND_NAVY, alignment=TA_LEFT, spaceAfter=8)
H3 = style("H3", fontName="Helvetica-Bold", fontSize=14, leading=18,
           textColor=BRAND_BLUE, alignment=TA_LEFT, spaceAfter=4)
HERO_SUB = style("HERO_SUB", fontName="Helvetica", fontSize=14, leading=20,
                 textColor=colors.HexColor("#BFD7FF"), alignment=TA_CENTER, spaceAfter=6)
BODY = style("BODY", fontName="Helvetica", fontSize=10, leading=15,
             textColor=BRAND_GRAY, alignment=TA_JUSTIFY, spaceAfter=6)
BODY_DARK = style("BODY_DARK", fontName="Helvetica", fontSize=10, leading=15,
                  textColor=BRAND_DARK, alignment=TA_LEFT, spaceAfter=4)
CAPTION = style("CAPTION", fontName="Helvetica", fontSize=8, leading=11,
                textColor=BRAND_GRAY, alignment=TA_CENTER)
WHITE_BODY = style("WHITE_BODY", fontName="Helvetica", fontSize=10, leading=15,
                   textColor=BRAND_WHITE, alignment=TA_CENTER, spaceAfter=4)
TAG = style("TAG", fontName="Helvetica-Bold", fontSize=10, leading=14,
            textColor=BRAND_BLUE, alignment=TA_LEFT)
QUOTE = style("QUOTE", fontName="Helvetica-Oblique", fontSize=11, leading=16,
              textColor=BRAND_NAVY, alignment=TA_CENTER, spaceAfter=6,
              leftIndent=20, rightIndent=20)
FAQ_Q = style("FAQ_Q", fontName="Helvetica-Bold", fontSize=10, leading=14,
              textColor=BRAND_NAVY, spaceAfter=2)
FAQ_A = style("FAQ_A", fontName="Helvetica", fontSize=10, leading=14,
              textColor=BRAND_GRAY, spaceAfter=10, leftIndent=12)


def sp(n=6):
    return Spacer(1, n)


def hr(color=DIVIDER_COLOR, thickness=1):
    return HRFlowable(width="100%", thickness=thickness, color=color, spaceAfter=6, spaceBefore=6)


# ─────────────────────────────────────────────
# PAGE BACKGROUND CANVAS
# ─────────────────────────────────────────────

def draw_page_bg(canvas, doc):
    """Subtle dot-grid background on every page."""
    canvas.saveState()
    canvas.setFillColor(colors.HexColor("#F8FAFF"))
    canvas.rect(0, 0, W, H, stroke=0, fill=1)
    canvas.setFillColor(colors.HexColor("#DDE8F8"))
    for x in range(20, int(W), 20):
        for y in range(20, int(H), 20):
            canvas.circle(x, y, 0.7, stroke=0, fill=1)
    # thin footer bar
    canvas.setFillColor(BRAND_NAVY)
    canvas.rect(0, 0, W, 18, stroke=0, fill=1)
    canvas.setFillColor(BRAND_WHITE)
    canvas.setFont("Helvetica", 7)
    canvas.drawCentredString(W / 2, 5, "KoderEduAI  |  Smart School Management Platform  |  www.kodereduai.pk")
    canvas.restoreState()


def draw_cover_bg(canvas, doc):
    """Hero gradient for the cover page."""
    canvas.saveState()
    steps = 60
    for i in range(steps):
        t = i / steps
        r = BRAND_NAVY.red   + t * (BRAND_BLUE.red   - BRAND_NAVY.red)
        g = BRAND_NAVY.green + t * (BRAND_BLUE.green - BRAND_NAVY.green)
        b = BRAND_NAVY.blue  + t * (BRAND_BLUE.blue  - BRAND_NAVY.blue)
        canvas.setFillColorRGB(r, g, b)
        y = H * (1 - (i + 1) / steps)
        canvas.rect(0, y, W, H / steps + 1, stroke=0, fill=1)
    # decorative circles
    canvas.setFillColor(colors.HexColor("#1E40AF"))
    canvas.circle(W - 60, H - 60, 80, stroke=0, fill=1)
    canvas.setFillColor(colors.HexColor("#1D4ED8"))
    canvas.circle(-20, 80, 100, stroke=0, fill=1)
    canvas.setFillColor(colors.HexColor("#0EA5E9"))
    canvas.circle(W / 2, H * 0.38, 180, stroke=0, fill=1)
    # thin footer bar
    canvas.setFillColor(colors.HexColor("#0000004D"))
    canvas.rect(0, 0, W, 24, stroke=0, fill=1)
    canvas.setFillColor(BRAND_WHITE)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawCentredString(W / 2, 7, "KoderEduAI  |  Transforming Schools with Technology")
    canvas.restoreState()


# ─────────────────────────────────────────────
# CONTENT BUILDERS
# ─────────────────────────────────────────────
INNER_W = W - 48 * mm   # usable content width

def build_cover():
    elems = []
    elems.append(Spacer(1, 60))
    # logo / brand treatment
    logo_d = Drawing(160, 50)
    logo_d.add(Rect(0, 8, 160, 42, rx=8, ry=8,
                    fillColor=colors.HexColor("#FFFFFF22"), strokeColor=None))
    logo_d.add(String(80, 20, "KoderEduAI", textAnchor="middle",
                      fontName="Helvetica-Bold", fontSize=26,
                      fillColor=colors.white))
    # center it
    elems.append(Table([[logo_d]], colWidths=[INNER_W],
                        style=[("ALIGN", (0, 0), (-1, -1), "CENTER"),
                               ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    elems.append(sp(10))
    elems.append(Paragraph("The Smart School Management Platform", H1))
    elems.append(sp(10))
    elems.append(Paragraph(
        "AI-powered operations for modern schools.<br/>"
        "From attendance to finance, all in one place.",
        HERO_SUB))
    elems.append(sp(30))

    # 4 hero stats in a row
    stats = [
        StatCard("18+", "Modules One Platform", BRAND_CYAN, 120, 72),
        StatCard("9", "Role Levels", BRAND_GOLD, 120, 72),
        StatCard("0", "Hardware Required", BRAND_GREEN, 120, 72),
        StatCard("1 Day", "Onboarding Time", BRAND_ORANGE, 120, 72),
    ]
    elems.append(Table([stats],
                        colWidths=[120] * 4,
                        style=[("ALIGN", (0, 0), (-1, -1), "CENTER"),
                               ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                               ("LEFTPADDING", (0, 0), (-1, -1), 6),
                               ("RIGHTPADDING", (0, 0), (-1, -1), 6)]))
    elems.append(sp(30))
    elems.append(Paragraph(
        '"Stop managing your school. Start leading it."',
        QUOTE))
    elems.append(sp(16))

    call_to_action = style("CTA", fontName="Helvetica-Bold", fontSize=12,
                           textColor=BRAND_GOLD, alignment=TA_CENTER)
    elems.append(Paragraph("www.kodereduai.pk  ·  info@kodereduai.pk  ·  +92-300-0000000",
                            call_to_action))
    return elems


def build_introduction():
    elems = []
    elems.append(SectionBadge("INTRODUCTION", BRAND_BLUE))
    elems.append(sp(8))
    elems.append(Paragraph("What is KoderEduAI?", H2))
    elems.append(DecorativeLine(INNER_W, BRAND_CYAN, 3))
    elems.append(sp(8))
    elems.append(Paragraph(
        "KoderEduAI is a modern, AI-powered School Growth Platform designed to help institutions "
        "run smarter, faster, and with measurably higher parent trust. It brings every school "
        "operation — academics, attendance, finance, HR, communication, and institutional "
        "reporting — into one connected system, so leadership teams can drive real results "
        "rather than chase paperwork.",
        BODY))
    elems.append(sp(8))

    # 2-col layout: who it's for / what makes it different
    col_style = style("ColBody", fontName="Helvetica", fontSize=9.5, leading=14,
                      textColor=BRAND_DARK, spaceAfter=4)
    left_h = style("ColH", fontName="Helvetica-Bold", fontSize=11, leading=15,
                   textColor=BRAND_BLUE, spaceAfter=4)

    left_content = [
        Paragraph("Built for Every School Type", left_h),
        Paragraph("★  Single campuses needing structure", col_style),
        Paragraph("★  Growing school groups wanting central control", col_style),
        Paragraph("★  Budget-conscious schools that want results without hardware", col_style),
        Paragraph("★  Digitally ambitious institutions ready for full automation", col_style),
    ]
    right_content = [
        Paragraph("One Platform. Every Function.", left_h),
        Paragraph("★  Replace 10+ disconnected tools", col_style),
        Paragraph("★  AI where it matters most — attendance & reporting", col_style),
        Paragraph("★  Enable only the modules your school needs", col_style),
        Paragraph("★  Expand branch by branch at your own pace", col_style),
    ]

    frame_style = TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("BACKGROUND", (0, 0), (0, 0), BRAND_LIGHT),
        ("BACKGROUND", (1, 0), (1, 0), colors.HexColor("#EFF6FF")),
        ("ROUNDEDCORNERS", [8]),
    ])
    cw = INNER_W / 2 - 4
    elems.append(Table([[left_content, right_content]], colWidths=[cw, cw],
                        style=frame_style))

    elems.append(sp(14))
    # differentiator comparison table
    elems.append(Paragraph("How We Are Different", H3))
    elems.append(sp(4))
    diff_data = [
        [Paragraph("<b>Traditional Systems</b>", style("TH", fontName="Helvetica-Bold",
                                                        fontSize=9, textColor=BRAND_WHITE)),
         Paragraph("<b>KoderEduAI Way</b>", style("TH2", fontName="Helvetica-Bold",
                                                   fontSize=9, textColor=BRAND_WHITE))],
        ["Biometric machines required", "Photograph existing register — AI does the rest"],
        ["Pay for 50 modules, use 5", "Enable only what you need — pay for what you use"],
        ["Separate apps for each function", "One platform across all departments"],
        ["One branch = one separate system", "True multi-branch: switch in one click"],
        ["Manual attendance correction lost", "Self-learning: every correction improves accuracy"],
        ["Parent portal = one-way notification", "Two-way: messaging, leave requests, live status"],
    ]
    diff_ts = TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), colors.HexColor("#EF4444")),
        ("BACKGROUND", (1, 0), (1, 0), BRAND_GREEN),
        ("BACKGROUND", (0, 1), (0, -1), colors.HexColor("#FEF2F2")),
        ("BACKGROUND", (1, 1), (1, -1), colors.HexColor("#F0FDF4")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F9FAFB")]),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 1), (-1, -1), BRAND_DARK),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("GRID", (0, 0), (-1, -1), 0.5, DIVIDER_COLOR),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ])
    cw2 = INNER_W / 2 - 2
    elems.append(Table(diff_data, colWidths=[cw2, cw2], style=diff_ts))
    return elems


def build_use_cases():
    elems = []
    elems.append(SectionBadge("USE CASES", BRAND_ORANGE))
    elems.append(sp(8))
    elems.append(Paragraph("Real Scenarios. Real Impact.", H2))
    elems.append(DecorativeLine(INNER_W, BRAND_ORANGE, 3))
    elems.append(sp(10))
    elems.append(Paragraph(
        "KoderEduAI is designed around how schools actually operate day-to-day. "
        "Here are five scenarios where the platform delivers measurable improvement.",
        BODY))
    elems.append(sp(10))

    cases = [
        ("A", "School Owner Scaling Operations",
         "A growing school group needs consistent operations across campuses. "
         "KoderEduAI delivers centralized visibility with branch-level flexibility, "
         "so management can expand without losing governance or data control.",
         BRAND_BLUE),
        ("B", "Principal Improving Daily Discipline",
         "A principal wants attendance risk, academic flow, and fee status in one place "
         "to act early. The platform provides a unified operational view so interventions "
         "happen faster and performance improves measurably.",
         BRAND_GREEN),
        ("C", "Accounts Office Improving Fee Collection",
         "The accounts team wants cleaner fee operations, fewer manual follow-ups, "
         "and predictable cash flow. KoderEduAI streamlines collection workflows "
         "to reduce leakage and speed up period-end reconciliation.",
         BRAND_GOLD),
        ("D", "Parent Trust and Communication",
         "Parents expect transparent updates and quick responses. "
         "KoderEduAI strengthens the school–parent relationship through structured "
         "two-way communication, live status visibility, and responsive workflows.",
         BRAND_PURPLE),
        ("E", "Admissions and Student Retention",
         "Schools want better inquiry conversion and stronger retention through service quality. "
         "KoderEduAI supports a more consistent student journey from first enquiry "
         "all the way through ongoing engagement and academic progress.",
         BRAND_CYAN),
    ]

    for num, (letter, title, body, color) in enumerate(cases):
        card = UseCase(letter, title, body, color, INNER_W, height=88)
        elems.append(KeepTogether([card, sp(8)]))

    return elems


def build_benefits():
    elems = []
    elems.append(SectionBadge("BENEFITS", BRAND_GREEN))
    elems.append(sp(8))
    elems.append(Paragraph("Everyone Wins. Every Role.", H2))
    elems.append(DecorativeLine(INNER_W, BRAND_GREEN, 3))
    elems.append(sp(10))
    elems.append(Paragraph(
        "KoderEduAI is built with every stakeholder in mind — from the school owner "
        "setting strategic direction to the parent checking on their child's attendance.",
        BODY))
    elems.append(sp(10))

    benefit_data = [
        ("School Owners", ["Lower software sprawl", "Better control across all departments",
                           "Scalable branch management"], BRAND_BLUE),
        ("Principals", ["Faster oversight and intervention", "Better accountability across teams",
                        "Improved school-wide execution"], BRAND_PURPLE),
        ("Admin & Accounts", ["More organized workflows", "Reduced manual effort",
                              "Cleaner records and reporting"], BRAND_GOLD),
        ("Teachers", ["Less repetitive admin work", "Better process support",
                      "More time for teaching quality"], BRAND_GREEN),
        ("Parents", ["Better visibility and communication", "Faster response cycles",
                     "Greater institutional trust"], BRAND_ORANGE),
    ]

    rows = []
    for role, bullets, accent in benefit_data:
        row = BenefitRow(role, bullets, accent, INNER_W)
        rows.append(row)
        rows.append(sp(6))

    elems.extend(rows)

    elems.append(sp(10))
    # key metrics strip
    elems.append(ColorBand(INNER_W, 10, BRAND_LIGHT))
    elems.append(sp(6))
    elems.append(Paragraph("Platform At a Glance", H3))
    elems.append(sp(6))

    metrics = [
        ("18+", "Modules"),
        ("200+", "API Endpoints"),
        ("88+", "App Screens"),
        ("9", "Role Levels"),
        ("5", "Notification\nChannels"),
        ("0", "Hardware\nNeeded"),
    ]
    metric_cells = []
    for num, label in metrics:
        d = Drawing(85, 65)
        d.add(Rect(0, 0, 85, 65, rx=8, ry=8,
                   fillColor=BRAND_LIGHT, strokeColor=None))
        d.add(String(42, 32, num, textAnchor="middle",
                     fontName="Helvetica-Bold", fontSize=20,
                     fillColor=BRAND_BLUE))
        # label lines
        lines = label.split("\n")
        y = 18
        for ln in reversed(lines):
            d.add(String(42, y, ln, textAnchor="middle",
                         fontName="Helvetica", fontSize=8,
                         fillColor=BRAND_GRAY))
            y -= 10
        metric_cells.append(d)

    cw = INNER_W / 6 - 2
    metric_ts = TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ])
    elems.append(Table([metric_cells], colWidths=[cw] * 6, style=metric_ts))
    return elems


def build_automations():
    elems = []
    elems.append(SectionBadge("AUTOMATIONS", BRAND_CYAN))
    elems.append(sp(8))
    elems.append(Paragraph("Automations That Save Hours Every Week", H2))
    elems.append(DecorativeLine(INNER_W, BRAND_CYAN, 3))
    elems.append(sp(10))
    elems.append(Paragraph(
        "KoderEduAI automates the most time-heavy workflows in school operations, "
        "so your team can focus on outcomes — not repetitive manual tasks. "
        "Every automation is designed to run reliably, with human oversight built in where it matters.",
        BODY))
    elems.append(sp(12))

    flows = [
        ("Register Photo Upload",
         "AI reads, structures & matches students",
         "Attendance confirmed in minutes",
         BRAND_BLUE),
        ("Fee structure + enrollments",
         "Monthly generation, ledger rolls, status tracking",
         "Clean dues visibility & collection reports",
         BRAND_GOLD),
        ("Subjects + class setup",
         "Timetable suggestion, conflict detection, workload analysis",
         "Better schedule quality automatically",
         BRAND_GREEN),
        ("Exam setup + marks entry",
         "Auto calculate results, grade scales, AI comments",
         "Report cards & results ready instantly",
         BRAND_PURPLE),
        ("User role + school context",
         "Module gating, data scoping, branch isolation",
         "Secure, clean, multi-branch access control",
         BRAND_ORANGE),
    ]

    labels = [
        "Attendance Automation",
        "Fee Operations Automation",
        "Academic & Timetable Automation",
        "Exam & Report Card Automation",
        "Multi-Branch Governance Automation",
    ]

    for label, (s1, proc, s3, color) in zip(labels, flows):
        elems.append(Paragraph(label, TAG))
        elems.append(sp(3))
        elems.append(AutomationFlow(s1, proc, s3, color, INNER_W))
        elems.append(sp(10))

    return elems


def build_pricing():
    elems = []
    elems.append(SectionBadge("PRICING", BRAND_GOLD))
    elems.append(sp(8))
    elems.append(Paragraph("Simple, Modular Pricing", H2))
    elems.append(DecorativeLine(INNER_W, BRAND_GOLD, 3))
    elems.append(sp(8))
    elems.append(Paragraph(
        "Start small. Pay only for what you need. Expand module by module as your school grows. "
        "No hidden fees. No long-term lock-in. No hardware investment required.",
        BODY))
    elems.append(sp(12))

    # Base platform
    elems.append(Paragraph("A  |  Base Platform (Required)", H3))
    elems.append(sp(4))
    elems.append(Paragraph(
        "Includes school setup, user and role access management, "
        "basic reporting foundation, and platform support.",
        BODY))
    elems.append(sp(6))

    tiers = [
        PricingTierCard("Starter", "Up to 400 students", "5,000",
                        "Core setup · User roles · Basic reports",
                        BRAND_GREEN, INNER_W, highlight=False),
        PricingTierCard("Growth", "401 – 1,000 students", "8,000",
                        "Core setup · User roles · Full reports",
                        BRAND_BLUE, INNER_W, highlight=True),
        PricingTierCard("Scale", "1,001+ students", "12,000",
                        "Core setup · All roles · Priority support",
                        BRAND_PURPLE, INNER_W, highlight=False),
    ]
    for t in tiers:
        elems.append(t)
        elems.append(sp(8))

    elems.append(sp(6))
    elems.append(Paragraph("B  |  Module Add-ons (PKR 3,000 – 5,000 / month each)", H3))
    elems.append(sp(4))
    elems.append(Paragraph(
        "Schools select only the modules they need. Any module can be added or removed at renewal.",
        BODY))
    elems.append(sp(8))

    modules = [
        ("★", "Smart\nAttendance", "5,000", BRAND_BLUE),
        ("◆", "Academics &\nTimetable", "4,000", BRAND_GREEN),
        ("◉", "Exams &\nResults", "4,000", BRAND_PURPLE),
        ("₪", "Finance &\nFee Management", "5,000", BRAND_GOLD),
        ("♦", "HR &\nPayroll", "4,000", BRAND_ORANGE),
        ("☎", "Parent & Student\nPortals", "3,000", BRAND_CYAN),
        ("⊞", "Operations Pack\n(Transport, Library, Hostel, Inventory)", "5,000", colors.HexColor("#0F766E")),
        ("✦", "Admissions\nCRM", "3,000", colors.HexColor("#7C3AED")),
    ]

    cards = [ModuleCard(ic, nm, pr, cl, 118, 88) for ic, nm, pr, cl in modules]
    # 4 across, 2 rows
    row1 = cards[:4]
    row2 = cards[4:]
    module_ts = TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ])
    cw = 118
    elems.append(Table([row1], colWidths=[cw] * 4, style=module_ts))
    elems.append(sp(4))
    elems.append(Table([row2], colWidths=[cw] * 4, style=module_ts))
    elems.append(sp(12))

    # Sample total callout
    elems.append(ColorBand(INNER_W, 52, colors.HexColor("#EFF6FF"), radius=8))
    elems.append(Spacer(1, -52))   # overlap

    callout_style = style("CALLOUT", fontName="Helvetica-Bold", fontSize=10,
                          textColor=BRAND_NAVY, alignment=TA_CENTER, leading=16)
    elems.append(Paragraph(
        "◎  Example: Starter base (5,000) + Smart Attendance + Finance + Exams + Academics  "
        "=  <b>PKR 23,000/month</b>  for a full-featured, growing school.",
        callout_style))

    return elems


def build_faq():
    elems = []
    elems.append(SectionBadge("FAQ", BRAND_PURPLE))
    elems.append(sp(8))
    elems.append(Paragraph("Frequently Asked Questions", H2))
    elems.append(DecorativeLine(INNER_W, BRAND_PURPLE, 3))
    elems.append(sp(12))

    faqs = [
        ("Do schools need attendance hardware?",
         "We support both models. Schools can use AI-powered attendance from a simple register "
         "photograph — no hardware required. Alternatively, schools ready for fully digital "
         "classrooms can use our face recognition attendance mode that runs from an installed camera."),
        ("Can schools subscribe to selected modules only?",
         "Yes. The model is fully modular. Schools start with the base platform and add only "
         "the modules that match their current priorities and budget."),
        ("Can we add more modules later?",
         "Absolutely. Modules can be added at any point without any platform migration or "
         "data migration. Your existing data is always safe and accessible."),
        ("Is this suitable for school chains or groups?",
         "Yes. KoderEduAI is purpose-built for multi-branch school groups. It supports "
         "centralized oversight with branch-level control, and each branch can have its own "
         "independent module configuration."),
        ("How long does onboarding take?",
         "Most schools are operational within one day. There is no hardware installation, "
         "no complex infrastructure, and no need to change existing school workflows on day one."),
        ("Is there a long-term contract?",
         "No. Subscriptions are monthly with no minimum lock-in period. Schools can scale "
         "up, scale down, or pause modules as their situation changes."),
    ]

    for q, a in faqs:
        d = Drawing(30, 30)
        d.add(Circle(15, 15, 13, fillColor=BRAND_PURPLE, strokeColor=None))
        d.add(String(15, 9, "?", textAnchor="middle",
                     fontName="Helvetica-Bold", fontSize=16, fillColor=colors.white))
        q_table = Table([[d, Paragraph(q, FAQ_Q)]], colWidths=[32, INNER_W - 36],
                        style=[("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                               ("LEFTPADDING", (0, 0), (-1, -1), 0),
                               ("RIGHTPADDING", (0, 0), (-1, -1), 0)])
        elems.append(q_table)
        elems.append(Paragraph(a, FAQ_A))
        elems.append(hr(DIVIDER_COLOR, 0.5))

    return elems


def build_closing():
    elems = []
    elems.append(sp(24))
    elems.append(ColorBand(INNER_W, 140, BRAND_NAVY, radius=12))
    elems.append(Spacer(1, -140))

    elems.append(sp(22))
    closing_h = style("CLOSING_H", fontName="Helvetica-Bold", fontSize=20, leading=26,
                      textColor=BRAND_WHITE, alignment=TA_CENTER)
    closing_sub = style("CLOSING_SUB", fontName="Helvetica", fontSize=11, leading=16,
                        textColor=colors.HexColor("#93C5FD"), alignment=TA_CENTER)
    closing_cta = style("CLOSING_CTA", fontName="Helvetica-Bold", fontSize=12,
                        textColor=BRAND_GOLD, alignment=TA_CENTER, spaceAfter=0)

    elems.append(Paragraph("Ready to Transform Your School?", closing_h))
    elems.append(sp(8))
    elems.append(Paragraph(
        "Join schools already running smarter with KoderEduAI.", closing_sub))
    elems.append(sp(14))
    elems.append(Paragraph(
        "www.kodereduai.pk  ·  info@kodereduai.pk  ·  +92-300-0000000",
        closing_cta))
    elems.append(sp(16))
    return elems


# ─────────────────────────────────────────────
# DOCUMENT ASSEMBLY
# ─────────────────────────────────────────────

def build_document():
    out_path = os.path.join(os.path.dirname(__file__), "KoderEduAI_Brochure.pdf")

    PAGE_MARGIN = 24 * mm

    cover_frame = Frame(PAGE_MARGIN, PAGE_MARGIN,
                        W - 2 * PAGE_MARGIN, H - 2 * PAGE_MARGIN,
                        id="cover")
    content_frame = Frame(PAGE_MARGIN, 28, W - 2 * PAGE_MARGIN,
                          H - PAGE_MARGIN - 28,
                          id="content")

    cover_tmpl = PageTemplate("cover", frames=[cover_frame], onPage=draw_cover_bg)
    content_tmpl = PageTemplate("content", frames=[content_frame], onPage=draw_page_bg)

    doc = BaseDocTemplate(
        out_path,
        pagesize=A4,
        pageTemplates=[cover_tmpl, content_tmpl],
        title="KoderEduAI — Smart School Management Platform",
        author="KoderEduAI",
        subject="Product Brochure 2026",
        leftMargin=PAGE_MARGIN, rightMargin=PAGE_MARGIN,
        topMargin=PAGE_MARGIN, bottomMargin=28,
    )

    story = []

    # ── PAGE 1: Cover ────────────────────────
    story += build_cover()
    story.append(PageBreak())

    # ── PAGE 2: Introduction ─────────────────
    story += build_introduction()
    story.append(PageBreak())

    # ── PAGE 3: Use Cases ────────────────────
    story += build_use_cases()
    story.append(PageBreak())

    # ── PAGE 4: Benefits ─────────────────────
    story += build_benefits()
    story.append(PageBreak())

    # ── PAGE 5: Automations ──────────────────
    story += build_automations()
    story.append(PageBreak())

    # ── PAGE 6–7: Pricing ────────────────────
    story += build_pricing()
    story.append(PageBreak())

    # ── PAGE 8: FAQ + Closing ────────────────
    story += build_faq()
    story += build_closing()

    doc.build(story)
    return out_path


if __name__ == "__main__":
    path = build_document()
    print(f"PDF generated: {path}")
