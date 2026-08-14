from core.models import ScoredSentence, Sentence
from core.scorer import BM25PreFilter, score_sentences


def _sentences(*texts, chunk_id=0):
    return [Sentence(text=t, index=i, chunk_id=chunk_id) for i, t in enumerate(texts)]


def test_bm25_scores_query_term_overlap_higher():
    sentences = _sentences(
        "The cancellation policy allows refunds within 30 days.",
        "Our office is located in downtown Seattle.",
    )
    bm25 = BM25PreFilter()
    scores = bm25.score("cancellation refund policy", sentences)
    assert scores[id(sentences[0])] > scores[id(sentences[1])]


def test_bm25_filter_respects_min_keep():
    sentences = _sentences("A.", "B.", "C.")
    bm25 = BM25PreFilter()
    survivors, filtered = bm25.filter("irrelevant query xyz", sentences, keep_fraction=0.1, min_keep=2)
    assert len(survivors) == 2
    assert len(filtered) == 1


def test_bm25_filter_keeps_all_when_below_min_keep_size():
    sentences = _sentences("A.", "B.")
    bm25 = BM25PreFilter()
    survivors, filtered = bm25.filter("query", sentences, keep_fraction=0.1, min_keep=3)
    assert len(survivors) == 2
    assert len(filtered) == 0


def test_bm25_empty_query_returns_zero_scores():
    sentences = _sentences("Some sentence here.")
    bm25 = BM25PreFilter()
    scores = bm25.score("", sentences)
    assert scores[id(sentences[0])] == 0.0


class _FakeCrossEncoder:
    """Deterministic stand-in for CrossEncoderScorer, no model download needed."""

    def score(self, query, sentences):
        # Score by literal keyword overlap for a predictable test signal.
        query_words = set(query.lower().split())
        results = []
        for s in sentences:
            overlap = len(query_words & set(s.text.lower().split()))
            results.append(ScoredSentence(sentence=s, score=float(overlap), scorer_name="fake"))
        return results


def test_score_sentences_two_stage_preserves_all_and_restores_order():
    sentences = _sentences(
        "Cancellation requires 30 days notice.",
        "The weather today is sunny.",
        "Refunds take 5 business days.",
        "Our logo uses blue and white.",
    )
    scored = score_sentences(
        "cancellation refund",
        sentences,
        cross_encoder=_FakeCrossEncoder(),
        use_prefilter=False,
    )
    assert len(scored) == len(sentences)
    # order must match input order (index ascending)
    assert [s.index for s in scored] == [0, 1, 2, 3]


def test_score_sentences_prefiltered_out_get_zero_score_not_dropped():
    # Build a case where prefilter with tiny keep_fraction filters most sentences.
    sentences = _sentences(*[f"Filler sentence number {i} about nothing relevant." for i in range(10)])
    scored = score_sentences(
        "cancellation policy",
        sentences,
        cross_encoder=_FakeCrossEncoder(),
        use_prefilter=True,
        prefilter_keep_fraction=0.2,
        prefilter_min_keep=1,
    )
    # every sentence should still have a ScoredSentence entry
    assert len(scored) == len(sentences)
    filtered_out = [s for s in scored if s.scorer_name == "bm25-filtered"]
    assert len(filtered_out) > 0
    assert all(s.score == 0.0 for s in filtered_out)
