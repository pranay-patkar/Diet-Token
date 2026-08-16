"""
Scores each sentence's relevance to the query.

Strategy:
  - When a query is provided: BM25/Hybrid is used as a cheap pre-filter,
    then a cross-encoder produces the actual relevance score.
  - When query is empty (query-less mode): Balanced scoring based on
    lexical information density + procedural instruction/constraint detection.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from typing import Any

from core.instruction_detector import detect_instruction_type
from core.models import ScoredSentence, Sentence

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_ENTITY_RE = re.compile(
    r"\b(?:\$?\d+(?:\.\d+)?(?:%|k|m|b|gb|mb|ms|usd|kb|fps|hz|ghz)?|#[0-9a-fA-F]{3,8}|[A-Z]{2,}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b"
)

_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "if", "then", "else", "for", "of", "to", "in", "on", "at", "by",
    "with", "from", "as", "is", "are", "was", "were", "be", "been", "being", "it", "its", "this", "that",
    "these", "those", "we", "you", "they", "he", "she", "them", "their", "our", "your", "i", "my", "me",
    "him", "her", "us", "his", "hers", "will", "would", "can", "could", "should", "may", "might", "shall",
    "do", "does", "did", "done", "have", "has", "had", "not", "no", "nor", "so", "too", "very", "just",
    "also", "than", "then", "there", "here", "when", "where", "why", "how", "what", "which", "who", "whom",
    "whose", "all", "any", "both", "each", "few", "more", "most", "other", "some", "such", "only", "own",
    "same", "don", "now", "over", "under", "again", "further", "once"
}


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


def extract_auto_query(text: str, max_terms: int = 15) -> str:
    tokens = [t for t in _tokenize(text) if len(t) > 2 and t not in _STOPWORDS]
    entities = _ENTITY_RE.findall(text)
    counts = Counter(tokens)
    scored = sorted(counts.items(), key=lambda x: x[1] * (2 if len(x[0]) > 6 else 1), reverse=True)
    top_words = [w for w, _ in scored[:max_terms]]
    entity_terms = [e.lower().strip() for e in entities if e.lower().strip() not in _STOPWORDS]
    return " ".join(top_words + entity_terms)


def _queryless_score(sentence: str, words: list[str], idf: dict[str, float]) -> float:
    # 1. Lexical rarity
    counts = Counter(words)
    rarity = sum(c * idf.get(w, 1.0) for w, c in counts.items()) / max(1, len(words))

    # 2. Instruction & spec boost
    instr_type = detect_instruction_type(sentence)
    instr_boost = {
        "critical": 3.0,
        "instruction": 2.0,
        "technical": 1.5,
        "logical": 1.0,
        "contextual": 0.0,
        None: 0.0,
    }.get(instr_type, 0.0)

    # 3. Entity presence
    has_entity = 0.5 if _ENTITY_RE.search(sentence) else 0.0

    # 4. Length factor: very short sentences are penalized unless critical
    wc = len(words)
    if instr_boost > 0:
        length_factor = 1.0
    else:
        length_factor = 0.3 if wc < 3 else (0.7 if wc > 40 else 1.0)

    return (rarity * 0.4 + instr_boost + has_entity) * length_factor


# --------------------------------------------------------------------------
# BM25 pre-filter
# --------------------------------------------------------------------------

class BM25PreFilter:
    """
    BM25 implementation scoped to candidate sentences.
    """

    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b

    def score(self, query: str, sentences: list[Sentence]) -> dict[int, float]:
        query_terms = _tokenize(query)
        if not query_terms or not sentences:
            return {id(s): 0.0 for s in sentences}

        doc_tokens = [_tokenize(s.text) for s in sentences]
        doc_lengths = [len(toks) for toks in doc_tokens]
        avg_len = sum(doc_lengths) / len(doc_lengths) if doc_lengths else 1.0

        n_docs = len(sentences)
        doc_freq: Counter = Counter()
        for toks in doc_tokens:
            for term in set(toks):
                doc_freq[term] += 1

        scores: dict[int, float] = {}
        for sentence, toks, dl in zip(sentences, doc_tokens, doc_lengths):
            term_counts = Counter(toks)
            total = 0.0
            for term in query_terms:
                if term not in term_counts:
                    continue
                df = doc_freq.get(term, 0)
                idf = math.log(1 + (n_docs - df + 0.5) / (df + 0.5))
                tf = term_counts[term]
                denom = tf + self.k1 * (1 - self.b + self.b * dl / avg_len)
                total += idf * (tf * (self.k1 + 1)) / denom if denom else 0.0
            scores[id(sentence)] = total
        return scores

    def filter(
        self,
        query: str,
        sentences: list[Sentence],
        keep_fraction: float = 0.6,
        min_keep: int = 2,
    ) -> tuple[list[Sentence], list[Sentence]]:
        if len(sentences) <= min_keep:
            return list(sentences), []

        scores = self.score(query, sentences)
        ranked = sorted(sentences, key=lambda s: scores[id(s)], reverse=True)

        keep_n = max(min_keep, math.ceil(len(sentences) * keep_fraction))
        survivors_set = set(id(s) for s in ranked[:keep_n])

        survivors = [s for s in sentences if id(s) in survivors_set]
        filtered_out = [s for s in sentences if id(s) not in survivors_set]
        return survivors, filtered_out


# --------------------------------------------------------------------------
# Cross-encoder scorer
# --------------------------------------------------------------------------

class CrossEncoderScorer:
    """
    Wraps a sentence-transformers CrossEncoder model. Lazily loaded.
    """

    def __init__(self, model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"):
        self.model_name = model_name
        self._model = None

    def _load(self):
        if self._model is None:
            from sentence_transformers import CrossEncoder  # type: ignore

            self._model = CrossEncoder(self.model_name)
        return self._model

    @staticmethod
    def _normalize(raw_scores: list[float]) -> list[float]:
        return [1.0 / (1.0 + math.exp(-s)) for s in raw_scores]

    def score(self, query: str, sentences: list[Sentence]) -> list[ScoredSentence]:
        if not sentences:
            return []
        model = self._load()
        pairs = [(query, s.text) for s in sentences]
        raw_scores = model.predict(pairs)
        normalized = self._normalize([float(s) for s in raw_scores])
        return [
            ScoredSentence(sentence=s, score=score, scorer_name="cross-encoder")
            for s, score in zip(sentences, normalized)
        ]


# --------------------------------------------------------------------------
# Entry point: two-stage scoring pipeline
# --------------------------------------------------------------------------

from core.hybrid_filter import HybridPreFilter


def score_sentences(
    query: str,
    sentences: list[Sentence],
    cross_encoder: CrossEncoderScorer | None = None,
    bm25_prefilter: BM25PreFilter | None = None,
    prefilter_keep_fraction: float = 0.6,
    prefilter_min_keep: int = 2,
    use_prefilter: bool = True,
) -> list[ScoredSentence]:
    """
    Run the scoring pipeline:
    - If query is provided: BM25/Hybrid pre-filter -> CrossEncoder
    - If query is empty: Balanced query-less density & instruction scoring
    """
    if not sentences:
        return []

    # Query-less mode
    if not query or not query.strip():
        # Compute IDF map across sentences
        doc_tokens = [_tokenize(s.text) for s in sentences]
        doc_freq: Counter = Counter()
        for toks in doc_tokens:
            for term in set(toks):
                doc_freq[term] += 1
        n_docs = len(sentences)
        idf_map = {term: math.log((n_docs + 1) / (df + 1)) + 1 for term, df in doc_freq.items()}

        results = []
        for s in sentences:
            toks = _tokenize(s.text)
            sc = _queryless_score(s.text, toks, idf_map)
            results.append(ScoredSentence(sentence=s, score=sc, scorer_name="balanced-density"))
        return results

    # Stage 1: Pre-filter (defaults to HybridPreFilter)
    if use_prefilter:
        prefilter = bm25_prefilter if bm25_prefilter is not None else HybridPreFilter()
        survivors, filtered_out = prefilter.filter(
            query,
            sentences,
            keep_fraction=prefilter_keep_fraction,
            min_keep=prefilter_min_keep,
        )
    else:
        survivors = list(sentences)
        filtered_out = []

    # Stage 2: Cross-Encoder
    if survivors:
        scorer = cross_encoder if cross_encoder is not None else CrossEncoderScorer()
        scored_survivors = scorer.score(query, survivors)
    else:
        scored_survivors = []

    # Re-assemble all sentences, giving score 0.0 to pre-filtered ones
    scored_by_id = {ss.sentence.index: ss for ss in scored_survivors}
    result = []
    for s in sentences:
        if s.index in scored_by_id:
            result.append(scored_by_id[s.index])
        else:
            result.append(
                ScoredSentence(
                    sentence=s,
                    score=0.0,
                    scorer_name="bm25-filtered",
                )
            )

    return result
