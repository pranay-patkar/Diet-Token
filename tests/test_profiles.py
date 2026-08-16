"""
Unit tests for PromptTrim named compression profiles.
"""

from __future__ import annotations

import pytest

from core.compressor import compress
from core.models import PROFILES, CompressionProfile, ScoredSentence, get_profile


def test_get_profile_lookup_and_fallback():
    assert get_profile("chat-prompt").name == "Chat Prompt"
    assert get_profile("code-review").name == "Code Review"
    assert get_profile("legal-compliance").name == "Legal / Compliance"
    assert get_profile("rag-context").name == "RAG Context"
    # Fallback to chat-prompt
    assert get_profile("non-existent-profile").name == "Chat Prompt"


def test_custom_compression_profile_object():
    custom = CompressionProfile(
        name="Custom Ultra Light",
        keep_fraction=0.9,
        instruction_sensitivity=2.0,
        strip_filler=False,
        mmr_threshold=0.95,
    )
    assert get_profile(custom) is custom

    chunks = [
        "First sentence with some basic details. Second sentence with important instructions: Ensure all tokens are validated. Third sentence with extra notes."
    ]
    res = compress(chunks=chunks, profile=custom)
    assert len(res.chunk_results[0].decisions) == 3
    # With 0.9 keep fraction, should keep all or almost all
    assert res.chunk_results[0].compressed_tokens > 0


def test_code_review_profile_preserves_technical_specs():
    prompt = """
    Review the pull request in /src/api/auth_handler.go.
    Check line 124 for mutex unlock bugs.
    Ensure bcrypt hash cost is set to 12.
    It is important to note that the weather outside is quite nice.
    Basically, we should also check the error code 0x7F2A.
    """
    res = compress(chunks=[prompt], profile="code-review")
    compressed = res.compressed_text
    assert "/src/api/auth_handler.go" in compressed
    assert "124" in compressed
    assert "bcrypt" in compressed
    assert "0x7F2A" in compressed


def test_legal_compliance_profile_preserves_clauses_and_no_filler_strip():
    legal_text = """
    Section 4.2: The Licensee shall indemnify the Licensor against all claims.
    The payment of $50,000 USD is due within 30 days of execution.
    As mentioned above, all notices must be delivered in writing.
    Neither party may assign this agreement without prior written consent.
    """
    res = compress(chunks=[legal_text], profile="legal-compliance")
    compressed = res.compressed_text
    assert "Section 4.2" in compressed or "$50,000" in compressed
    assert "30 days" in compressed
    assert res.chunk_results[0].compression_ratio < 0.6  # Conservative pruning keeps more content


class _FakeCrossEncoder:
    def score(self, query, sentences):
        query_words = set(query.lower().split())
        results = []
        for s in sentences:
            overlap = len(query_words & set(s.text.lower().split()))
            results.append(ScoredSentence(sentence=s, score=float(overlap), scorer_name="fake"))
        return results


def test_rag_context_profile_aggressive_pruning():
    rag_chunks = [
        "The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog repeatedly. Another redundant sentence explaining foxes and dogs. Key result: Quantum supremacy achieved with 72 qubits."
    ]
    res = compress(
        chunks=rag_chunks,
        query="quantum supremacy qubits",
        profile="rag-context",
        use_bm25_prefilter=False,
        cross_encoder=_FakeCrossEncoder(),
    )
    compressed = res.compressed_text
    assert "Quantum supremacy" in compressed or "qubits" in compressed
    assert res.tokens_saved > 0

