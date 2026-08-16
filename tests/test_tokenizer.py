"""
Unit tests for Token-Diet token estimation and model calibration.
"""

from __future__ import annotations

import pytest

from core.metrics import count_tokens, compression_summary


def test_count_tokens_empty_and_whitespace():
    assert count_tokens("") == 0
    assert count_tokens("   ") == 0


def test_count_tokens_basic_text():
    text = "The quick brown fox jumps over the lazy dog."
    tok_default = count_tokens(text, model="default")
    assert tok_default >= 8


def test_count_tokens_model_calibration():
    text = "Machine learning algorithms optimize mathematical objective functions over massive distributed clusters."
    tok_gpt4o = count_tokens(text, model="gpt-4o")
    tok_llama = count_tokens(text, model="llama")
    assert tok_gpt4o > 0
    assert tok_llama > 0


def test_count_tokens_code_block():
    code = """
    def compute_loss(y_true, y_pred):
        return np.mean(np.square(y_true - y_pred))
    """
    toks = count_tokens(code, model="gpt-4")
    assert toks > 5


def test_compression_summary_helper():
    res = compression_summary(original_tokens=100, compressed_tokens=40)
    assert res["original_tokens"] == 100
    assert res["compressed_tokens"] == 40
    assert res["tokens_saved"] == 60
    assert res["compression_ratio"] == 0.6

    empty_res = compression_summary(original_tokens=0, compressed_tokens=0)
    assert empty_res["compression_ratio"] == 0.0
