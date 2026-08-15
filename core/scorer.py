"""
Scores each sentence's relevance to the query.

Strategy (see project design notes): BM25 is used as a cheap pre-filter to
avoid running the cross-encoder on sentences that are obviously irrelevant,
then a cross-encoder produces the actual relevance score used for pruning.

Both scorers are exposed independently so they can be benchmarked or swapped,
but `score_sentences()` is the entry point most callers want — it runs the
full two-stage pipeline and always returns one ScoredSentence per input
Sentence (pre-filtered-out sentences get score=0.0, scorer_name="bm25-filtered"
rather than being silently dropped, so pruner.py can still apply a floor).
"""

from __future__ import annotations

import math
import re
from collections import Counter

from core.models import ScoredSentence, Sentence

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


# --------------------------------------------------------------------------
# BM25 pre-filter
# --------------------------------------------------------------------------

class BM25PreFilter:
    """
    Minimal BM25 implementation scoped to a single query's candidate
    sentences (not a general-purpose search index — we rebuild the corpus
    stats fresh per query since the candidate set is small, ~tens of
    sentences per chunk).
    """

    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b

    def score(self, query: str, sentences: list[Sentence]) -> dict[int, float]:
        """Returns a map of `id(sentence)` -> raw BM25 score (unnormalized)."""
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
        """
        Splits sentences into (survivors, filtered_out) using BM25 score.
        Keeps the top `keep_fraction` of sentences by score, but never
        filters below `min_keep` survivors — this is a coarse pre-filter,
        not the final pruning decision.
        """
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
    Wraps a sentence-transformers CrossEncoder model. Lazily loaded so
    importing this module doesn't require the model weights unless a
    cross-encoder score is actually requested.
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
        """Squash raw logit-ish cross-encoder outputs into 0-1 via sigmoid."""
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
# Fallback: embedding cosine-similarity scorer (middle-ground option)
# --------------------------------------------------------------------------

class EmbeddingScorer:
    """Bi-encoder cosine-similarity scorer. Faster than cross-encoder, less accurate."""

    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        self.model_name = model_name
        self._model = None

    def _load(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer  # type: ignore

            self._model = SentenceTransformer(self.model_name)
        return self._model

    def score(self, query: str, sentences: list[Sentence]) -> list[ScoredSentence]:
        if not sentences:
            return []
        import numpy as np  # type: ignore

        model = self._load()
        query_vec = model.encode([query])[0]
        sent_vecs = model.encode([s.text for s in sentences])

        q_norm = query_vec / (np.linalg.norm(query_vec) + 1e-9)
        results = []
        for s, vec in zip(sentences, sent_vecs):
            v_norm = vec / (np.linalg.norm(vec) + 1e-9)
            cos_sim = float(np.dot(q_norm, v_norm))
            # cosine sim is in [-1, 1]; rescale to [0, 1] for consistency
            # with the cross-encoder's output range.
            results.append(
                ScoredSentence(
                    sentence=s, score=(cos_sim + 1) / 2, scorer_name="embedding"
                )
            )
        return results


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
    Run the full two-stage scoring pipeline: BM25/Hybrid pre-filter -> CrossEncoder.
    """
    if not sentences:
        return []

    # Stage 1: Pre-filter (defaults to HybridPreFilter if none provided)
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

    # Stage 2: Cross-Encoder (or fallback fake scorer for testing)
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
