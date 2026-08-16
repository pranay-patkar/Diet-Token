"""Tests that instruction-dense prompts survive compression with full fidelity."""
from __future__ import annotations

import re
import pytest
from core.compressor import compress
from core.instruction_detector import is_critical_instruction

INSTRUCTION_PROMPTS = [
    # UI spec (the original case)
    """Redesign the Active Microservice Cooldown Matrix. Replace the 3-column card grid with a dense incident table. Each row: service name, HTTP code, error message, pattern-match score, occurrence count, remaining cooldown. Use thin 1px borders, 4-6px radius, no shadows. Remove orange progress bars, replace with thin cooldown timeline. Palette: #07100D bg, #84CC16 lime, #F97316 orange, #EF4444 red. Clicking a row expands inline detail with pattern-match, occurrence count, first/last seen, suppression reason, INSPECT TRACE action. Use monospace for technical values.""",

    # Code review instructions
    """Review the authentication middleware in /src/auth/jwt.go. Check token expiration handling at line 45. Ensure refresh tokens are invalidated after 7 days. Add rate limiting: 100 requests per minute per IP. Log failed auth attempts to /var/log/auth.log. Return 401 for expired tokens, 403 for invalid signatures. Do not leak stack traces in error responses.""",

    # API design spec
    """Design REST endpoints for /api/v2/users. GET /users returns paginated list (50 per page). POST /users creates user, returns 201 with Location header. PATCH /users/:id updates fields, returns 200. DELETE /users/:id soft-deletes, returns 204. All endpoints require Bearer token auth. Rate limit: 1000 req/hour per token. Use ETags for caching. Return JSON: {"data": [...], "meta": {"page": 1, "total": 100}}.""",

    # Legal/compliance text
    """Data retention: Store user PII for 90 days after account deletion. Encrypt at rest using AES-256. Access logs retained for 2 years. GDPR requests processed within 30 days. CCPA opt-out link required on homepage. Do not share data with third parties without explicit consent. Audit trail must include timestamp, user ID, action, and IP address.""",
]


@pytest.mark.parametrize("prompt", INSTRUCTION_PROMPTS)
def test_critical_instructions_preserved(prompt):
    """Every critical instruction in the original must appear in the compressed output."""
    result = compress(query="", chunks=[prompt], keep_fraction=0.4)
    compressed = result.compressed_text.lower()

    # Extract all imperative / spec sentences from original
    original_sentences = re.split(r"(?<=[.!?])\s+", prompt)
    critical_original = [s for s in original_sentences if is_critical_instruction(s)]

    # Check each critical sentence's key terms appear in compressed
    for sentence in critical_original:
        words = [w.lower().strip(".,;:()[]{}'\"") for w in sentence.split() if len(w) > 3]
        survived = sum(1 for w in words if w in compressed)
        ratio = survived / max(1, len(words))
        assert ratio >= 0.6, f"Critical instruction lost: '{sentence[:60]}...' (word survival: {ratio:.0%})"


def test_ui_spec_field_list_preserved():
    """The UI spec's field list must survive compression intact."""
    prompt = """Each row should prioritize: service name, HTTP/error code, concise error message, pattern-match score, muted occurrence count, and remaining cooldown."""
    result = compress(query="", chunks=[prompt], keep_fraction=0.4)
    fields = ["service name", "HTTP", "error code", "error message", "pattern-match score", "occurrence count", "remaining cooldown"]
    for f in fields:
        assert f.lower() in result.compressed_text.lower(), f"Field '{f}' was dropped"


def test_hex_codes_preserved():
    """Hex color codes must survive compression."""
    prompt = """Keep the palette: #07100D background, #84CC16 lime, #F97316 orange, #EF4444 red."""
    result = compress(query="", chunks=[prompt], keep_fraction=0.4)
    for code in ["#07100D", "#84CC16", "#F97316", "#EF4444"]:
        assert code.lower() in result.compressed_text.lower(), f"Hex code {code} was dropped"


def test_file_paths_preserved():
    """File paths must survive compression."""
    prompt = """Check the auth middleware in /src/auth/jwt.go and update /src/middleware/rate_limit.py. Logs go to /var/log/auth.log."""
    result = compress(query="", chunks=[prompt], keep_fraction=0.4)
    for path in ["/src/auth/jwt.go", "/src/middleware/rate_limit.py", "/var/log/auth.log"]:
        assert path in result.compressed_text, f"Path {path} was dropped"
