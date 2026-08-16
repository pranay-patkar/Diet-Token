"""Instruction detection for fidelity-aware compression."""
from __future__ import annotations
import re
from dataclasses import dataclass
from typing import Any

IMPERATIVE_START = re.compile(
    r"^(do not|don't|replace|use|keep|avoid|remove|add|ensure|fix|check|review|click|clicking|"
    r"store|encrypt|decrypt|prioritize|preserve|maintain|set|configure|install|run|build|"
    r"create|design|implement|refactor|update|change|modify|redesign|restructure|reorganize|"
    r"simplify|streamline|optimize|compress|strip|protect|isolate|mount|dispatch|invoke|call|"
    r"return|throw|catch|handle|process|parse|validate|sanitize|escape|encode|decode|hash|"
    r"sign|verify|authenticate|authorize|redirect|forward|proxy|cache|invalidate|prefetch|"
    r"lazy-load|preload|defer|async|await|yield|break|continue|abort|retry|fallback|escalate|"
    r"notify|alert|log|trace|debug|profile|benchmark|test|deploy|rollback|scale|shard|"
    r"replicate|partition|index|query|fetch|save|load|persist|serialize|deserialize|clone|"
    r"merge|diff|patch|commit|push|pull|rebase|cherry-pick|stash|drop|restore|reset|revert|"
    r"amend|squash)\b",
    re.IGNORECASE,
)

SPEC_PATTERN = re.compile(
    r"^(each|every|all|the (component|row|column|field|section|panel|button|input|"
    r"output|request|response|payload|header|parameter|argument|option|flag|"
    r"setting|config|property|attribute|method|function|class|module|service|"
    r"endpoint|route|handler|controller|model|view|template|schema|migration)|"
    r"palette|colors?|theme|styles?|layout|get|post|put|patch|delete|head|options|"
    r"rate limit|data retention|access logs|gdpr|ccpa|audit trail)\b",
    re.IGNORECASE,
)

CONSTRAINT_RE = re.compile(
    r"(\b\d+(\.\d+)?%|#\b[0-9a-fA-F]{3,8}\b|\b[<>]=?\s?\d+\b|\b>=?\s?\d+\b|\b<=?\s?\d+\b|\b≈\s?\d+\b|\b~\s?\d+\b|"
    r"\b\d+\s?(?:ms|s|sec|min|mins|minutes?|hour|hours?|day|days?|year|years?|us|ns|gb|mb|kb|bytes?|hz|khz|mhz|ghz|"
    r"rpm|fps|tps|qps|rps|ops|req|reqs|conns?|threads?|workers?|px|em|rem|col|cols|columns?|rows?|pages?)\b|"
    r"\b(?:line|port|status|code|http)\s+\d+\b|\b(?:200|201|204|400|401|403|404|500)\b)",
    re.IGNORECASE,
)

MODAL_RE = re.compile(
    r"\b(must|should|shall|required|needs?\s?to|has\s?to|ought\s?to|will|won't|"
    r"cannot|can't|mustn't|shouldn't)\b",
    re.IGNORECASE,
)

TECHNICAL_RE = re.compile(
    r"(/[^\s]+\.(js|py|ts|tsx|jsx|go|rs|java|c|cpp|h|hpp|rb|php|swift|kt|scala|"
    r"json|yaml|yml|toml|ini|cfg|conf|env|md|txt|csv|tsv|xml|html|css|scss|"
    r"less|sql|graphql|proto|dockerfile|makefile|cmake|sh|bash|zsh|fish))\b",
    re.IGNORECASE,
)
TECHNICAL_RE2 = re.compile(
    r"\b(\d+\.\d+\.\d+(?:-[\w.]+)?\b|"
    r"\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b|"
    r"\b(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}\b)"
)

CONDITIONAL_RE = re.compile(
    r"\b(if|when|unless|only\s?if|in\s?case|otherwise|else|then|suppose|"
    r"assuming|provided\s?that|granted\s?that|given\s?that)\b",
    re.IGNORECASE,
)


@dataclass
class InstructionSignals:
    imperative: bool = False
    spec: bool = False
    constraint: bool = False
    modal: bool = False
    technical: bool = False
    conditional: bool = False


def detect_instruction_type(text: str) -> str | None:
    t = text.strip() if text else ""
    if not t:
        return None
    signals = InstructionSignals(
        imperative=bool(IMPERATIVE_START.match(t)),
        spec=bool(SPEC_PATTERN.match(t)),
        constraint=bool(CONSTRAINT_RE.search(t)),
        modal=bool(MODAL_RE.search(t)),
        technical=bool(TECHNICAL_RE.search(t) or TECHNICAL_RE2.search(t)),
        conditional=bool(CONDITIONAL_RE.search(t)),
    )
    hit_count = sum([
        signals.imperative, signals.spec, signals.constraint,
        signals.modal, signals.technical, signals.conditional,
    ])
    if hit_count == 0:
        return None
    if signals.imperative and (signals.constraint or signals.technical or signals.spec):
        return "critical"
    if signals.imperative:
        return "instruction"
    if (signals.spec or signals.modal) and (signals.constraint or signals.technical or signals.modal):
        return "critical"
    if signals.spec or signals.modal:
        return "instruction"
    if signals.constraint or signals.technical:
        return "technical"
    if signals.conditional:
        return "logical"
    return "contextual"


def is_critical_instruction(text: str) -> bool:
    t = detect_instruction_type(text)
    return t in ("critical", "instruction")


def instruction_density(sentences: list[Any]) -> float:
    if not sentences:
        return 0.0
    raw_texts = [s.text if hasattr(s, "text") else str(s) for s in sentences]
    hits = sum(1 for text in raw_texts if is_critical_instruction(text))
    return hits / len(sentences)
