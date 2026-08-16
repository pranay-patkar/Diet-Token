from core.models import ScoredSentence, Sentence
from core.pruner import prune_sentences, reassemble


def _scored(*scores, chunk_id=0):
    return [
        ScoredSentence(
            sentence=Sentence(text=f"Sentence {i}.", index=i, chunk_id=chunk_id),
            score=score,
            scorer_name="test",
        )
        for i, score in enumerate(scores)
    ]


def test_cherry_pick_keeps_highest_scores():
    scored = _scored(0.1, 0.9, 0.3, 0.8, 0.2)
    decisions = prune_sentences(scored, keep_fraction=0.4, mode="cherry-pick")
    kept_indices = {d.scored_sentence.index for d in decisions if d.kept}
    # top 40% of 5 = ceil(2) = 2 sentences: indices 1 (0.9) and 3 (0.8)
    assert kept_indices == {1, 3}


def test_never_prunes_below_floor():
    scored = _scored(0.0, 0.0, 0.0)
    decisions = prune_sentences(scored, keep_fraction=0.0, min_keep_per_chunk=1, mode="cherry-pick")
    assert sum(1 for d in decisions if d.kept) >= 1


def test_keep_fraction_one_keeps_everything():
    scored = _scored(0.1, 0.2, 0.3)
    decisions = prune_sentences(scored, keep_fraction=1.0, mode="cherry-pick")
    assert all(d.kept for d in decisions)


def test_empty_input_returns_empty():
    assert prune_sentences([], keep_fraction=0.5) == []


def test_contiguous_mode_keeps_a_single_span():
    # scores designed so the best contiguous 2-window is indices [2,3]
    scored = _scored(0.1, 0.1, 0.9, 0.9, 0.1)
    decisions = prune_sentences(scored, keep_fraction=0.4, mode="contiguous")
    kept_indices = sorted(d.scored_sentence.index for d in decisions if d.kept)
    assert kept_indices == [2, 3]


def test_contiguous_mode_span_is_actually_contiguous():
    scored = _scored(0.9, 0.1, 0.1, 0.1, 0.9)  # best individual scores are NOT adjacent
    decisions = prune_sentences(scored, keep_fraction=0.4, mode="contiguous")
    kept_indices = sorted(d.scored_sentence.index for d in decisions if d.kept)
    # must be a contiguous run, even though cherry-pick would choose {0, 4}
    assert kept_indices == list(range(kept_indices[0], kept_indices[-1] + 1))


def test_reassemble_preserves_original_order():
    scored = _scored(0.9, 0.1, 0.8)  # sentence 0 and 2 kept, in that score order
    decisions = prune_sentences(scored, keep_fraction=0.7, mode="cherry-pick")
    text = reassemble(decisions)
    # "Sentence 0." should appear before "Sentence 2." despite score ordering
    assert text.index("Sentence 0.") < text.index("Sentence 2.")


def test_reassemble_empty_decisions():
    assert reassemble([]) == ""


def test_floor_reason_when_score_is_zero_but_kept():
    scored = _scored(0.0, 0.0)
    decisions = prune_sentences(scored, keep_fraction=0.0, min_keep_per_chunk=1, mode="cherry-pick")
    kept = [d for d in decisions if d.kept]
    assert len(kept) == 1
    assert kept[0].reason == "floor_minimum"


def test_anaphora_preservation():
    # Sentence 1 starts with "It" and has high score; Sentence 0 has lower score
    s0 = ScoredSentence(sentence=Sentence(text="Token-Diet is a context compression engine.", index=0, chunk_id=0), score=0.2, scorer_name="test")
    s1 = ScoredSentence(sentence=Sentence(text="It reduces token latency by over 50%.", index=1, chunk_id=0), score=0.9, scorer_name="test")
    s2 = ScoredSentence(sentence=Sentence(text="Unrelated background filler.", index=2, chunk_id=0), score=0.1, scorer_name="test")

    decisions = prune_sentences([s0, s1, s2], keep_fraction=0.34, min_keep_per_chunk=1, mode="cherry-pick", preserve_anaphora=True)
    kept_indices = {d.scored_sentence.index for d in decisions if d.kept}
    # Anaphora retention should preserve both sentence 1 AND antecedent sentence 0
    assert 1 in kept_indices
    assert 0 in kept_indices
    assert 2 not in kept_indices


def test_strip_filler_words_and_hedges():
    from core.pruner import strip_filler_words
    text = "It is important to note that basically in order to reduce latency [1], we deploy local scoring."
    cleaned = strip_filler_words(text)
    assert "It is important to note that" not in cleaned
    assert "basically" not in cleaned
    assert "in order to" not in cleaned
    assert "[1]" not in cleaned
    assert "to reduce latency, we deploy local scoring." in cleaned.lower()

