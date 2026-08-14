"""
Decides which scored sentences survive into the compressed context.

Key design decisions (see project notes):
  - top-k-by-percentage instead of a fixed score threshold, since a fixed
    threshold generalizes badly across queries (a narrow query may have
    nothing above 0.7; a broad query may have everything above it).
  - a floor: never prune a chunk down to zero sentences.
  - optional contiguous-span mode: instead of cherry-picking individual
    high-scoring sentences (which can strand pronouns/referents like "it",
    "this", "the above"), keep contiguous runs of sentences. Cherry-pick
    mode is also supported for callers who want maximum compression and
    are OK with some incoherence.
"""

from __future__ import annotations

import math
from itertools import groupby

from core.models import PruneDecision, ScoredSentence


def prune_sentences(
    scored_sentences: list[ScoredSentence],
    keep_fraction: float = 0.4,
    min_keep_per_chunk: int = 1,
    mode: str = "cherry-pick",
) -> list[PruneDecision]:
    """
    Prune scored sentences from a single chunk (all `scored_sentences` should
    share one chunk_id — call once per chunk from compressor.py).

    Args:
        scored_sentences: sentences with relevance scores, any order.
        keep_fraction: fraction of sentences to keep, ranked by score
            (e.g. 0.4 = keep the top 40%).
        min_keep_per_chunk: floor — always keep at least this many
            sentences, even if their score is low. Never prune a chunk to 0.
        mode: "cherry-pick" keeps the top-scoring sentences regardless of
            position (max compression, some incoherence risk). "contiguous"
            keeps the single best-scoring contiguous span of sentences
            (better readability, less compression).

    Returns:
        One PruneDecision per input sentence, `kept` set accordingly.
        Order matches input order.
    """
    if not scored_sentences:
        return []

    n = len(scored_sentences)
    keep_n = max(min_keep_per_chunk, math.ceil(n * keep_fraction))
    keep_n = min(keep_n, n)  # can't keep more than we have

    if mode == "contiguous":
        return _prune_contiguous(scored_sentences, keep_n)
    return _prune_cherry_pick(scored_sentences, keep_n, min_keep_per_chunk)


def _prune_cherry_pick(
    scored_sentences: list[ScoredSentence],
    keep_n: int,
    min_keep_per_chunk: int,
) -> list[PruneDecision]:
    ranked = sorted(scored_sentences, key=lambda ss: ss.score, reverse=True)
    keep_ids = set(id(ss) for ss in ranked[:keep_n])

    decisions = []
    for ss in scored_sentences:  # preserve original order in output
        kept = id(ss) in keep_ids
        if kept and ss.score <= 0.0:
            reason = "floor_minimum"
        elif kept:
            reason = "above_threshold"
        else:
            reason = "below_threshold"
        decisions.append(PruneDecision(scored_sentence=ss, kept=kept, reason=reason))
    return decisions


def _prune_contiguous(
    scored_sentences: list[ScoredSentence],
    keep_n: int,
) -> list[PruneDecision]:
    """
    Finds the contiguous window of `keep_n` sentences (by original sentence
    order) with the highest total score, and keeps only that window.
    Assumes scored_sentences may be out of order; sorts by index first.
    """
    ordered = sorted(scored_sentences, key=lambda ss: ss.index)
    n = len(ordered)
    keep_n = min(keep_n, n)

    if keep_n == n:
        best_start = 0
    else:
        # sliding window over the sorted-by-index list to find max-score span
        window_sum = sum(ss.score for ss in ordered[:keep_n])
        best_sum = window_sum
        best_start = 0
        for start in range(1, n - keep_n + 1):
            window_sum += ordered[start + keep_n - 1].score - ordered[start - 1].score
            if window_sum > best_sum:
                best_sum = window_sum
                best_start = start

    keep_ids = set(id(ss) for ss in ordered[best_start:best_start + keep_n])

    decisions = []
    for ss in scored_sentences:  # preserve original input order in output
        kept = id(ss) in keep_ids
        reason = "contiguous_span" if kept else "outside_span"
        decisions.append(PruneDecision(scored_sentence=ss, kept=kept, reason=reason))
    return decisions


def reassemble(decisions: list[PruneDecision]) -> str:
    """
    Joins the kept sentences back into text, preserving original sentence
    order (PruneDecision order from prune_sentences already matches input
    order, but this re-sorts by index defensively in case callers merged
    lists from multiple sources).
    """
    kept = [d for d in decisions if d.kept]
    kept.sort(key=lambda d: d.scored_sentence.index)
    return " ".join(d.scored_sentence.text for d in kept)
