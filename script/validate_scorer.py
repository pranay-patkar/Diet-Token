"""
scripts/validate_scorer.py

Validation harness for the two-stage PromptTrim scoring pipeline
(core/scorer.py: BM25PreFilter + CrossEncoderScorer).

Runs 5 hand-picked test cases, each built around *lexical mismatch* —
a sentence that answers the query using different words than the query
itself. For each case, prints:

  1. The cross-encoder's full ranking of all sentences (ground truth,
     BM25 skipped entirely for this pass).
  2. What BM25PreFilter.filter() actually keeps/drops at keep_fraction=0.6.
  3. A flag if BM25 dropped the sentence the cross-encoder ranked #1.

Usage:
    pip install -r requirements.txt
    python scripts/validate_scorer.py

First run downloads the cross-encoder model (~90MB) via sentence-transformers
and caches it locally. No network call happens until CrossEncoderScorer.score()
is actually invoked (see core/scorer.py's lazy _load()).
"""

from __future__ import annotations

import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.models import Sentence
from core.scorer import CrossEncoderScorer
from core.hybrid_filter import HybridPreFilter

KEEP_FRACTION = 0.6
MIN_KEEP = 2  # matches HybridPreFilter's own default

TEST_CASES = [
    {
        "name": "Deadline extended? (lexical mismatch)",
        "query": "Was the deadline extended?",
        "sentences": [
            "The project kickoff happened on March 3rd with all stakeholders present.",
            "Budget allocation was finalized in the second planning meeting.",
            "Due to vendor delays, the delivery date was postponed by two weeks.",
            "The design team completed wireframes ahead of schedule.",
            "All change requests must go through the standard approval workflow.",
        ],
    },
    {
        "name": "Capital of Australia? (mild paraphrase)",
        "query": "What is the capital of Australia?",
        "sentences": [
            "Australia is a country and continent located in the Southern Hemisphere.",
            "Canberra is the capital city, chosen as a compromise between Sydney and Melbourne.",
            "The country's currency is the Australian dollar.",
            "Sydney is the largest city by population.",
        ],
    },
    {
        "name": "Money back in 30 days? (lexical mismatch)",
        "query": "Can I get my money back in 30 days?",
        "sentences": [
            "Our subscription plans renew automatically each billing cycle.",
            "Items may be exchanged for store credit if returned within a month of purchase.",
            "Support is available via chat, email, and phone.",
            "Enterprise plans include a dedicated account manager.",
        ],
    },
    {
        "name": "Water damage covered? (lexical mismatch)",
        "query": "Is water damage covered?",
        "sentences": [
            "This policy covers fire, theft, and structural damage to the property.",
            "Liquid exposure of any kind voids the manufacturer's warranty.",
            "Flood damage from natural disasters requires a separate rider.",
            "Claims must be filed within 60 days of the incident.",
        ],
    },
    {
        "name": "RAM spec (control — should trivially pass)",
        "query": "How much RAM does it have?",
        "sentences": [
            "The laptop ships with 16GB of unified RAM as standard.",
            "Storage options range from 256GB to 2TB SSD.",
            "The display is a 14-inch Liquid Retina panel.",
            "Battery life is rated at up to 18 hours of video playback.",
        ],
    },
]


def make_sentences(texts: list[str], chunk_id: int = 0) -> list[Sentence]:
    return [Sentence(text=t, index=i, chunk_id=chunk_id) for i, t in enumerate(texts)]


def run_case(
    case: dict,
    cross_encoder: CrossEncoderScorer,
    hybrid: HybridPreFilter,
) -> bool:
    """Runs one test case. Returns True if Hybrid kept the cross-encoder's #1 pick."""
    query = case["query"]
    sentences = make_sentences(case["sentences"])

    print(f"\n{'=' * 70}")
    print(f"CASE: {case['name']}")
    print(f"QUERY: {query!r}")
    print(f"{'-' * 70}")

    scored = cross_encoder.score(query, sentences)
    ranked = sorted(scored, key=lambda ss: ss.score, reverse=True)

    print("Cross-encoder ranking (ground truth, no pre-filter):")
    for i, ss in enumerate(ranked, 1):
        marker = "  <-- TOP ANSWER" if i == 1 else ""
        print(f"  {i}. [{ss.score:.3f}] {ss.text}{marker}")

    top_sentence_text = ranked[0].text

    survivors, filtered_out = hybrid.filter(
        query, sentences, keep_fraction=KEEP_FRACTION, min_keep=MIN_KEEP
    )
    hybrid_scores = hybrid.score_hybrid(query, sentences)

    print(f"\nHybridPreFilter (keep_fraction={KEEP_FRACTION}, min_keep={MIN_KEEP}) "
          f"kept {len(survivors)}/{len(sentences)}:")
    for s in sorted(survivors, key=lambda s: hybrid_scores[id(s)], reverse=True):
        print(f"  KEPT    [{hybrid_scores[id(s)]:.3f}] {s.text}")
    for s in sorted(filtered_out, key=lambda s: hybrid_scores[id(s)], reverse=True):
        print(f"  DROPPED [{hybrid_scores[id(s)]:.3f}] {s.text}")

    top_survived = any(s.text == top_sentence_text for s in survivors)

    print()
    if top_survived:
        print("[PASS] - Hybrid pre-filter kept the cross-encoder's top-ranked sentence.")
    else:
        print("[FAIL] - Hybrid pre-filter dropped the cross-encoder's #1 sentence:")
        print(f"   {top_sentence_text!r}")

    return top_survived


def main():
    print("PromptTrim — Scorer Validation (Hybrid Pre-Filter Enabled)")
    print(f"Config: keep_fraction={KEEP_FRACTION}, min_keep={MIN_KEEP}")
    print("Loading cross-encoder...")

    cross_encoder = CrossEncoderScorer()
    hybrid = HybridPreFilter()

    results = []
    for case in TEST_CASES:
        passed = run_case(case, cross_encoder, hybrid)
        results.append((case["name"], passed))

    print(f"\n{'=' * 70}")
    print("SUMMARY")
    print(f"{'=' * 70}")
    passed_count = sum(1 for _, p in results if p)
    for name, passed in results:
        status = "PASS" if passed else "FAIL"
        print(f"  [{status}] {name}")
    print(f"\n{passed_count}/{len(results)} cases passed at keep_fraction={KEEP_FRACTION}.")


if __name__ == "__main__":
    main()

