"""
Orchestrates the full Token-Diet compression pipeline for a single query
against one or more retrieved chunks:

    chunks -> split_sentences -> score_sentences -> prune_sentences -> reassemble

Supports universal fidelity compression:
- Adaptive keep fraction based on instruction density
- Auto-query extraction for query-less prompts
- Model-aware token estimation
"""

from __future__ import annotations

from core.instruction_detector import instruction_density
from core.metrics import count_tokens, timer
from core.models import ChunkCompressionResult, CompressionProfile, CompressionResult, get_profile
from core.pruner import prune_sentences, reassemble
from core.scorer import BM25PreFilter, CrossEncoderScorer, extract_auto_query, score_sentences
from core.sentence_split import split_sentences


def compress(
    query: str = "",
    chunks: list[str] | None = None,
    keep_fraction: float | None = None,
    min_keep_per_chunk: int = 1,
    prune_mode: str = "cherry-pick",
    use_bm25_prefilter: bool = True,
    prefilter_keep_fraction: float = 0.6,
    cross_encoder: CrossEncoderScorer | None = None,
    bm25_prefilter: BM25PreFilter | None = None,
    model: str = "default",
    profile: str | CompressionProfile = "chat-prompt",
    strip_filler: bool | None = None,
) -> CompressionResult:
    """
    Compress a list of retrieved chunks against `query`, keeping only the
    sentences relevant enough to survive pruning.

    Args:
        query: the user's query (or empty for query-less prompt compression).
        chunks: raw chunk texts in retrieval order.
        keep_fraction: baseline fraction of sentences to keep per chunk (default from profile).
        min_keep_per_chunk: floor on sentences kept per chunk (default 1).
        prune_mode: "cherry-pick" or "contiguous".
        use_bm25_prefilter: whether to run the BM25/Hybrid pre-filter.
        cross_encoder / bm25_prefilter: injected scorer instances.
        model: target model identifier for token counting calibration.
        profile: named compression profile ("chat-prompt", "code-review", "legal-compliance", "rag-context").
        strip_filler: whether to strip conversational filler (default from profile).
    """
    if chunks is None:
        chunks = []

    prof = get_profile(profile)
    base_keep = keep_fraction if keep_fraction is not None else prof.keep_fraction
    effective_strip_filler = strip_filler if strip_filler is not None else prof.strip_filler

    with timer() as t:
        chunk_results: list[ChunkCompressionResult] = []

        for chunk_id, chunk_text in enumerate(chunks):
            sentences = split_sentences(chunk_text, chunk_id=chunk_id)
            original_tokens = count_tokens(chunk_text, model=model)

            if not sentences:
                chunk_results.append(
                    ChunkCompressionResult(
                        chunk_id=chunk_id,
                        original_text=chunk_text,
                        compressed_text="",
                        original_tokens=original_tokens,
                        compressed_tokens=0,
                    )
                )
                continue

            # Compute instruction density & adaptive keep fraction scaled by profile sensitivity
            density = instruction_density(sentences) * prof.instruction_sensitivity
            adaptive_keep = base_keep
            if density > 0.4:
                adaptive_keep = max(0.6, base_keep)
            elif density > 0.2:
                adaptive_keep = max(0.5, base_keep)

            scored = score_sentences(
                query,
                sentences,
                cross_encoder=cross_encoder,
                bm25_prefilter=bm25_prefilter,
                prefilter_keep_fraction=prefilter_keep_fraction,
                use_prefilter=use_bm25_prefilter,
            )

            decisions = prune_sentences(
                scored,
                keep_fraction=adaptive_keep,
                min_keep_per_chunk=min_keep_per_chunk,
                mode=prune_mode,
                mmr_threshold=prof.mmr_threshold,
            )

            compressed_text = reassemble(decisions, strip_filler=effective_strip_filler)
            compressed_tokens = count_tokens(compressed_text, model=model)

            chunk_results.append(
                ChunkCompressionResult(
                    chunk_id=chunk_id,
                    original_text=chunk_text,
                    compressed_text=compressed_text,
                    decisions=decisions,
                    original_tokens=original_tokens,
                    compressed_tokens=compressed_tokens,
                )
            )

    return CompressionResult(
        query=query,
        chunk_results=chunk_results,
        latency_ms=t.elapsed_ms,
        scorer_name="cross-encoder" if query.strip() and chunks else ("balanced-density" if chunks else "none"),
    )

