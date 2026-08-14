"""
Orchestrates the full Token-Diet compression pipeline for a single query
against one or more retrieved chunks:

    chunks -> split_sentences -> score_sentences -> prune_sentences -> reassemble

This is the main entry point most callers (the API layer, eval scripts,
notebooks) should use. It's pure Python with no FastAPI/vector-DB/LLM
coupling, so it can be imported and benchmarked standalone.
"""

from __future__ import annotations

from core.metrics import count_tokens, timer
from core.models import ChunkCompressionResult, CompressionResult
from core.pruner import prune_sentences, reassemble
from core.scorer import BM25PreFilter, CrossEncoderScorer, score_sentences
from core.sentence_split import split_sentences


def compress(
    query: str,
    chunks: list[str],
    keep_fraction: float = 0.4,
    min_keep_per_chunk: int = 1,
    prune_mode: str = "cherry-pick",
    use_bm25_prefilter: bool = True,
    prefilter_keep_fraction: float = 0.6,
    cross_encoder: CrossEncoderScorer | None = None,
    bm25_prefilter: BM25PreFilter | None = None,
) -> CompressionResult:
    """
    Compress a list of retrieved chunks against `query`, keeping only the
    sentences relevant enough to survive pruning.

    Args:
        query: the user's query, used to score sentence relevance.
        chunks: raw retrieved chunk texts (e.g. from a vector DB), in
            retrieval order. Each chunk is compressed independently, then
            all compressed chunks are joined in `CompressionResult.compressed_text`.
        keep_fraction: fraction of sentences to keep per chunk after
            scoring (see pruner.prune_sentences).
        min_keep_per_chunk: floor on sentences kept per chunk; never
            prunes a chunk to zero sentences.
        prune_mode: "cherry-pick" (max compression) or "contiguous"
            (better readability, keeps one best-scoring span per chunk).
        use_bm25_prefilter: whether to run the BM25 pre-filter before the
            cross-encoder (recommended — cuts cross-encoder calls on
            obviously irrelevant sentences).
        cross_encoder / bm25_prefilter: inject pre-built scorer instances
            to reuse loaded models across calls (recommended in a server
            context — model loading is the expensive part).

    Returns:
        A CompressionResult with per-chunk detail, aggregate token counts,
        and end-to-end latency.
    """
    with timer() as t:
        chunk_results: list[ChunkCompressionResult] = []

        for chunk_id, chunk_text in enumerate(chunks):
            sentences = split_sentences(chunk_text, chunk_id=chunk_id)
            original_tokens = count_tokens(chunk_text)

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
                keep_fraction=keep_fraction,
                min_keep_per_chunk=min_keep_per_chunk,
                mode=prune_mode,
            )

            compressed_text = reassemble(decisions)
            compressed_tokens = count_tokens(compressed_text)

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
        scorer_name="cross-encoder" if chunks else "none",
    )
