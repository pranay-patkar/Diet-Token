"""
Decides which scored sentences survive into the compressed context.

Key design decisions:
  - top-k-by-percentage instead of a fixed score threshold
  - a floor: never prune a chunk down to zero sentences
  - semantic MMR deduplication (word overlap + entity set diff) protecting critical specs
  - referential anaphora anchoring (preserving antecedent sentences for pronouns)
  - conservative micro-pruning of discourse hedges
"""

from __future__ import annotations

import math
import re
from typing import Any

from core.instruction_detector import is_critical_instruction
from core.models import PruneDecision, ScoredSentence

# Anaphoric pronouns / demonstratives that require an antecedent context sentence
_ANAPHORA_STARTERS = re.compile(
    r"^(it|this|that|these|those|they|he|she|such|the above|as a result|consequently|therefore|however)\b",
    re.IGNORECASE,
)

_ENTITY_RE = re.compile(
    r"\b(?:\$?\d+(?:\.\d+)?(?:%|k|m|b|gb|mb|ms|usd|kb|fps|hz|ghz)?|#[0-9a-fA-F]{3,8}|[A-Z]{2,}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b"
)

# Conservative discourse hedges and conversational fluff
_HEDGE_PATTERNS = [
    (r"\b(it is important to note that|it should be noted that|it is worth mentioning that)\s*", ""),
    (r"\b(as (?:mentioned|stated|discussed) (?:before|above|previously))\s*,?\s*", ""),
    # "in order to" only stripped if NOT followed by an action verb
    (
        r"\bin order to\b(?!\s+(?:run|execute|invoke|call|perform|complete|finish|start|begin|"
        r"stop|halt|abort|trigger|fire|emit|dispatch|send|receive|accept|reject|deny|allow|"
        r"permit|enable|disable|activate|deactivate|initialize|terminate|destroy|create|"
        r"delete|update|modify|change|set|get|read|write|append|prepend|insert|remove|add|"
        r"clear|reset|flush|sync|commit|rollback|push|pull|fetch|load|save|persist|cache|"
        r"invalidate|refresh|reload|restart|reboot|shutdown|wake|sleep|suspend|resume)\b)",
        "to",
    ),
    (r"\b(due to the fact that)\b", "because"),
    # "for the purpose of" only stripped if followed by a determiner/pronoun
    (r"\b(for the purpose of)\b(?=\s+(?:the|a|an|this|that|these|those|my|your|our|their|its|his|her)\b)", "for"),
    (r"\b(at this point in time)\b", "currently"),
    (r"\b(first and foremost)\b", "first"),
    (r"\b(needless to say)\s*,?\s*", ""),
    (r"\b(as a matter of fact)\s*,?\s*", ""),
    # Citations: strip [1], [2], [1, 2] etc. when preceded by whitespace/punctuation (preserving code arr[0])
    (r"(?<![a-zA-Z0-9_])\[\d+(?:[,\s–-]+\d+)*\]", ""),
    (r"\[et al\.\]", ""),
]

FILLER_WORDS = {
    "basically", "obviously", "essentially", "literally", "totally",
    "definitely", "certainly", "absolutely", "clearly",
    "extremely", "really", "quite", "rather", "somewhat",
    "in fact", "as such",
}


def _word_tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def _extract_entities(text: str) -> set[str]:
    matches = _ENTITY_RE.findall(text)
    return {m.lower().strip() for m in matches if len(m.strip()) > 1}


def _redundancy(cand_words: set[str], sel_words: set[str], cand_entities: set[str], sel_entities: set[str]) -> float:
    inter = len(cand_words & sel_words)
    union = len(cand_words | sel_words)
    word_red = inter / union if union else 0.0

    ent_inter = len(cand_entities & sel_entities)
    ent_union = len(cand_entities | sel_entities)
    ent_sim = ent_inter / ent_union if ent_union else (1.0 if not cand_entities and not sel_entities else 0.0)

    return word_red * 0.7 + ent_sim * 0.3


def prune_sentences(
    scored_sentences: list[ScoredSentence],
    keep_fraction: float = 0.5,
    min_keep_per_chunk: int = 1,
    mode: str = "cherry-pick",
    preserve_anaphora: bool = True,
    mmr_lambda: float = 0.75,
    mmr_threshold: float = 0.75,
) -> list[PruneDecision]:
    """
    Prune scored sentences from a single chunk with anaphora preservation
    and semantic redundancy deduplication.
    """
    if not scored_sentences:
        return []

    n = len(scored_sentences)
    keep_n = max(min_keep_per_chunk, math.ceil(n * keep_fraction))
    keep_n = min(keep_n, n)

    if mode == "contiguous":
        return _prune_contiguous(scored_sentences, keep_n)
    return _prune_cherry_pick(
        scored_sentences,
        keep_n,
        min_keep_per_chunk,
        preserve_anaphora=preserve_anaphora,
        mmr_lambda=mmr_lambda,
        mmr_threshold=mmr_threshold,
    )


def _prune_cherry_pick(
    scored_sentences: list[ScoredSentence],
    keep_n: int,
    min_keep_per_chunk: int,
    preserve_anaphora: bool = True,
    mmr_lambda: float = 0.75,
    mmr_threshold: float = 0.75,
) -> list[PruneDecision]:
    candidates = list(scored_sentences)
    token_sets = {id(ss): _word_tokens(ss.text) for ss in candidates}
    entity_sets = {id(ss): _extract_entities(ss.text) for ss in candidates}

    selected: list[ScoredSentence] = []
    sorted_candidates = sorted(candidates, key=lambda ss: ss.score, reverse=True)

    for cand in sorted_candidates:
        is_atomic = "__ATOMIC_BLOCK_" in cand.text or "__ATOMIC_INLINE_" in cand.text
        is_critical = is_critical_instruction(cand.text)

        if len(selected) >= keep_n and not is_atomic and not is_critical:
            continue

        cand_toks = token_sets[id(cand)]
        cand_ents = entity_sets[id(cand)]

        max_redundancy = 0.0
        if selected:
            max_redundancy = max(
                _redundancy(cand_toks, token_sets[id(s)], cand_ents, entity_sets[id(s)])
                for s in selected
            )

        # Protect critical instructions and atomic blocks from being dropped as redundant
        if max_redundancy >= mmr_threshold and len(selected) >= min_keep_per_chunk and not is_atomic and not is_critical:
            continue
        selected.append(cand)

    # Anaphoric referent preservation:
    if preserve_anaphora:
        selected_indices = {ss.index for ss in selected}
        for ss in list(selected):
            if _ANAPHORA_STARTERS.search(ss.text.strip()) and ss.index > 0:
                prev_idx = ss.index - 1
                if prev_idx not in selected_indices:
                    prev_ss = next((s for s in scored_sentences if s.index == prev_idx), None)
                    if prev_ss:
                        selected.append(prev_ss)
                        selected_indices.add(prev_idx)

    keep_ids = set(id(ss) for ss in selected)

    decisions = []
    for ss in scored_sentences:
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
    for ss in scored_sentences:
        kept = id(ss) in keep_ids
        reason = "contiguous_span" if kept else "outside_span"
        decisions.append(PruneDecision(scored_sentence=ss, kept=kept, reason=reason))
    return decisions


def strip_filler_words(text: str) -> str:
    """Strips out conversational fluff, hedges, and redundant adverbs."""
    cleaned = text

    # 1. Strip discourse hedges & structural wordiness
    for pattern, replacement in _HEDGE_PATTERNS:
        cleaned = re.sub(pattern, replacement, cleaned, flags=re.IGNORECASE)

    # 2. Strip single-word fillers
    for filler in FILLER_WORDS:
        pattern = r"\b" + re.escape(filler) + r"\b,?\s*"
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)

    # Clean up whitespace and stray punctuation
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = re.sub(r"\s+([.,!?;:])", r"\1", cleaned)

    if cleaned and cleaned[0].islower():
        cleaned = cleaned[0].upper() + cleaned[1:]

    return cleaned


def reassemble(decisions: list[PruneDecision], strip_filler: bool = True) -> str:
    """
    Joins the kept sentences back into text, preserving original sentence order.
    """
    kept = [d for d in decisions if d.kept]
    kept.sort(key=lambda d: d.scored_sentence.index)
    raw_text = " ".join(d.scored_sentence.text for d in kept)
    if strip_filler:
        return strip_filler_words(raw_text)
    return raw_text
