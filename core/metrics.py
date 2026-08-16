"""
Token counting and timing helpers shared across the pipeline.

Supports model-aware token estimation (GPT-4o, GPT-4, Claude, LLaMA) using
tiktoken when available, with model-specific calibration ratios.
"""

from __future__ import annotations

import time
from contextlib import contextmanager

_ENCODERS: dict[str, str] = {
    "gpt-4o": "o200k_base",
    "gpt-4": "cl100k_base",
    "gpt-3.5": "cl100k_base",
    "claude": "cl100k_base",  # Approximation
    "llama": "cl100k_base",
    "default": "cl100k_base",
}

_encoders_cache: dict[str, Any] = {}


def _get_encoder(encoding_name: str):
    if encoding_name in _encoders_cache:
        return _encoders_cache[encoding_name]
    try:
        import tiktoken  # type: ignore

        enc = tiktoken.get_encoding(encoding_name)
        _encoders_cache[encoding_name] = enc
        return enc
    except Exception:
        _encoders_cache[encoding_name] = None
        return None


def count_tokens(text: str, model: str = "default") -> int:
    """
    Returns the token count for `text` calibrated for `model`.
    Uses tiktoken when available, or model-calibrated word ratios.
    """
    if not text or not text.strip():
        return 0
    encoding_name = _ENCODERS.get(model, _ENCODERS["default"])
    encoder = _get_encoder(encoding_name)
    if encoder is not None:
        try:
            return len(encoder.encode(text))
        except Exception:
            pass

    # Fallback: model-specific word/token ratio
    ratios = {
        "gpt-4o": 1.25,
        "gpt-4": 1.3,
        "gpt-3.5": 1.3,
        "claude": 1.3,
        "llama": 1.35,
        "default": 1.3,
    }
    ratio = ratios.get(model, 1.3)
    words = text.split()
    if not words:
        return 0
    return max(1, round(len(words) * ratio))


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
