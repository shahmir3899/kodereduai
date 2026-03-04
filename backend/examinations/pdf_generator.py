"""
PDF Generator for Exam Papers.
Generates formatted question papers with school branding.
"""

import io
import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)


class ExamPaperPDFGenerator:
    """
    Generate formatted PDF exam papers with school branding.
    """
    
    def __init__(self, exam_paper):
        """
        Initialize generator with an ExamPaper instance.
        
        Args:
            exam_paper: ExamPaper model instance
        """
        self.exam_paper = exam_paper
        self.school = exam_paper.school
    
    def generate(self) -> bytes:
        """
        Generate the PDF file and return bytes.
        
        Returns:
            bytes: PDF file content
        """
        try:
            from reportlab.lib.pagesizes import A4, letter
            from reportlab.lib import colors
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib.units import inch
            from reportlab.platypus import (
                SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                PageBreak, Image, KeepTogether
            )
            from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
            
            buffer = io.BytesIO()
            doc = SimpleDocTemplate(
                buffer,
                pagesize=A4,
                topMargin=0.75*inch,
                bottomMargin=0.75*inch,
                leftMargin=1*inch,
                rightMargin=1*inch
            )
            
            elements = []
            styles = getSampleStyleSheet()
            
            # Custom styles
            title_style = ParagraphStyle(
                'ExamTitle',
                parent=styles['Heading1'],
                fontSize=18,
                alignment=TA_CENTER,
                spaceAfter=6,
                textColor=colors.HexColor('#1F2937'),
                fontName='Helvetica-Bold'
            )
            
            subtitle_style = ParagraphStyle(
                'ExamSubtitle',
                parent=styles['Normal'],
                fontSize=12,
                alignment=TA_CENTER,
                spaceAfter=20,
                textColor=colors.HexColor('#4B5563')
            )
            
            instruction_style = ParagraphStyle(
                'Instructions',
                parent=styles['Normal'],
                fontSize=10,
                spaceAfter=12,
                textColor=colors.HexColor('#374151'),
                leftIndent=20,
                rightIndent=20
            )
            
            question_style = ParagraphStyle(
                'Question',
                parent=styles['Normal'],
                fontSize=11,
                spaceAfter=10,
                textColor=colors.HexColor('#111827'),
                leading=14
            )
            
            option_style = ParagraphStyle(
                'Option',
                parent=styles['Normal'],
                fontSize=10,
                spaceAfter=4,
                leftIndent=30,
                textColor=colors.HexColor('#374151')
            )
            
            # Header with school logo (if available)
            if self.school.logo_url:
                try:
                    logo = Image(self.school.logo_url, width=1*inch, height=1*inch)
                    logo.hAlign = 'CENTER'
                    elements.append(logo)
                    elements.append(Spacer(1, 8))
                except Exception as e:
                    logger.warning(f"Could not load school logo: {str(e)}")
            
            # School name
            school_name_style = ParagraphStyle(
                'SchoolName',
                parent=styles['Heading1'],
                fontSize=16,
                alignment=TA_CENTER,
                spaceAfter=4,
                textColor=colors.HexColor('#1F2937'),
                fontName='Helvetica-Bold'
            )
            elements.append(Paragraph(self.school.name, school_name_style))
            
            # School address (if available)
            if hasattr(self.school, 'address') and self.school.address:
                address_style = ParagraphStyle(
                    'Address',
                    parent=styles['Normal'],
                    fontSize=9,
                    alignment=TA_CENTER,
                    spaceAfter=12,
                    textColor=colors.HexColor('#6B7280')
                )
                elements.append(Paragraph(self.school.address, address_style))
            
            elements.append(Spacer(1, 16))
            
            # Horizontal line
            line_table = Table([['']], colWidths=[6.5*inch])
            line_table.setStyle(TableStyle([
                ('LINEABOVE', (0, 0), (-1, 0), 2, colors.HexColor('#2563EB')),
            ]))
            elements.append(line_table)
            elements.append(Spacer(1, 16))
            
            # Paper title
            elements.append(Paragraph(self.exam_paper.paper_title, title_style))
            
            # Metadata table (Class, Subject, Time, Marks)
            metadata = [
                ['Class:', self.exam_paper.class_obj.name, 'Total Marks:', str(self.exam_paper.total_marks)],
                ['Subject:', self.exam_paper.subject.name, 'Duration:', f"{self.exam_paper.duration_minutes} minutes"],
            ]
            
            if self.exam_paper.exam:
                metadata.append(['Exam:', self.exam_paper.exam.name, '', ''])
            
            metadata_table = Table(metadata, colWidths=[1.5*inch, 2*inch, 1.5*inch, 1.5*inch])
            metadata_table.setStyle(TableStyle([
                ('FONTSIZE', (0, 0), (-1, -1), 10),
                ('ALIGN', (0, 0), (0, -1), 'RIGHT'),
                ('ALIGN', (2, 0), (2, -1), 'RIGHT'),
                ('TEXTCOLOR', (0, 0), (0, -1), colors.HexColor('#6B7280')),
                ('TEXTCOLOR', (2, 0), (2, -1), colors.HexColor('#6B7280')),
                ('FONTNAME', (1, 0), (1, -1), 'Helvetica-Bold'),
                ('FONTNAME', (3, 0), (3, -1), 'Helvetica-Bold'),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ]))
            elements.append(metadata_table)
            elements.append(Spacer(1, 16))
            
            # Instructions
            if self.exam_paper.instructions:
                instructions_title = Paragraph('<b>Instructions:</b>', instruction_style)
                elements.append(instructions_title)
                
                # Split instructions into bullet points if they contain multiple lines
                instruction_lines = self.exam_paper.instructions.split('\n')
                for line in instruction_lines:
                    if line.strip():
                        elements.append(Paragraph(f"• {line.strip()}", instruction_style))
                
                elements.append(Spacer(1, 20))
            
            # Divider
            divider_table = Table([['']], colWidths=[6.5*inch])
            divider_table.setStyle(TableStyle([
                ('LINEABOVE', (0, 0), (-1, 0), 1, colors.HexColor('#D1D5DB')),
            ]))
            elements.append(divider_table)
            elements.append(Spacer(1, 20))
            
            # Questions
            paper_questions = self.exam_paper.paper_questions.select_related('question').order_by('question_order')
            
            for pq in paper_questions:
                question = pq.question
                marks = pq.get_marks()
                
                # Question number and marks
                q_header = f"<b>Q{pq.question_order}.</b> [{marks} mark{'s' if marks != 1 else ''}]"
                elements.append(Paragraph(q_header, question_style))
                
                # Question text (handle HTML from rich editor)
                question_text = question.question_text
                elements.append(Paragraph(question_text, question_style))
                
                # Question image (if any)
                if question.question_image_url:
                    try:
                        q_image = Image(question.question_image_url, width=4*inch, height=3*inch)
                        q_image.hAlign = 'LEFT'
                        elements.append(Spacer(1, 6))
                        elements.append(q_image)
                        elements.append(Spacer(1, 6))
                    except Exception as e:
                        logger.warning(f"Could not load question image: {str(e)}")
                
                # MCQ options
                if question.question_type == 'MCQ':
                    if question.option_a:
                        elements.append(Paragraph(f"<b>A.</b> {question.option_a}", option_style))
                    if question.option_b:
                        elements.append(Paragraph(f"<b>B.</b> {question.option_b}", option_style))
                    if question.option_c:
                        elements.append(Paragraph(f"<b>C.</b> {question.option_c}", option_style))
                    if question.option_d:
                        elements.append(Paragraph(f"<b>D.</b> {question.option_d}", option_style))
                    elements.append(Spacer(1, 10))
                else:
                    # Add answer space for non-MCQ questions
                    if question.question_type == 'ESSAY':
                        elements.append(Spacer(1, 1.5*inch))
                    else:
                        elements.append(Spacer(1, 0.75*inch))
                
                # Add extra spacing between questions
                elements.append(Spacer(1, 16))
            
            # Footer
            footer_line_table = Table([['']], colWidths=[6.5*inch])
            footer_line_table.setStyle(TableStyle([
                ('LINEABOVE', (0, 0), (-1, 0), 1, colors.HexColor('#D1D5DB')),
            ]))
            elements.append(footer_line_table)
            elements.append(Spacer(1, 8))
            
            footer_style = ParagraphStyle(
                'Footer',
                parent=styles['Normal'],
                fontSize=8,
                alignment=TA_CENTER,
                textColor=colors.HexColor('#9CA3AF')
            )
            
            footer_text = f"Generated on {datetime.now().strftime('%d %B %Y')} | {self.school.name}"
            if self.exam_paper.generated_by:
                footer_text += f" | Prepared by: {self.exam_paper.generated_by.get_full_name() or self.exam_paper.generated_by.username}"
            
            elements.append(Paragraph(footer_text, footer_style))
            
            # Build PDF
            doc.build(elements)
            
            logger.info(f"Generated PDF for ExamPaper {self.exam_paper.id}")
            return buffer.getvalue()
        
        except ImportError:
            logger.error("reportlab not installed, cannot generate PDF")
            raise ImportError("reportlab is required for PDF generation")
        
        except Exception as e:
            logger.error(f"Error generating PDF: {str(e)}", exc_info=True)
            raise
    
    def generate_answer_key(self) -> bytes:
        """
        Generate a separate answer key PDF (for teachers).
        
        Returns:
            bytes: PDF file content with answers
        """
        # Similar to generate() but includes correct_answer fields
        # Implementation can be added later if needed
        raise NotImplementedError("Answer key generation not yet implemented")
