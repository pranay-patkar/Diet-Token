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
import re
from itertools import groupby
from collections import Counter

from core.models import PruneDecision, ScoredSentence

# Anaphoric pronouns / demonstratives that require an antecedent context sentence
_ANAPHORA_STARTERS = re.compile(
    r"^(it|this|that|these|those|they|he|she|such|the above|as a result|consequently|therefore|however)\b",
    re.IGNORECASE,
)

# Discourse hedges and conversational fluff
_HEDGE_PATTERNS = [
    (r"\b(it is important to note that|it should be noted that|it is worth mentioning that)\s*", ""),
    (r"\b(as (?:mentioned|stated|discussed) (?:before|above|previously))\s*,?\s*", ""),
    (r"\b(in order to)\b", "to"),
    (r"\b(due to the fact that)\b", "because"),
    (r"\b(for the purpose of)\b", "for"),
    (r"\b(at this point in time)\b", "currently"),
    (r"\b(first and foremost)\b", "first"),
    (r"\b(needless to say)\s*,?\s*", ""),
    (r"\b(as a matter of fact)\s*,?\s*", ""),
    (r"\[\d+(?:,\s*\d+)*\]", ""),  # Citation numbers like [1] or [1, 2]
]

FILLER_WORDS = {
    "basically", "obviously", "essentially", "literally", "totally",
    "actually", "definitely", "certainly", "absolutely", "clearly",
    "very", "extremely", "really", "quite", "rather", "somewhat",
    "in fact", "as such",
}


def _word_tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def _jaccard_similarity(set_a: set[str], set_b: set[str]) -> float:
    if not set_a or not set_b:
        return 0.0
    inter = len(set_a & set_b)
    return inter / float(len(set_a | set_b))


def prune_sentences(
    scored_sentences: list[ScoredSentence],
    keep_fraction: float = 0.4,
    min_keep_per_chunk: int = 1,
    mode: str = "cherry-pick",
    preserve_anaphora: bool = True,
    mmr_lambda: float = 0.75,
) -> list[PruneDecision]:
    """
    Prune scored sentences from a single chunk with anaphora preservation
    and redundancy deduplication.
    """
    if not scored_sentences:
        return []

    n = len(scored_sentences)
    keep_n = max(min_keep_per_chunk, math.ceil(n * keep_fraction))
    keep_n = min(keep_n, n)  # can't keep more than we have

    if mode == "contiguous":
        return _prune_contiguous(scored_sentences, keep_n)
    return _prune_cherry_pick(
        scored_sentences,
        keep_n,
        min_keep_per_chunk,
        preserve_anaphora=preserve_anaphora,
        mmr_lambda=mmr_lambda,
    )


def _prune_cherry_pick(
    scored_sentences: list[ScoredSentence],
    keep_n: int,
    min_keep_per_chunk: int,
    preserve_anaphora: bool = True,
    mmr_lambda: float = 0.75,
) -> list[PruneDecision]:
    # MMR (Maximal Marginal Relevance) deduplication loop
    candidates = list(scored_sentences)
    token_sets = {id(ss): _word_tokens(ss.text) for ss in candidates}

    selected: list[ScoredSentence] = []
    
    # Sort primarily by score
    sorted_candidates = sorted(candidates, key=lambda ss: ss.score, reverse=True)

    for cand in sorted_candidates:
        if len(selected) >= keep_n:
            break
            
        cand_toks = token_sets[id(cand)]
        # Check redundancy against already selected sentences
        max_redundancy = 0.0
        if selected:
            max_redundancy = max(
                _jaccard_similarity(cand_toks, token_sets[id(s)]) for s in selected
            )
        
        # Penalize if highly redundant (>0.65 similarity)
        effective_score = mmr_lambda * cand.score - (1.0 - mmr_lambda) * max_redundancy
        if max_redundancy < 0.65 or len(selected) < min_keep_per_chunk:
            selected.append(cand)

    # Anaphoric referent preservation:
    # If a kept sentence starts with an anaphoric referent ("It", "This", "They"),
    # ensure its preceding sentence is also kept so context isn't broken.
    if preserve_anaphora:
        selected_indices = {ss.index for ss in selected}
        for ss in list(selected):
            if _ANAPHORA_STARTERS.search(ss.text.strip()) and ss.index > 0:
                prev_idx = ss.index - 1
                if prev_idx not in selected_indices:
                    # Locate the preceding sentence
                    prev_ss = next((s for s in scored_sentences if s.index == prev_idx), None)
                    if prev_ss:
                        selected.append(prev_ss)
                        selected_indices.add(prev_idx)

    keep_ids = set(id(ss) for ss in selected)

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


def strip_filler_words(text: str) -> str:
    """Strips out filler sentences, hedges, citations, and redundant adjectives/adverbs."""
    cleaned = text
    
    # 1. Strip discourse hedges & structural wordiness
    for pattern, replacement in _HEDGE_PATTERNS:
        cleaned = re.sub(pattern, replacement, cleaned, flags=re.IGNORECASE)

    # 2. Strip single-word fillers
    for filler in FILLER_WORDS:
        pattern = r'\b' + re.escape(filler) + r'\b,?\s*'
        cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)

    # Clean up whitespace and stray punctuation
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    cleaned = re.sub(r'\s+([.,!?;:])', r'\1', cleaned)
    
    # Fix capitalization at start of sentences
    if cleaned and cleaned[0].islower():
        cleaned = cleaned[0].upper() + cleaned[1:]
        
    return cleaned


def reassemble(decisions: list[PruneDecision], strip_filler: bool = True) -> str:
    """
    Joins the kept sentences back into text, preserving original sentence
    order. Optionally applies micro-pruning to strip conversational fluff.
    """
    kept = [d for d in decisions if d.kept]
    kept.sort(key=lambda d: d.scored_sentence.index)
    raw_text = " ".join(d.scored_sentence.text for d in kept)
    if strip_filler:
        return strip_filler_words(raw_text)
    return raw_text
