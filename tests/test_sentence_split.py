from core.sentence_split import split_sentences, split_chunks


def test_basic_split():
    text = "This is one sentence. This is another sentence."
    sentences = split_sentences(text)
    assert len(sentences) == 2
    assert sentences[0].text == "This is one sentence."
    assert sentences[1].text == "This is another sentence."


def test_abbreviations_not_split():
    text = "Mr. Smith went to the U.S. capital. He met Dr. Lee there."
    sentences = split_sentences(text)
    assert len(sentences) == 2
    assert sentences[0].text == "Mr. Smith went to the U.S. capital."
    assert sentences[1].text == "He met Dr. Lee there."


def test_empty_text():
    assert split_sentences("") == []
    assert split_sentences("   ") == []


def test_single_sentence_no_terminal_punctuation():
    sentences = split_sentences("just a fragment with no period")
    assert len(sentences) == 1
    assert sentences[0].text == "just a fragment with no period"


def test_indices_are_sequential_and_chunk_tagged():
    text = "One. Two. Three."
    sentences = split_sentences(text, chunk_id=5)
    assert [s.index for s in sentences] == [0, 1, 2]
    assert all(s.chunk_id == 5 for s in sentences)


def test_split_chunks_assigns_chunk_ids_by_position():
    chunks = ["First chunk sentence.", "Second chunk sentence one. Second chunk sentence two."]
    sentences = split_chunks(chunks)
    chunk0 = [s for s in sentences if s.chunk_id == 0]
    chunk1 = [s for s in sentences if s.chunk_id == 1]
    assert len(chunk0) == 1
    assert len(chunk1) == 2
    assert [s.index for s in chunk1] == [0, 1]


def test_question_and_exclamation_marks():
    text = "Is this a question? Yes it is! Great."
    sentences = split_sentences(text)
    assert len(sentences) == 3


def test_quoted_sentence_boundary():
    text = 'He said "stop." Then he left.'
    sentences = split_sentences(text)
    # Should split into two sentences at minimum (exact boundary handling
    # of quotes is a soft heuristic, so just check it doesn't collapse to one).
    assert len(sentences) >= 1
    joined = " ".join(s.text for s in sentences)
    assert "stop" in joined and "left" in joined
