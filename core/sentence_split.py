"""
Splits a retrieved chunk of text into individual sentences.

Two strategies:
  - regex-based (default): zero dependencies, fast, good enough for most
    prose. Handles common abbreviations (Mr., e.g., U.S.) so they don't
    get treated as sentence boundaries.
  - spaCy-based (optional): more accurate on messy or domain-specific text,
    used automatically if spaCy + a model are installed and
    `prefer_spacy=True` is passed.

Both return the same `Sentence` objects so downstream code never needs to
know which splitter ran.
"""

from __future__ import annotations

import re

from core.models import Sentence

# Abbreviations that should NOT be treated as sentence-ending periods.
# Matched case-sensitively against the token immediately before the period.
_ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st",
    "vs", "etc", "e.g", "i.e", "eg", "ie",
    "u.s", "u.k", "u.n", "inc", "ltd", "co", "corp",
    "fig", "no", "vol", "approx", "dept",
}

# Matches sentence-ending punctuation followed by whitespace and a capital
# letter / opening quote / digit — a reasonable boundary heuristic.
_SENTENCE_BOUNDARY = re.compile(r'(?<=[.!?])\s+(?=[A-Z0-9"\u201c\u2018(])')

_WORD_BEFORE_PERIOD = re.compile(r'(\b[A-Za-z]+)\.\s*$')


def _looks_like_abbreviation(preceding_text: str) -> bool:
    match = _WORD_BEFORE_PERIOD.search(preceding_text)
    if not match:
        return False
    return match.group(1).lower() in _ABBREVIATIONS


def _split_regex(text: str) -> list[str]:
    """Regex-based sentence splitter with light abbreviation handling."""
    text = text.strip()
    if not text:
        return []

    # First pass: naive split on the boundary regex.
    raw_pieces = _SENTENCE_BOUNDARY.split(text)

    # Second pass: stitch back together any split that occurred right after
    # a known abbreviation (the naive regex can't see across the split).
    sentences: list[str] = []
    buffer = ""
    for piece in raw_pieces:
        buffer = f"{buffer} {piece}".strip() if buffer else piece
        if _looks_like_abbreviation(buffer):
            continue  # keep accumulating, this wasn't a real boundary
        sentences.append(buffer)
        buffer = ""
    if buffer:
        sentences.append(buffer)

    return [s.strip() for s in sentences if s.strip()]


def _split_spacy(text: str, nlp) -> list[str]:
    doc = nlp(text)
    return [s.text.strip() for s in doc.sents if s.text.strip()]


_spacy_nlp = None  # lazily loaded, module-level cache


def _get_spacy_nlp():
    global _spacy_nlp
    if _spacy_nlp is not None:
        return _spacy_nlp
    try:
        import spacy  # type: ignore

        try:
            _spacy_nlp = spacy.load("en_core_web_sm", exclude=["ner", "lemmatizer"])
        except OSError:
            # Model not downloaded; fall back to a blank pipeline with just
            # the sentencizer, which is dependency-free after spaCy itself.
            _spacy_nlp = spacy.blank("en")
            _spacy_nlp.add_pipe("sentencizer")
    except ImportError:
        _spacy_nlp = False  # sentinel: spaCy not available, don't retry import
    return _spacy_nlp


def split_sentences(
    text: str,
    chunk_id: int = 0,
    prefer_spacy: bool = False,
) -> list[Sentence]:
    """
    Split `text` into Sentence objects, tagged with `chunk_id` and their
    original order (`index`).

    Args:
        text: the raw chunk text to split.
        chunk_id: identifier of the source chunk, stored on each Sentence.
        prefer_spacy: if True, try spaCy first and fall back to regex if
            spaCy or its model isn't installed. Default False keeps this
            function dependency-free by default.
    """
    if not text or not text.strip():
        return []

    pieces: list[str]
    if prefer_spacy:
        nlp = _get_spacy_nlp()
        if nlp:
            pieces = _split_spacy(text, nlp)
        else:
            pieces = _split_regex(text)
    else:
        pieces = _split_regex(text)

    return [
        Sentence(text=piece, index=i, chunk_id=chunk_id)
        for i, piece in enumerate(pieces)
    ]


def split_chunks(
    chunks: list[str],
    prefer_spacy: bool = False,
) -> list[Sentence]:
    """Split multiple chunks at once, assigning chunk_id by list position."""
    all_sentences: list[Sentence] = []
    for chunk_id, chunk_text in enumerate(chunks):
        all_sentences.extend(
            split_sentences(chunk_text, chunk_id=chunk_id, prefer_spacy=prefer_spacy)
        )
    return all_sentences
