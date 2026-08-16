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

# Matches sentence-ending punctuation or paragraph boundaries followed by capital / digit / quote / atomic placeholder
_SENTENCE_BOUNDARY = re.compile(r'(?<=[.!?])\s+(?=[A-Z0-9"\u201c\u2018(_])|\n\s*\n+')

_WORD_BEFORE_PERIOD = re.compile(r'(\b[A-Za-z]+)\.\s*$')


def _looks_like_abbreviation(preceding_text: str) -> bool:
    match = _WORD_BEFORE_PERIOD.search(preceding_text)
    if not match:
        return False
    return match.group(1).lower() in _ABBREVIATIONS


def _extract_atomic_blocks(text: str) -> tuple[str, dict[str, str]]:
    """
    Extracts markdown code blocks, tables, lists, blockquotes, YAML frontmatter,
    and technical inline code into placeholders so sentence splitting does not
    break structure or code syntax.
    """
    placeholders: dict[str, str] = {}
    counter = 0

    # 1. Fenced code blocks ```...```
    def replace_code_block(match):
        nonlocal counter
        ph = f"__ATOMIC_BLOCK_{counter}__"
        counter += 1
        placeholders[ph] = match.group(0)
        return f"\n\n{ph}.\n\n"

    clean = re.sub(r"```[\s\S]*?```", replace_code_block, text)

    # 2. Markdown tables (| col | col | ... \n | --- | --- | ...)
    def replace_table(match):
        nonlocal counter
        ph = f"__ATOMIC_BLOCK_{counter}__"
        counter += 1
        placeholders[ph] = match.group(0)
        return f"\n\n{ph}.\n\n"

    clean = re.sub(r"(?:^[ \t]*\|.+?\|\s*$\n?){2,}", replace_table, clean, flags=re.MULTILINE)

    # 3. Numbered lists ((?:^|\n)((?:\s*\d+\.\s+[^\n]+\n?){2,}))
    def replace_numbered_list(match):
        nonlocal counter
        ph = f"__ATOMIC_BLOCK_{counter}__"
        counter += 1
        placeholders[ph] = match.group(0).strip()
        return f"\n\n{ph}.\n\n"

    clean = re.sub(r"(?:^|\n)((?:\s*\d+\.\s+[^\n]+\n?){2,})", replace_numbered_list, clean)

    # 4. Bulleted lists ((?:^|\n)((?:\s*[-*]\s+[^\n]+\n?){2,}))
    def replace_bullet_list(match):
        nonlocal counter
        ph = f"__ATOMIC_BLOCK_{counter}__"
        counter += 1
        placeholders[ph] = match.group(0).strip()
        return f"\n\n{ph}.\n\n"

    clean = re.sub(r"(?:^|\n)((?:\s*[-*]\s+[^\n]+\n?){2,})", replace_bullet_list, clean)

    # 5. Blockquotes (> ...)
    def replace_blockquote(match):
        nonlocal counter
        ph = f"__ATOMIC_BLOCK_{counter}__"
        counter += 1
        placeholders[ph] = match.group(0).strip()
        return f"\n\n{ph}.\n\n"

    clean = re.sub(r"(?:^|\n)((?:>[^\n]*\n?){2,})", replace_blockquote, clean)

    # 6. YAML frontmatter (--- ... ---)
    def replace_yaml(match):
        nonlocal counter
        ph = f"__ATOMIC_BLOCK_{counter}__"
        counter += 1
        placeholders[ph] = match.group(0).strip()
        return f"\n\n{ph}.\n\n"

    clean = re.sub(r"(?:^|\n)(---\r?\n[\s\S]*?\r?\n---)", replace_yaml, clean)

    # 7. Inline code (technical content only: paths, configs, symbols, digits)
    def replace_inline_code(match):
        nonlocal counter
        inner = match.group(1)
        if re.search(r"[/.\-_#@:]", inner) or re.search(r"\d{2,}", inner):
            ph = f"__ATOMIC_INLINE_{counter}__"
            counter += 1
            placeholders[ph] = match.group(0)
            return f" {ph} "
        return match.group(0)

    clean = re.sub(r"`([^`\n]{4,})`", replace_inline_code, clean)

    return clean, placeholders


def _restore_atomic_blocks(text: str, placeholders: dict[str, str]) -> str:
    restored = text
    for ph, orig in placeholders.items():
        restored = restored.replace(f"{ph}.", orig)
        restored = restored.replace(ph, orig)
    return restored


def _split_regex(text: str) -> list[str]:
    """Regex-based sentence splitter with abbreviation and atomic block handling."""
    text = text.strip()
    if not text:
        return []

    clean_text, placeholders = _extract_atomic_blocks(text)

    # First pass: naive split on sentence/paragraph boundaries
    raw_pieces = [p.strip() for p in _SENTENCE_BOUNDARY.split(clean_text) if p and p.strip()]

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

    return [_restore_atomic_blocks(s.strip(), placeholders) for s in sentences if s.strip()]


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
