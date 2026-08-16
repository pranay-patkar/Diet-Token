"""
Shared dataclasses for the PromptTrim compression pipeline.

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


@dataclass
class CompressionProfile:
    """Configuration profile tailored for specific prompt/context modalities."""

    name: str
    keep_fraction: float = 0.5
    protect_blocks: list[str] = field(default_factory=lambda: ["code", "table", "inline-code"])
    instruction_sensitivity: float = 1.0  # multiplier / boost for instruction preservation
    strip_filler: bool = True
    mmr_threshold: float = 0.70
    description: str = ""


PROFILES: dict[str, CompressionProfile] = {
    "chat-prompt": CompressionProfile(
        name="Chat Prompt",
        keep_fraction=0.5,
        protect_blocks=["code", "table", "inline-code"],
        instruction_sensitivity=1.0,
        strip_filler=True,
        mmr_threshold=0.70,
        description="Balanced pruning for conversational prompts",
    ),
    "code-review": CompressionProfile(
        name="Code Review",
        keep_fraction=0.5,
        protect_blocks=["code", "table", "inline-code", "path", "line-number", "hex"],
        instruction_sensitivity=1.3,
        strip_filler=True,
        mmr_threshold=0.80,
        description="Strict protection for code, paths, configs",
    ),
    "legal-compliance": CompressionProfile(
        name="Legal / Compliance",
        keep_fraction=0.7,
        protect_blocks=["code", "table", "date", "amount", "clause-number", "party"],
        instruction_sensitivity=1.5,
        strip_filler=False,
        mmr_threshold=0.85,
        description="Conservative pruning preserving clauses and numbers",
    ),
    "rag-context": CompressionProfile(
        name="RAG Context",
        keep_fraction=0.4,
        protect_blocks=["code", "table"],
        instruction_sensitivity=0.8,
        strip_filler=True,
        mmr_threshold=0.65,
        description="Aggressive redundancy pruning for retrieved chunks",
    ),
}


def get_profile(name: str | CompressionProfile) -> CompressionProfile:
    """Retrieve a compression profile by name, falling back to chat-prompt."""
    if isinstance(name, CompressionProfile):
        return name
    return PROFILES.get(name, PROFILES["chat-prompt"])

