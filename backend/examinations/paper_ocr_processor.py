"""
Paper OCR Processor - Question Paper Extraction Pipeline.

Supports two pipelines:
1. Google Vision Pipeline: Image → Google Cloud Vision → Question Structure → LLM Parsing
2. Groq Vision Pipeline: Image → Groq Vision AI → Direct Question Extraction

The Google Vision pipeline is best for handwritten papers - it has specialized
handwriting detection optimized for document OCR.
"""

import logging
import json
from typing import Dict, Any, Optional, List
from dataclasses import dataclass

from django.conf import settings
import requests

logger = logging.getLogger(__name__)

# Vision provider: 'google' (recommended) or 'groq'
VISION_PROVIDER = getattr(settings, 'VISION_PROVIDER', 'google')
GROQ_API_KEY = getattr(settings, 'GROQ_API_KEY', '')
GROQ_MODEL = getattr(settings, 'GROQ_MODEL', 'llama-3.3-70b-versatile')
GROQ_VISION_MODEL = getattr(settings, 'GROQ_VISION_MODEL', 'llama-3.2-11b-vision-preview')
GOOGLE_VISION_API_KEY = getattr(settings, 'GOOGLE_VISION_API_KEY', '')

ALLOWED_QUESTION_TYPES = {'MCQ', 'SHORT', 'LONG', 'ESSAY', 'TRUE_FALSE', 'MATCHING', 'FILL_BLANK'}


@dataclass
class QuestionExtractionResult:
    """Result from question paper OCR extraction."""
    success: bool
    header: Optional[Dict[str, Any]] = None
    sections: List[Dict[str, Any]] = None
    questions: List[Dict[str, Any]] = None
    computed_total_marks: Optional[float] = None
    total_marks: Optional[float] = None
    extraction_confidence: float = 0.0
    notes: str = ""
    error: Optional[str] = None

    def __post_init__(self):
        if self.header is None:
            self.header = _normalize_header({})
        if self.sections is None:
            self.sections = []
        if self.questions is None:
            # Backward-compatible flat list: concatenation of all section questions, in
            # page order (never re-ordered by printed question numbers).
            self.questions = [q for section in self.sections for q in section.get('questions', [])]

    def to_json(self) -> Dict[str, Any]:
        """Convert to JSON format for storage."""
        return {
            'header': self.header,
            'sections': self.sections,
            'computed_total_marks': self.computed_total_marks,
            # Flat top-level array kept for backward compatibility with the existing
            # review UI/confirm flow until they're upgraded to consume sections directly.
            'questions': self.questions,
            'total_marks': self.total_marks,
            'extraction_confidence': self.extraction_confidence,
            'notes': self.notes,
        }


def _clean_optional_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _clean_optional_number(value: Any) -> Optional[float]:
    if value is None or value == '':
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_header(raw_header: Any) -> Dict[str, Any]:
    """Normalizes the header block. class_label/subject_label are kept verbatim —
    callers must never normalize, translate, or map them to system class/subject IDs."""
    raw_header = raw_header if isinstance(raw_header, dict) else {}
    return {
        'school_name': _clean_optional_str(raw_header.get('school_name')),
        'exam_title': _clean_optional_str(raw_header.get('exam_title')),
        'class_label': _clean_optional_str(raw_header.get('class_label')),
        'subject_label': _clean_optional_str(raw_header.get('subject_label')),
        'detected_total_marks': _clean_optional_number(raw_header.get('detected_total_marks')),
        'duration_label': _clean_optional_str(raw_header.get('duration_label')),
    }


def _normalize_question(raw_question: Any) -> Dict[str, Any]:
    raw_question = raw_question if isinstance(raw_question, dict) else {}

    question_type = str(raw_question.get('question_type') or 'SHORT').strip().upper()
    if question_type not in ALLOWED_QUESTION_TYPES:
        question_type = 'SHORT'

    marks = _clean_optional_number(raw_question.get('marks'))
    if marks is None:
        marks = 1.0

    options = raw_question.get('options')
    if isinstance(options, dict):
        cleaned_options = {
            key: str(value) for key, value in options.items()
            if key in ('A', 'B', 'C', 'D') and value is not None
        }
        options = cleaned_options or None
    else:
        options = None

    type_data = raw_question.get('type_data')
    if not isinstance(type_data, dict):
        type_data = None

    return {
        'question_text': str(raw_question.get('question_text') or '').strip(),
        'question_type': question_type,
        'marks': marks,
        'options': options,
        'type_data': type_data,
    }


def _normalize_section(raw_section: Any, index: int) -> Dict[str, Any]:
    raw_section = raw_section if isinstance(raw_section, dict) else {}

    questions = [
        _normalize_question(q) for q in (raw_section.get('questions') or [])
        if isinstance(q, dict)
    ]

    question_type_guess = str(
        raw_section.get('question_type_guess')
        or (questions[0]['question_type'] if questions else 'SHORT')
    ).strip().upper()
    if question_type_guess not in ALLOWED_QUESTION_TYPES:
        question_type_guess = questions[0]['question_type'] if questions else 'SHORT'

    try:
        shown_count = int(raw_section.get('shown_count'))
    except (TypeError, ValueError):
        shown_count = len(questions)

    try:
        counted_count = int(raw_section.get('counted_count'))
    except (TypeError, ValueError):
        counted_count = shown_count

    marks_per_question = _clean_optional_number(raw_section.get('marks_per_question'))
    if marks_per_question is None and questions:
        # Grouped questions (fill-blank list, matching table, ...) carry their total
        # marks on the single question itself.
        marks_per_question = questions[0]['marks']

    instruction = _clean_optional_str(raw_section.get('instruction'))
    title = _clean_optional_str(raw_section.get('title')) or f'Section {index + 1}'

    return {
        'title': title,
        'instruction': instruction,
        'question_type_guess': question_type_guess,
        'marks_per_question': marks_per_question,
        'shown_count': shown_count,
        'counted_count': counted_count,
        'questions': questions,
    }


def _compute_total_marks(sections: List[Dict[str, Any]]) -> float:
    """sum of counted_count * marks_per_question across sections."""
    total = 0.0
    for section in sections:
        marks_per_question = section.get('marks_per_question') or 0
        counted_count = section.get('counted_count') or 0
        total += counted_count * marks_per_question
    return round(total, 2)


def _parse_structured_paper(content: str) -> Dict[str, Any]:
    """Parses and normalizes a raw LLM response into the header/sections schema.

    Raises json.JSONDecodeError or ValueError if the response isn't a usable JSON object.
    """
    content = content.strip()
    if content.startswith('```'):
        content = content.split('```')[1]
        if content.startswith('json'):
            content = content[4:]
        content = content.strip()

    parsed = json.loads(content)
    if not isinstance(parsed, dict):
        raise ValueError('Expected a JSON object with header/sections keys.')

    header = _normalize_header(parsed.get('header'))
    raw_sections = parsed.get('sections')
    if not isinstance(raw_sections, list):
        raw_sections = []
    sections = [_normalize_section(raw_section, idx) for idx, raw_section in enumerate(raw_sections)]

    flat_questions = [question for section in sections for question in section['questions']]

    return {
        'header': header,
        'sections': sections,
        'questions': flat_questions,
        'computed_total_marks': _compute_total_marks(sections),
    }


def _wrap_flat_as_structured(flat_questions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Wraps a flat (fallback-extraction) question list into the header/sections schema."""
    sections = []
    if flat_questions:
        raw_section = {
            'title': 'Extracted Questions',
            'instruction': None,
            'question_type_guess': None,
            'marks_per_question': None,
            'shown_count': len(flat_questions),
            'counted_count': len(flat_questions),
            'questions': flat_questions,
        }
        sections = [_normalize_section(raw_section, 0)]

    flat_questions = [question for section in sections for question in section['questions']]

    return {
        'header': _normalize_header({}),
        'sections': sections,
        'questions': flat_questions,
        'computed_total_marks': _compute_total_marks(sections),
    }


def _build_extraction_prompt(context: Optional[Dict[str, Any]] = None, ocr_text: Optional[str] = None) -> str:
    """Builds the structured-extraction prompt shared by the text-based (Google Vision
    OCR text -> Groq LLM) and image-based (Groq Vision) pipelines."""
    context_hint = ''
    if context:
        class_name = context.get('class_name')
        subject_name = context.get('subject_name')
        if class_name or subject_name:
            context_hint = (
                "\nUploader context (hint only, may be wrong or absent — never let it "
                f"override what is actually printed on the paper): class '{class_name or 'unknown'}', "
                f"subject '{subject_name or 'unknown'}'."
            )

    text_block = f"\n\nRAW OCR TEXT:\n{ocr_text}\n" if ocr_text else ''

    return f"""You are extracting a school exam question paper into a strict JSON schema.
{text_block}{context_hint}

Return ONLY a single valid JSON object (no markdown fences, no extra commentary) with this exact shape:
{{
  "header": {{
    "school_name": string|null,
    "exam_title": string|null,
    "class_label": string|null,
    "subject_label": string|null,
    "detected_total_marks": number|null,
    "duration_label": string|null
  }},
  "sections": [
    {{
      "title": string,
      "instruction": string|null,
      "question_type_guess": "MCQ"|"SHORT"|"LONG"|"ESSAY"|"TRUE_FALSE"|"MATCHING"|"FILL_BLANK",
      "marks_per_question": number|null,
      "shown_count": integer,
      "counted_count": integer,
      "questions": [
        {{
          "question_text": string,
          "question_type": "MCQ"|"SHORT"|"LONG"|"ESSAY"|"TRUE_FALSE"|"MATCHING"|"FILL_BLANK",
          "marks": number,
          "options": {{"A": string, "B": string, "C": string, "D": string}} or null,
          "type_data": object or null
        }}
      ]
    }}
  ]
}}

Rules:
1. "header.class_label" and "header.subject_label" are RAW strings copied verbatim from the
   paper's header (e.g. "FIFTH", "SS") — never normalize, translate, or guess/match them to a
   class or subject ID.
2. "header.detected_total_marks" is set ONLY if a total-marks value is actually printed on the
   paper (e.g. "Total: 100 marks"); otherwise null. Never compute or guess it yourself.
3. Marks are frequently printed as "(5)" at the end of a section or question heading line —
   parse that number as the section's marks_per_question (or the question's marks).
4. If a heading's marks number equals the count of sub-items that follow it, treat the heading
   plus its sub-items as ONE grouped question, not several separate ones:
   - A list of blanks to fill in -> ONE question, question_type "FILL_BLANK",
     type_data: {{"items": [string, ...]}}, one entry per blank, in order.
   - A two-column matching table -> ONE question, question_type "MATCHING",
     type_data: {{"pairs": [{{"left": string, "right": string}}, ...]}}.
   - A fact-sheet / short-answer completion list -> ONE question, question_type "SHORT" or
     "FILL_BLANK", type_data: {{"items": [string, ...]}}.
5. "Attempt any N ..." / "Answer any N of ..." style section instructions mean
   counted_count = N, while shown_count is the number of questions actually printed in that
   section (they can differ). With no such instruction, counted_count == shown_count.
6. NEVER trust printed question numbers (Q1, 2., etc.) for ordering, grouping, or uniqueness —
   real papers reuse and skip numbers. Order sections and questions strictly by physical
   position on the page, top to bottom.
7. Every question needs a question_type and a numeric marks value — if an individual
   question's marks aren't printed, use the section's marks_per_question or your best
   estimate; never leave marks null.

Return ONLY the JSON object described above."""


class PaperOCRProcessor:
    """
    Main orchestrator for question paper OCR processing.
    
    Pipeline Steps:
    1. Image → Vision API (Google or Groq)
    2. Raw OCR → Question Boundary Detection
    3. Question Structure → Type Classification
    4. Output for Human Review
    """
    
    def __init__(self, vision_provider: Optional[str] = None):
        """
        Initialize the processor.
        
        Args:
            vision_provider: 'google' or 'groq' (defaults to settings)
        """
        self.vision_provider = vision_provider or VISION_PROVIDER
        self.groq_api_key = GROQ_API_KEY
        self.google_api_key = GOOGLE_VISION_API_KEY
        
        logger.info(f"PaperOCRProcessor initialized with provider: {self.vision_provider}")
    
    def process_paper_image(self, image_url: str, context: Dict[str, Any] = None) -> QuestionExtractionResult:
        """
        Process a question paper image and extract questions.
        
        Args:
            image_url: URL to the uploaded image
            context: Optional context (class, subject) for better extraction
        
        Returns:
            QuestionExtractionResult with extracted questions
        """
        try:
            logger.info(f"Processing paper image with {self.vision_provider} provider")
            
            if self.vision_provider == 'google':
                return self._process_with_google_vision(image_url, context)
            elif self.vision_provider == 'groq':
                return self._process_with_groq_vision(image_url, context)
            else:
                return QuestionExtractionResult(
                    success=False,
                    error=f"Unsupported vision provider: {self.vision_provider}"
                )
        
        except Exception as e:
            logger.error(f"Error processing paper image: {str(e)}", exc_info=True)
            return QuestionExtractionResult(
                success=False,
                error=f"Processing error: {str(e)}"
            )
    
    def _process_with_google_vision(self, image_url: str, context: Dict[str, Any] = None) -> QuestionExtractionResult:
        """
        Process using Google Cloud Vision API.
        
        Steps:
        1. Call Google Vision for OCR
        2. Parse text blocks to detect question boundaries
        3. Classify question types
        4. Extract MCQ options if present
        """
        try:
            # Step 1: Call Google Vision API
            api_url = f"https://vision.googleapis.com/v1/images:annotate?key={self.google_api_key}"
            
            request_data = {
                "requests": [{
                    "image": {"source": {"imageUri": image_url}},
                    "features": [
                        {"type": "DOCUMENT_TEXT_DETECTION"},
                        {"type": "TEXT_DETECTION"}
                    ]
                }]
            }
            
            response = requests.post(api_url, json=request_data, timeout=30)
            response.raise_for_status()
            
            result = response.json()
            
            if 'responses' not in result or not result['responses']:
                return QuestionExtractionResult(
                    success=False,
                    error="No response from Google Vision API"
                )
            
            vision_response = result['responses'][0]
            
            if 'error' in vision_response:
                return QuestionExtractionResult(
                    success=False,
                    error=f"Google Vision API error: {vision_response['error'].get('message', 'Unknown error')}"
                )
            
            # Extract full text
            full_text = ""
            if 'fullTextAnnotation' in vision_response:
                full_text = vision_response['fullTextAnnotation']['text']
            elif 'textAnnotations' in vision_response and vision_response['textAnnotations']:
                full_text = vision_response['textAnnotations'][0]['description']
            
            if not full_text:
                return QuestionExtractionResult(
                    success=False,
                    error="No text detected in image"
                )
            
            logger.info(f"Google Vision extracted {len(full_text)} characters")

            # Step 2: Use Groq LLM to parse header/sections/questions from text
            parsed = self._parse_paper_with_llm(full_text, context)

            return QuestionExtractionResult(
                success=True,
                header=parsed['header'],
                sections=parsed['sections'],
                questions=parsed['questions'],
                computed_total_marks=parsed['computed_total_marks'],
                total_marks=parsed['computed_total_marks'],
                extraction_confidence=0.85,  # Base confidence for Google Vision
                notes=(
                    f"Extracted {len(parsed['questions'])} questions across "
                    f"{len(parsed['sections'])} section(s) using Google Vision + Groq LLM"
                )
            )
        
        except requests.RequestException as e:
            logger.error(f"Google Vision API request failed: {str(e)}")
            return QuestionExtractionResult(
                success=False,
                error=f"API request failed: {str(e)}"
            )
        except Exception as e:
            logger.error(f"Google Vision processing error: {str(e)}", exc_info=True)
            return QuestionExtractionResult(
                success=False,
                error=f"Processing error: {str(e)}"
            )
    
    def _process_with_groq_vision(self, image_url: str, context: Dict[str, Any] = None) -> QuestionExtractionResult:
        """
        Process using Groq Vision API (direct image understanding).
        
        Groq's vision model can directly understand and extract questions from images.
        """
        try:
            headers = {
                "Authorization": f"Bearer {self.groq_api_key}",
                "Content-Type": "application/json"
            }
            
            prompt = _build_extraction_prompt(context)

            data = {
                "model": GROQ_VISION_MODEL,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": image_url}}
                        ]
                    }
                ],
                "temperature": 0.1,  # Low temperature for consistency
                "max_tokens": 4000
            }

            response = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=headers,
                json=data,
                timeout=60
            )
            response.raise_for_status()

            result = response.json()

            if 'choices' not in result or not result['choices']:
                return QuestionExtractionResult(
                    success=False,
                    error="No response from Groq Vision API"
                )

            content = result['choices'][0]['message']['content'].strip()

            try:
                parsed = _parse_structured_paper(content)
            except (json.JSONDecodeError, ValueError) as e:
                logger.error(f"Failed to parse Groq Vision response as JSON: {content}")
                return QuestionExtractionResult(
                    success=False,
                    error=f"Failed to parse response: {str(e)}",
                    notes=f"Raw response: {content[:500]}"
                )

            return QuestionExtractionResult(
                success=True,
                header=parsed['header'],
                sections=parsed['sections'],
                questions=parsed['questions'],
                computed_total_marks=parsed['computed_total_marks'],
                total_marks=parsed['computed_total_marks'],
                extraction_confidence=0.8,
                notes=(
                    f"Extracted {len(parsed['questions'])} questions across "
                    f"{len(parsed['sections'])} section(s) using Groq Vision"
                )
            )
        
        except requests.RequestException as e:
            logger.error(f"Groq Vision API request failed: {str(e)}")
            return QuestionExtractionResult(
                success=False,
                error=f"API request failed: {str(e)}"
            )
        except Exception as e:
            logger.error(f"Groq Vision processing error: {str(e)}", exc_info=True)
            return QuestionExtractionResult(
                success=False,
                error=f"Processing error: {str(e)}"
            )
    
    def _parse_paper_with_llm(self, text: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Use Groq LLM to parse header/sections/questions from OCR'd text.

        Args:
            text: Raw OCR text from Google Vision
            context: Optional context (class_name, subject_name) for better parsing

        Returns:
            dict with normalized 'header', 'sections', flat 'questions', and
            'computed_total_marks' — see _parse_structured_paper / _build_extraction_prompt.
        """
        try:
            headers = {
                "Authorization": f"Bearer {self.groq_api_key}",
                "Content-Type": "application/json"
            }

            prompt = _build_extraction_prompt(context, ocr_text=text)

            data = {
                "model": GROQ_MODEL,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You are an expert at parsing exam papers from OCR text. Always "
                            "return a single valid JSON object exactly matching the requested schema."
                        )
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                "temperature": 0.1,
                "max_tokens": 4000
            }

            response = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=headers,
                json=data,
                timeout=60
            )
            response.raise_for_status()

            result = response.json()
            content = result['choices'][0]['message']['content'].strip()

            return _parse_structured_paper(content)

        except Exception as e:
            logger.error(f"LLM parsing error: {str(e)}", exc_info=True)
            # Fallback: basic pattern-based question detection, wrapped into the same schema.
            flat_questions = self._fallback_question_extraction(text)
            return _wrap_flat_as_structured(flat_questions)
    
    def _fallback_question_extraction(self, text: str) -> List[Dict[str, Any]]:
        """
        Fallback method for basic question extraction when LLM fails.
        
        Uses simple pattern matching to detect questions.
        """
        questions = []
        lines = text.split('\n')
        
        current_question = None
        question_number = 0
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            # Look for question numbers (Q1, 1., Question 1, etc.)
            if any([
                line.startswith('Q') and line[1:2].isdigit(),
                line[0:2].replace('.', '').isdigit() and line[1:3] in ['. ', '.)'],
                line.lower().startswith('question')
            ]):
                # Save previous question
                if current_question:
                    questions.append(current_question)
                
                # Start new question
                question_number += 1
                current_question = {
                    'number': question_number,
                    'question_text': line,
                    'question_type': 'SHORT',  # Default type
                    'marks': None,
                    'options': {},
                    'confidence': 0.6  # Low confidence for fallback
                }
            elif current_question:
                # Add to current question text
                current_question['question_text'] += ' ' + line
                
                # Check for MCQ options
                if line.startswith(('A)', 'B)', 'C)', 'D)', 'A.', 'B.', 'C.', 'D.')):
                    if not current_question['options']:
                        current_question['question_type'] = 'MCQ'
                    option_letter = line[0]
                    option_text = line[2:].strip()
                    current_question['options'][option_letter] = option_text
        
        # Add last question
        if current_question:
            questions.append(current_question)
        
        logger.info(f"Fallback extraction found {len(questions)} questions")
        return questions


class QuestionReviewAI:
    """AI-powered grammar and spelling review for questions."""
    
    def __init__(self):
        self.groq_api_key = GROQ_API_KEY
        self.groq_model = GROQ_MODEL
    
    def review_questions(self, question_texts: List[str]) -> List[Dict[str, Any]]:
        """
        Review a list of questions for grammar, spelling, and clarity.
        
        Args:
            question_texts: List of question texts to review
        
        Returns:
            List of review results
        """
        results = []
        
        for question_text in question_texts:
            review = self._review_single_question(question_text)
            results.append(review)
        
        return results
    
    def _review_single_question(self, question_text: str) -> Dict[str, Any]:
        """Review a single question."""
        try:
            headers = {
                "Authorization": f"Bearer {self.groq_api_key}",
                "Content-Type": "application/json"
            }
            
            prompt = f"""Review this exam question for grammar, spelling, and clarity:

"{question_text}"

Provide feedback in JSON format:
{{
  "has_errors": true/false,
  "suggestions": ["suggestion 1", "suggestion 2"],
  "corrected_text": "corrected version of the question",
  "clarity_score": 0-10
}}

Return ONLY the JSON object, no extra text."""
            
            data = {
                "model": self.groq_model,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are an expert editor for academic exam questions. Always return valid JSON."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                "temperature": 0.3,
                "max_tokens": 500
            }
            
            response = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=headers,
                json=data,
                timeout=30
            )
            response.raise_for_status()
            
            result = response.json()
            content = result['choices'][0]['message']['content'].strip()
            
            # Remove markdown code blocks if present
            if content.startswith('```'):
                content = content.split('```')[1]
                if content.startswith('json'):
                    content = content[4:]
                content = content.strip()
            
            review_result = json.loads(content)
            review_result['question_text'] = question_text
            
            return review_result
        
        except Exception as e:
            logger.error(f"Question review error: {str(e)}", exc_info=True)
            return {
                'question_text': question_text,
                'has_errors': False,
                'suggestions': [],
                'corrected_text': question_text,
                'clarity_score': 7,
                'error': str(e)
            }
