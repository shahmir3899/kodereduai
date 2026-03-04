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


@dataclass
class QuestionExtractionResult:
    """Result from question paper OCR extraction."""
    success: bool
    questions: List[Dict[str, Any]] = None
    total_marks: Optional[float] = None
    extraction_confidence: float = 0.0
    notes: str = ""
    error: Optional[str] = None
    
    def __post_init__(self):
        if self.questions is None:
            self.questions = []
    
    def to_json(self) -> Dict[str, Any]:
        """Convert to JSON format for storage."""
        return {
            'questions': self.questions,
            'total_marks': self.total_marks,
            'extraction_confidence': self.extraction_confidence,
            'notes': self.notes,
        }


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
            
            # Step 2: Use Groq LLM to parse questions from text
            questions = self._parse_questions_with_llm(full_text, context)
            
            return QuestionExtractionResult(
                success=True,
                questions=questions,
                extraction_confidence=0.85,  # Base confidence for Google Vision
                notes=f"Extracted {len(questions)} questions using Google Vision + Groq LLM"
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
            
            context_hint = ""
            if context:
                context_hint = f"\nContext: Class {context.get('class_name', '')}, Subject {context.get('subject_name', '')}"
            
            prompt = f"""Analyze this exam question paper image and extract all questions.

For each question, provide:
1. Question number
2. Full question text
3. Question type (MCQ, SHORT, ESSAY, TRUE_FALSE, FILL_BLANK)
4. If MCQ: all options (A, B, C, D)
5. Marks (if visible)

{context_hint}

Return ONLY a valid JSON array with this structure:
[
  {{
    "number": 1,
    "question_text": "What is photosynthesis?",
    "question_type": "SHORT",
    "marks": 5,
    "options": {{}},
    "confidence": 0.9
  }},
  {{
    "number": 2,
    "question_text": "Which of the following is a renewable energy source?",
    "question_type": "MCQ",
    "marks": 2,
    "options": {{"A": "Coal", "B": "Solar", "C": "Oil", "D": "Natural Gas"}},
    "confidence": 0.95
  }}
]

Important: Return ONLY the JSON array, no extra text."""
            
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
            
            # Try to parse JSON from response
            try:
                # Remove markdown code blocks if present
                if content.startswith('```'):
                    content = content.split('```')[1]
                    if content.startswith('json'):
                        content = content[4:]
                    content = content.strip()
                
                questions = json.loads(content)
                
                if not isinstance(questions, list):
                    questions = [questions]
                
                # Calculate average confidence
                confidences = [q.get('confidence', 0.8) for q in questions]
                avg_confidence = sum(confidences) / len(confidences) if confidences else 0.8
                
                return QuestionExtractionResult(
                    success=True,
                    questions=questions,
                    extraction_confidence=avg_confidence,
                    notes=f"Extracted {len(questions)} questions using Groq Vision"
                )
            
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse Groq Vision response as JSON: {content}")
                return QuestionExtractionResult(
                    success=False,
                    error=f"Failed to parse response: {str(e)}",
                    notes=f"Raw response: {content[:500]}"
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
    
    def _parse_questions_with_llm(self, text: str, context: Dict[str, Any] = None) -> List[Dict[str, Any]]:
        """
        Use Groq LLM to parse questions from extracted text.
        
        Args:
            text: Raw OCR text from Google Vision
            context: Optional context for better parsing
        
        Returns:
            List of question dictionaries
        """
        try:
            headers = {
                "Authorization": f"Bearer {self.groq_api_key}",
                "Content-Type": "application/json"
            }
            
            context_hint = ""
            if context:
                context_hint = f"\nContext: Class {context.get('class_name', '')}, Subject {context.get('subject_name', '')}"
            
            prompt = f"""Parse this exam paper text and extract all questions.

Text:
{text}

{context_hint}

For each question, identify:
1. Question number
2. Full question text
3. Question type (MCQ, SHORT, ESSAY, TRUE_FALSE, FILL_BLANK)
4. If MCQ: all options
5. Marks (if visible)

Return ONLY a valid JSON array:
[
  {{
    "number": 1,
    "question_text": "...",
    "question_type": "SHORT",
    "marks": 5,
    "options": {{}},
    "confidence": 0.9
  }}
]

Return ONLY the JSON array, no extra text."""
            
            data = {
                "model": GROQ_MODEL,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are an expert at parsing exam questions from OCR text. Always return valid JSON."
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
            
            # Remove markdown code blocks if present
            if content.startswith('```'):
                content = content.split('```')[1]
                if content.startswith('json'):
                    content = content[4:]
                content = content.strip()
            
            questions = json.loads(content)
            
            if not isinstance(questions, list):
                questions = [questions]
            
            return questions
        
        except Exception as e:
            logger.error(f"LLM parsing error: {str(e)}", exc_info=True)
            # Fallback: basic question detection
            return self._fallback_question_extraction(text)
    
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
