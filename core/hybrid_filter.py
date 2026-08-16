"""
Hybrid Pre-Filter combining BM25 lexical search with lightweight TF-IDF / character n-gram cosine similarity
to resolve zero-keyword overlap drops during Stage 1 pre-filtering.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from core.models import Sentence
from core.scorer import BM25PreFilter

_TOKEN_RE = re.compile(r"[a-z0-9]+")

def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())

def _char_ngrams(text: str, n: int = 3) -> list[str]:
    clean = text.lower()
    return [clean[i:i+n] for i in range(len(clean) - n + 1)]

_ENTITY_RE = re.compile(r"\b(?:\d+(?:\.\d+)?(?:%|ms|s|gb|mb|kb|tb|usd|\$|x)?|[A-Z][a-z0-9]+)\b")

class HybridPreFilter(BM25PreFilter):
    """
    Hybrid pre-filter combining BM25 lexical matching with character n-gram overlap
    and query constraint / named-entity multipliers.
    Prevents pre-filter drops when paraphrased answers share character roots or patterns.
    """

    def score_hybrid(self, query: str, sentences: list[Sentence]) -> dict[int, float]:
        bm25_scores = self.score(query, sentences)
        query_ngrams = set(_char_ngrams(query, n=3))
        query_entities = set(_ENTITY_RE.findall(query.lower()))
        
        hybrid_scores = {}
        for s in sentences:
            s_id = id(s)
            bm25_val = bm25_scores.get(s_id, 0.0)
            
            # Sub-word / character n-gram similarity score
            s_ngrams = set(_char_ngrams(s.text, n=3))
            if query_ngrams and s_ngrams:
                ngram_overlap = len(query_ngrams & s_ngrams) / float(len(query_ngrams))
            else:
                ngram_overlap = 0.0

            # Constraint / Entity multiplier
            s_entities = set(_ENTITY_RE.findall(s.text.lower()))
            entity_boost = 1.0
            if query_entities and s_entities:
                matching_entities = len(query_entities & s_entities)
                if matching_entities > 0:
                    entity_boost += 0.4 * matching_entities
                
            # Combine BM25 score with n-gram semantic baseline and entity boost
            hybrid_scores[s_id] = (bm25_val + (ngram_overlap * 2.5)) * entity_boost
            
        return hybrid_scores

    def filter(
        self,
        query: str,
        sentences: list[Sentence],
        keep_fraction: float = 0.6,
        min_keep: int = 2,
    ) -> tuple[list[Sentence], list[Sentence]]:
        if len(sentences) <= min_keep:
            return list(sentences), []

        scores = self.score_hybrid(query, sentences)
        ranked = sorted(sentences, key=lambda s: scores[id(s)], reverse=True)

        keep_n = max(min_keep, math.ceil(len(sentences) * keep_fraction))
        survivors_set = set(id(s) for s in ranked[:keep_n])

        survivors = [s for s in sentences if id(s) in survivors_set]
        filtered_out = [s for s in sentences if id(s) not in survivors_set]
        return survivors, filtered_out
