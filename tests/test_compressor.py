from core.compressor import compress
from core.models import ScoredSentence


class _FakeCrossEncoder:
    """
    Deterministic stand-in for CrossEncoderScorer so tests don't require
    downloading model weights. Scores by keyword overlap with the query.
    """

    def score(self, query, sentences):
        query_words = set(query.lower().split())
        results = []
        for s in sentences:
            overlap = len(query_words & set(s.text.lower().split()))
            results.append(ScoredSentence(sentence=s, score=float(overlap), scorer_name="fake"))
        return results


CANCELLATION_CHUNK = (
    "Our enterprise plan includes a 30-day cancellation window. "
    "You can cancel anytime via the dashboard settings page. "
    "Cancellations after the 30-day window incur a pro-rated fee. "
    "The weather in Seattle is often rainy in the fall. "
    "Refunds are processed within 5-7 business days."
)

UNRELATED_CHUNK = (
    "Our headquarters is in downtown Seattle. "
    "The building has twelve floors and a rooftop garden. "
    "Employees get free coffee every morning."
)


def test_compress_reduces_token_count():
    result = compress(
        query="What is the cancellation policy?",
        chunks=[CANCELLATION_CHUNK],
        keep_fraction=0.4,
        use_bm25_prefilter=False,
        cross_encoder=_FakeCrossEncoder(),
    )
    assert result.compressed_tokens < result.original_tokens
    assert result.tokens_saved > 0
    assert 0 < result.compression_ratio < 1


def test_compress_multiple_chunks_independent():
    result = compress(
        query="cancellation policy",
        chunks=[CANCELLATION_CHUNK, UNRELATED_CHUNK],
        keep_fraction=0.4,
        use_bm25_prefilter=False,
        cross_encoder=_FakeCrossEncoder(),
    )
    assert len(result.chunk_results) == 2
    assert result.chunk_results[0].chunk_id == 0
    assert result.chunk_results[1].chunk_id == 1


def test_compress_empty_chunk_handled_gracefully():
    result = compress(
        query="anything",
        chunks=[""],
        cross_encoder=_FakeCrossEncoder(),
    )
    assert result.chunk_results[0].compressed_text == ""
    assert result.chunk_results[0].original_tokens == 0


def test_compress_never_empties_a_nonempty_chunk():
    result = compress(
        query="totally unrelated nonsense xyzzy",
        chunks=[CANCELLATION_CHUNK],
        keep_fraction=0.0,
        min_keep_per_chunk=1,
        use_bm25_prefilter=False,
        cross_encoder=_FakeCrossEncoder(),
    )
    assert result.chunk_results[0].compressed_text.strip() != ""


def test_compress_records_latency():
    result = compress(
        query="cancellation policy",
        chunks=[CANCELLATION_CHUNK],
        cross_encoder=_FakeCrossEncoder(),
        use_bm25_prefilter=False,
    )
    assert result.latency_ms >= 0


def test_compressed_text_joins_chunks_in_order():
    result = compress(
        query="cancellation policy seattle office",
        chunks=[CANCELLATION_CHUNK, UNRELATED_CHUNK],
        keep_fraction=0.6,
        use_bm25_prefilter=False,
        cross_encoder=_FakeCrossEncoder(),
    )
    text = result.compressed_text
    # whatever survives from chunk 0 should appear before chunk 1's content
    c0_text = result.chunk_results[0].compressed_text
    c1_text = result.chunk_results[1].compressed_text
    if c0_text and c1_text:
        assert text.index(c0_text[:15]) < text.index(c1_text[:15])
