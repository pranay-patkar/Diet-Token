"""
Shared dataclasses for the Token-Diet compression pipeline.

Nothing in this file talks to a model, an API, or a database — it's just the
shapes that flow between core/sentence_split.py -> scorer.py -> pruner.py ->
compressor.py. Keeping these separate makes each stage independently testable.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Sentence:
    """A single sentence extracted from a source chunk."""

    text: str
    index: int          # position within the parent chunk (0-based, in original order)
    chunk_id: int        # which source chunk this sentence came from


@dataclass
class ScoredSentence:
    """A sentence plus its relevance score against a query."""

    sentence: Sentence
    score: float          # normalized relevance score, typically 0.0-1.0
    scorer_name: str = "unknown"   # e.g. "cross-encoder", "bm25"

    @property
    def text(self) -> str:
        return self.sentence.text

    @property
    def index(self) -> int:
        return self.sentence.index

    @property
    def chunk_id(self) -> int:
        return self.sentence.chunk_id


@dataclass
class PruneDecision:
    """Whether a scored sentence was kept, and why."""

    scored_sentence: ScoredSentence
    kept: bool
    reason: str = ""   # e.g. "above_threshold", "floor_minimum", "below_threshold"


@dataclass
class ChunkCompressionResult:
    """Result of compressing a single source chunk."""

    chunk_id: int
    original_text: str
    compressed_text: str
    decisions: list[PruneDecision] = field(default_factory=list)
    original_tokens: int = 0
    compressed_tokens: int = 0

    @property
    def tokens_saved(self) -> int:
        return self.original_tokens - self.compressed_tokens

    @property
    def compression_ratio(self) -> float:
        """Fraction of original tokens removed. 0.0 = nothing removed, 1.0 = everything removed."""
        if self.original_tokens == 0:
            return 0.0
        return self.tokens_saved / self.original_tokens


@dataclass
class CompressionResult:
    """Result of compressing an entire retrieved context (all chunks) for one query."""

    query: str
    chunk_results: list[ChunkCompressionResult] = field(default_factory=list)
    latency_ms: float = 0.0
    scorer_name: str = "unknown"

    @property
    def compressed_text(self) -> str:
        """The final context to send to the LLM, chunks joined in original order."""
        return "\n\n".join(
            c.compressed_text for c in self.chunk_results if c.compressed_text.strip()
        )

    @property
    def original_tokens(self) -> int:
        return sum(c.original_tokens for c in self.chunk_results)

    @property
    def compressed_tokens(self) -> int:
        return sum(c.compressed_tokens for c in self.chunk_results)

    @property
    def tokens_saved(self) -> int:
        return self.original_tokens - self.compressed_tokens

    @property
    def compression_ratio(self) -> float:
        if self.original_tokens == 0:
            return 0.0
        return self.tokens_saved / self.original_tokens
