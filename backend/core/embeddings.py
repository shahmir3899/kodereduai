import hashlib
import re

import numpy as np


TOKEN_RE = re.compile(r"[A-Za-z0-9']+")


def generate_text_embedding(text: str, dimensions: int = 1536) -> list[float]:
    """Generate a deterministic normalized embedding vector for text.

    This is a local fallback embedding generator that avoids external API
    dependencies while still producing stable vectors suitable for cosine
    similarity and pgvector storage.
    """
    normalized_text = (text or '').strip().lower()
    if not normalized_text:
        return [0.0] * dimensions

    vector = np.zeros(dimensions, dtype=np.float32)
    tokens = TOKEN_RE.findall(normalized_text)
    if not tokens:
        tokens = [normalized_text]

    for token in tokens:
        digest = hashlib.sha256(token.encode('utf-8')).digest()
        primary_index = int.from_bytes(digest[:4], 'big') % dimensions
        secondary_index = int.from_bytes(digest[4:8], 'big') % dimensions
        sign = 1.0 if digest[8] % 2 == 0 else -1.0

        vector[primary_index] += 1.0
        vector[secondary_index] += 0.5 * sign

    norm = np.linalg.norm(vector)
    if norm:
        vector = vector / norm

    return vector.astype(float).tolist()