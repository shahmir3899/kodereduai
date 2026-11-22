"""
Shared AI helpers for exam papers: provider error text that is safe to log and show, and the question
grammar/spelling review (``review-questions``).

The old questions-only paper scan (Google Vision -> Groq) that gave this module its name was removed in
Paper Builder v2 Phase 7; the scan is ``paper_scan_blocks`` now.
"""

import json
import logging
import re
from typing import Any, Dict, List

from django.conf import settings
import requests

from assistant.usage import record_external

logger = logging.getLogger(__name__)

GROQ_API_KEY = getattr(settings, 'GROQ_API_KEY', '')
GROQ_MODEL = settings.GROQ_MODEL


def _describe_http_error(response: 'requests.Response') -> str:
    """Extracts the provider's actual error message from a non-2xx response body
    (Google Vision and Groq both use a {"error": {"message": ...}} shape). Bare
    response.raise_for_status() text (e.g. "404 Client Error: Not Found for url: ...")
    discards the body, which is where the actually useful reason lives (e.g. "The
    model `x` does not exist or you do not have access to it", or "API key not found").
    Used for both providers here rather than duplicating this per-provider."""
    try:
        body = response.json()
        message = body.get('error', {}).get('message')
        if message:
            return f"{response.status_code}: {_mask_provider_ids(message)}"
    except (ValueError, AttributeError):
        pass
    return f"{response.status_code}: {_mask_provider_ids(response.text[:300])}"


def _mask_provider_ids(text: str) -> str:
    """Groq 429 bodies embed the account's organization id; keep it out of logs and
    stored error text."""
    return re.sub(r'org_[A-Za-z0-9]+', 'org_***', text)


# Shown to users in place of raw provider errors (which can carry account ids,
# billing links and model names). The raw text stays in the server log.
MSG_AI_BUSY = "The AI service is busy right now. Please try again in a minute."
MSG_GENERIC_FAILURE = "We could not process this photo. Please try again with a clearer photo."


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
            record_external('examinations.paper_ocr_processor.extract', result)
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
