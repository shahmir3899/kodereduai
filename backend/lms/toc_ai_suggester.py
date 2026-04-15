"""
AI-assisted TOC structuring helper.

Takes raw TOC text and returns a normalized chapter/topic structure.
Falls back to deterministic parser when AI is unavailable or fails.
"""

import json
import logging

from django.conf import settings

from .toc_parser import parse_toc_preview

logger = logging.getLogger(__name__)


TOC_SUGGESTION_PROMPT = """You are a curriculum assistant. Convert the provided textbook TOC text into a JSON structure.

Rules:
1. Group content into chapters with ordered topics.
2. If numbering is noisy, infer sensible ordering.
3. Keep original language/script as-is.
4. Do not invent content outside provided text.
5. Return JSON only (no markdown fence).

Required JSON schema:
{
  "chapters": [
    {
      "title": "Chapter title",
      "topics": [
        {"title": "Topic title"}
      ]
    }
  ],
  "warnings": ["optional warning"],
  "confidence": 0.0
}

TOC text:
{raw_text}
"""


def _normalize_suggestion(payload):
    """Normalize AI payload to expected schema and remove empty entries."""
    chapters = []
    for chapter in payload.get('chapters', []) if isinstance(payload, dict) else []:
        title = str(chapter.get('title', '')).strip()
        if not title:
            continue

        topics = []
        for topic in chapter.get('topics', []):
            topic_title = str(topic.get('title', '')).strip()
            if not topic_title:
                continue
            topics.append({'title': topic_title})

        chapters.append({'title': title, 'topics': topics})

    warnings = payload.get('warnings', []) if isinstance(payload, dict) else []
    if not isinstance(warnings, list):
        warnings = []
    warnings = [str(w).strip() for w in warnings if str(w).strip()]

    confidence = payload.get('confidence', 0.0) if isinstance(payload, dict) else 0.0
    try:
        confidence = float(confidence)
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    return {
        'chapters': chapters,
        'warnings': warnings,
        'confidence': confidence,
    }


def _fallback_preview(raw_text, reason=None):
    """Deterministic fallback using the rule-based parser."""
    preview = parse_toc_preview(raw_text)
    chapters = [
        {
            'title': chapter.get('title', ''),
            'topics': [{'title': t.get('title', '')} for t in chapter.get('topics', [])],
        }
        for chapter in preview.get('chapters', [])
    ]

    warnings = list(preview.get('warnings', []))
    if reason:
        warnings.insert(0, reason)

    return {
        'success': True,
        'source': 'rule_based',
        'confidence': 0.5,
        'chapters': chapters,
        'warnings': warnings,
    }


def suggest_toc_structure(raw_text, language='en'):
    """
    Suggest structured TOC using AI with safe fallback.

    Returns dict:
    {
      success: bool,
      source: 'ai'|'rule_based',
      confidence: float,
      chapters: [...],
      warnings: [...],
    }
    """
    text = (raw_text or '').strip()
    if not text:
        return {
            'success': False,
            'source': 'rule_based',
            'confidence': 0.0,
            'chapters': [],
            'warnings': ['raw_text is required.'],
        }

    api_key = getattr(settings, 'GROQ_API_KEY', None)
    if not api_key:
        return _fallback_preview(
            text,
            reason='AI suggestion unavailable (GROQ_API_KEY missing). Used rule-based parsing.',
        )

    try:
        from groq import Groq  # type: ignore[import-not-found]

        client = Groq(api_key=api_key)
        model_name = getattr(settings, 'GROQ_MODEL', 'llama-3.3-70b-versatile')

        prompt = TOC_SUGGESTION_PROMPT.format(raw_text=text)
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {
                    'role': 'system',
                    'content': (
                        'You extract textbook TOC into structured curriculum JSON. '
                        'Do not add markdown fences.'
                    ),
                },
                {'role': 'user', 'content': prompt},
            ],
            temperature=0.1,
            max_tokens=2000,
        )

        content = response.choices[0].message.content
        if '```json' in content:
            content = content.split('```json', 1)[1].split('```', 1)[0]
        elif '```' in content:
            content = content.split('```', 1)[1].split('```', 1)[0]

        parsed = json.loads(content.strip())
        normalized = _normalize_suggestion(parsed)

        if not normalized['chapters']:
            return _fallback_preview(
                text,
                reason='AI suggestion returned no usable chapters. Used rule-based parsing.',
            )

        # Slightly reduce confidence when language is uncommon and no warnings were supplied.
        confidence = normalized['confidence']
        if language == 'other' and confidence > 0.8 and not normalized['warnings']:
            confidence = 0.8

        return {
            'success': True,
            'source': 'ai',
            'confidence': confidence,
            'chapters': normalized['chapters'],
            'warnings': normalized['warnings'],
        }

    except Exception as exc:
        logger.warning('TOC AI suggestion failed, falling back to rule-based parser: %s', exc)
        return _fallback_preview(
            text,
            reason='AI suggestion failed. Used rule-based parsing.',
        )
