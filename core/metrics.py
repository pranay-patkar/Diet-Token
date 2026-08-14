"""
Token counting and timing helpers shared across the pipeline.

Token counting defaults to tiktoken (matches OpenAI/most LLM tokenizers
closely enough for measuring compression ratio) but falls back to a
whitespace-based estimate if tiktoken isn't installed, so core/ doesn't
hard-require it.
"""

from __future__ import annotations

import time
from contextlib import contextmanager

_encoder = None
_encoder_load_attempted = False


def _get_encoder():
    global _encoder, _encoder_load_attempted
    if _encoder_load_attempted:
        return _encoder
    _encoder_load_attempted = True
    try:
        import tiktoken  # type: ignore

        _encoder = tiktoken.get_encoding("cl100k_base")
    except Exception:
        # Covers ImportError (not installed) as well as runtime failures
        # like a blocked/offline network when tiktoken tries to download
        # its encoding file on first use. Either way, fall back to the
        # word-count estimate below rather than crashing the pipeline.
        _encoder = None
    return _encoder


def count_tokens(text: str) -> int:
    """
    Returns the token count for `text`. Uses tiktoken's cl100k_base
    encoding if available; otherwise falls back to a rough estimate of
    ~1.3 tokens per whitespace-separated word, which is close enough for
    relative before/after comparisons even if absolute counts drift from
    the real tokenizer.
    """
    if not text:
        return 0
    encoder = _get_encoder()
    if encoder is not None:
        return len(encoder.encode(text))
    word_count = len(text.split())
    return max(1, round(word_count * 1.3))


@contextmanager
def timer():
    """
    Context manager that measures elapsed wall-clock time in milliseconds.

    Usage:
        with timer() as t:
            do_work()
        print(t.elapsed_ms)
    """
    state = _Timer()
    start = time.perf_counter()
    try:
        yield state
    finally:
        state.elapsed_ms = (time.perf_counter() - start) * 1000.0


class _Timer:
    elapsed_ms: float = 0.0


def compression_summary(original_tokens: int, compressed_tokens: int) -> dict:
    """Small helper for building consistent summary dicts for the API/UI layer."""
    saved = original_tokens - compressed_tokens
    ratio = (saved / original_tokens) if original_tokens else 0.0
    return {
        "original_tokens": original_tokens,
        "compressed_tokens": compressed_tokens,
        "tokens_saved": saved,
        "compression_ratio": round(ratio, 4),
    }
