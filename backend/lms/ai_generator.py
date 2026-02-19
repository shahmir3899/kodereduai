"""
AI Lesson Plan Generator using Groq LLM.

Given selected topics from curriculum books, generates structured
lesson plan content (title, objectives, description, teaching methods,
materials). Supports RTL languages — instructs the LLM to generate
content in the book's language when applicable.

Uses the same Groq integration pattern as backend/attendance/llm_reasoner.py.
"""

import json
import logging

from django.conf import settings

from .models import Book

logger = logging.getLogger(__name__)


LESSON_PLAN_PROMPT = """You are an expert school teacher creating a detailed lesson plan.

## Context
School: {school_name}
Class: {class_name}
Subject: {subject_name}
Book: {book_title}
Language: {language}
Date: {lesson_date}
Duration: {duration} minutes

## Topics to Cover
{topics_text}

## Instructions
Generate a detailed lesson plan with the following sections:
1. **Title**: A clear, descriptive title for this lesson
2. **Objectives**: 3-5 specific learning objectives (what students will be able to do)
3. **Description**: A brief overview of the lesson (2-3 sentences)
4. **Teaching Methods**: Step-by-step teaching approach with time allocations
5. **Materials Needed**: Required materials and resources

{language_instruction}

## Output Format (JSON only, no markdown fences)
{{
  "title": "Lesson title",
  "objectives": "Bullet-pointed learning objectives",
  "description": "Brief lesson overview",
  "teaching_methods": "Step-by-step teaching approach with time breakdown",
  "materials_needed": "List of materials and resources"
}}"""


def generate_lesson_plan(
    school, class_obj, subject, book, topics,
    lesson_date, duration_minutes=45,
):
    """
    Generate lesson plan content from selected topics using Groq LLM.

    Args:
        school: School instance
        class_obj: Class instance
        subject: Subject instance
        book: Book instance (or None for free-form)
        topics: QuerySet of Topic instances
        lesson_date: date string (YYYY-MM-DD)
        duration_minutes: int

    Returns:
        dict with 'success' flag and generated content or error
    """
    if not getattr(settings, 'GROQ_API_KEY', None):
        return {
            'success': False,
            'error': 'AI generation is not configured. GROQ_API_KEY is missing.',
        }

    try:
        from groq import Groq

        client = Groq(api_key=settings.GROQ_API_KEY)

        # Format topics
        topics_lines = []
        for t in topics.select_related('chapter'):
            topics_lines.append(
                f"- Ch {t.chapter.chapter_number}: {t.chapter.title} > "
                f"Topic {t.topic_number}: {t.title}"
            )
        topics_text = '\n'.join(topics_lines) or 'No specific topics selected'

        # Language instruction for RTL books
        language_instruction = ''
        if book and book.language in Book.RTL_LANGUAGES:
            lang_name = book.get_language_display()
            language_instruction = (
                f"IMPORTANT: The book is in {lang_name}. Generate the content "
                f"in {lang_name} script. Use proper {lang_name} educational "
                f"terminology. The title, objectives, description, teaching "
                f"methods, and materials should all be written in {lang_name}."
            )

        prompt = LESSON_PLAN_PROMPT.format(
            school_name=school.name,
            class_name=class_obj.name,
            subject_name=subject.name,
            book_title=book.title if book else 'N/A',
            language=book.get_language_display() if book else 'English',
            lesson_date=lesson_date,
            duration=duration_minutes,
            topics_text=topics_text,
            language_instruction=language_instruction,
        )

        model_name = getattr(settings, 'GROQ_MODEL', 'llama-3.3-70b-versatile')

        response = client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=2000,
        )

        result_text = response.choices[0].message.content

        # Parse JSON response (same pattern as llm_reasoner.py)
        if "```json" in result_text:
            result_text = result_text.split("```json")[1].split("```")[0]
        elif "```" in result_text:
            result_text = result_text.split("```")[1].split("```")[0]

        result = json.loads(result_text.strip())

        return {
            'success': True,
            'title': result.get('title', ''),
            'objectives': result.get('objectives', ''),
            'description': result.get('description', ''),
            'teaching_methods': result.get('teaching_methods', ''),
            'materials_needed': result.get('materials_needed', ''),
        }

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse AI response: {e}")
        return {
            'success': False,
            'error': 'Failed to parse AI response. Please try again.',
        }
    except Exception as e:
        logger.error(f"AI lesson plan generation failed: {e}")
        return {'success': False, 'error': str(e)}
