"""
scripts/validate_scorer.py

Validation harness for the two-stage Token-Diet scoring pipeline
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

from core.models import Sentence
from core.scorer import BM25PreFilter, CrossEncoderScorer

KEEP_FRACTION = 0.6
MIN_KEEP = 2  # matches BM25PreFilter's own default

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
    bm25: BM25PreFilter,
) -> bool:
    """Runs one test case. Returns True if BM25 kept the cross-encoder's #1 pick."""
    query = case["query"]
    sentences = make_sentences(case["sentences"])

    print(f"\n{'=' * 70}")
    print(f"CASE: {case['name']}")
    print(f"QUERY: {query!r}")
    print(f"{'-' * 70}")

    # Ground truth: score every sentence with the cross-encoder directly,
    # BM25 not involved at all.
    scored = cross_encoder.score(query, sentences)
    ranked = sorted(scored, key=lambda ss: ss.score, reverse=True)

    print("Cross-encoder ranking (ground truth, no pre-filter):")
    for i, ss in enumerate(ranked, 1):
        marker = "  <-- TOP ANSWER" if i == 1 else ""
        print(f"  {i}. [{ss.score:.3f}] {ss.text}{marker}")

    top_sentence_text = ranked[0].text

    # What BM25PreFilter.filter() actually keeps at KEEP_FRACTION.
    survivors, filtered_out = bm25.filter(
        query, sentences, keep_fraction=KEEP_FRACTION, min_keep=MIN_KEEP
    )
    bm25_scores = bm25.score(query, sentences)

    print(f"\nBM25PreFilter (keep_fraction={KEEP_FRACTION}, min_keep={MIN_KEEP}) "
          f"kept {len(survivors)}/{len(sentences)}:")
    for s in sorted(survivors, key=lambda s: bm25_scores[id(s)], reverse=True):
        print(f"  KEPT    [{bm25_scores[id(s)]:.3f}] {s.text}")
    for s in sorted(filtered_out, key=lambda s: bm25_scores[id(s)], reverse=True):
        print(f"  DROPPED [{bm25_scores[id(s)]:.3f}] {s.text}")

    top_survived = any(s.text == top_sentence_text for s in survivors)

    print()
    if top_survived:
        print("✅ PASS — BM25 kept the cross-encoder's top-ranked sentence.")
    else:
        print("❌ FAIL — BM25 dropped the cross-encoder's #1 sentence:")
        print(f"   {top_sentence_text!r}")

    return top_survived


def main():
    print("Token-Diet — Scorer Validation")
    print(f"Config: keep_fraction={KEEP_FRACTION}, min_keep={MIN_KEEP}")
    print("Loading cross-encoder (first .score() call downloads the model if not cached)...")

    cross_encoder = CrossEncoderScorer()
    bm25 = BM25PreFilter()

    results = []
    for case in TEST_CASES:
        passed = run_case(case, cross_encoder, bm25)
        results.append((case["name"], passed))

    print(f"\n{'=' * 70}")
    print("SUMMARY")
    print(f"{'=' * 70}")
    passed_count = sum(1 for _, p in results if p)
    for name, passed in results:
        status = "PASS" if passed else "FAIL"
        print(f"  [{status}] {name}")
    print(f"\n{passed_count}/{len(results)} cases passed at keep_fraction={KEEP_FRACTION}.")

    if passed_count < len(results):
        print("\nRecommendation:")
        print("  - Raise keep_fraction (e.g. 0.75-0.8) to reduce false drops, or")
        print("  - Skip the pre-filter for small chunks (<~8 sentences) and let the")
        print("    cross-encoder score everything directly via:")
        print("    score_sentences(query, sentences, use_prefilter=False)")


if __name__ == "__main__":
    main()
