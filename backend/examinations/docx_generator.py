"""
DOCX generator for exam papers.
Generates formatted question papers with school metadata and snapshot-backed questions.
"""

import io
import logging
import re
from datetime import datetime
from urllib.parse import urlparse

from django.utils.html import strip_tags
import requests

logger = logging.getLogger(__name__)


def _html_to_text(value):
    if not value:
        return ''
    text = re.sub(r'<br\s*/?>', '\n', str(value), flags=re.IGNORECASE)
    text = re.sub(r'</p\s*>', '\n\n', text, flags=re.IGNORECASE)
    text = strip_tags(text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


class ExamPaperDOCXGenerator:
    """Generate .docx exam papers with snapshot-first question rendering."""

    def __init__(self, exam_paper):
        self.exam_paper = exam_paper
        self.school = exam_paper.school

    def _exam_name(self):
        if self.exam_paper.exam:
            return self.exam_paper.exam.name
        if self.exam_paper.exam_subject and self.exam_paper.exam_subject.exam:
            return self.exam_paper.exam_subject.exam.name
        return None

    def _append_school_logo(self, document, width_inches):
        logo_url = getattr(self.school, 'logo_url', None)
        if not logo_url:
            return

        parsed = urlparse(str(logo_url))
        if not parsed.scheme or not parsed.netloc:
            return

        try:
            response = requests.get(logo_url, timeout=8)
            response.raise_for_status()
            logo_stream = io.BytesIO(response.content)

            from docx.enum.text import WD_ALIGN_PARAGRAPH
            logo_paragraph = document.add_paragraph()
            logo_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            logo_run = logo_paragraph.add_run()
            logo_run.add_picture(logo_stream, width=width_inches)
        except Exception as exc:
            logger.warning('Could not attach school logo to DOCX for paper %s: %s', self.exam_paper.id, exc)

    def generate(self):
        try:
            from docx import Document
            from docx.enum.text import WD_ALIGN_PARAGRAPH
            from docx.shared import Inches
        except ImportError:
            logger.error('python-docx not installed, cannot generate DOCX')
            raise ImportError('python-docx is required for DOCX generation')

        document = Document()

        self._append_school_logo(document, Inches(1.15))

        school_heading = document.add_heading(self.school.name, level=1)
        school_heading.alignment = WD_ALIGN_PARAGRAPH.CENTER

        exam_name = self._exam_name()
        if exam_name:
            exam_heading = document.add_heading(f'Exam: {exam_name}', level=3)
            exam_heading.alignment = WD_ALIGN_PARAGRAPH.CENTER

        paper_heading = document.add_heading(self.exam_paper.paper_title, level=2)
        paper_heading.alignment = WD_ALIGN_PARAGRAPH.CENTER

        meta_lines = [
            f"Class: {self.exam_paper.class_obj.name}",
            f"Subject: {self.exam_paper.subject.name}",
            f"Total Marks: {self.exam_paper.total_marks}",
            f"Duration: {self.exam_paper.duration_minutes} minutes",
        ]
        if exam_name:
            meta_lines.append(f"Exam: {exam_name}")
        document.add_paragraph(' | '.join(meta_lines))

        if self.exam_paper.instructions:
            document.add_paragraph('Instructions:')
            instructions = _html_to_text(self.exam_paper.instructions)
            for line in [entry.strip() for entry in instructions.splitlines() if entry.strip()]:
                document.add_paragraph(line, style='List Bullet')

        paper_questions = self.exam_paper.paper_questions.select_related('question').order_by('question_order')
        for paper_question in paper_questions:
            question = paper_question.get_question_data()
            marks = paper_question.get_marks()

            heading_text = f"Q{paper_question.question_order}. ({marks} marks)"
            document.add_paragraph(heading_text)

            question_text = _html_to_text(question.get('question_text'))
            document.add_paragraph(question_text or '-')

            if question.get('question_type') == 'MCQ':
                for option_key in ('A', 'B', 'C', 'D'):
                    option_value = question.get(f'option_{option_key.lower()}')
                    if option_value:
                        document.add_paragraph(f"{option_key}. {_html_to_text(option_value)}")
            else:
                document.add_paragraph('')

        footer = document.add_paragraph(
            f"Generated on {datetime.now().strftime('%d %B %Y')} | {self.school.name}"
        )
        footer.alignment = WD_ALIGN_PARAGRAPH.CENTER

        output = io.BytesIO()
        document.save(output)
        logger.info('Generated DOCX for ExamPaper %s', self.exam_paper.id)
        return output.getvalue()
