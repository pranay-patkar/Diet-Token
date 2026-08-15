```
█▀▀ ▄▀█ █▄░█ █▀▄ █ █▀▄ ▄▀█ ▀█▀ █▀▀   █▀ █▄▄ █▀▀ █▀▀ ▀█▀ █▀
█▄▄ █▀█ █░▀█ █▄▀ █ █▄▀ █▀█ ░█░ ██▄   ▄█ █▄█ ██▄ ██▄ ░█░ ▄█
```

## ✂️ A two-stage sentence-relevance compressor for RAG context

Take a chunk of retrieved text. Score every sentence against the query — first
cheap (Hybrid BM25 + n-Gram), then precise (cross-encoder). Keep only what answers the
question. Ship less to the model, spend less on tokens.

*No vector DB. No LLM call to compress. Every sentence is scored, in Python,
before it ever reaches the prompt.*

`Pipeline` `Two-Stage` &nbsp; `Pre-filter` `Hybrid (BM25 + 3-gram)` &nbsp; `Scorer` `Cross-Encoder` &nbsp; `Runtime` `CPU-only` &nbsp; `Validation` `5/5 passing` &nbsp; `Tests` `29 passing` &nbsp; `License` `MIT`

---

## What it does

Token-Diet takes a retrieved chunk (say, 40 sentences from a RAG pipeline)
and a user query, and prunes the chunk down to the sentences that actually
answer it — before that chunk gets stuffed into an LLM prompt. Two stages,
each earning its keep:

```
Query + Chunk → Hybrid pre-filter → Cross-Encoder scorer → Kept sentences
```

**Stage 1 (Hybrid BM25 + 3-gram)** is a fast hybrid filter — combining BM25 lexical search with sub-word character n-gram matching to avoid dropping paraphrased answers with zero direct keyword overlap.

**Stage 2 (Cross-Encoder)** is `cross-encoder/ms-marco-MiniLM-L-6-v2` —
understands deep semantic relevance and ranks sentences.

---

## Resolved issue — pre-filter paraphrase drops

`scripts/validate_scorer.py` previously identified a key failure mode in pure BM25: sentences that answer queries using different vocabulary were dropped before reaching Stage 2. With `HybridPreFilter` active, **all 5/5 ground-truth validation cases now pass at `keep_fraction=0.6`**:

| # | Query | Chunk says | Result |
|---|---|---|---|
| 1 | "Was the deadline extended?" | "...delivery date has been postponed." | ✅ KEPT by Hybrid (n-Gram match) |
| 2 | "Capital of Australia?" | "...Canberra is the seat of government." | ✅ KEPT |
| 3 | "Money back after 30 days?" | "...exchanged for store credit within a month." | ✅ KEPT by Hybrid (n-Gram match) |
| 4 | "Water damage covered?" | "...liquid exposure voids warranty." | ✅ KEPT |
| 5 | RAM spec (control) | "...16GB of unified RAM." | ✅ KEPT |

---

## The scoring pipeline

Every call to `score_sentences()` runs the same two stages, whether it's
five sentences or five hundred:

| Stage | What happens |
|---|---|
| **1. Split** | Chunk arrives as a list of sentences (already split upstream) |
| **2. Pre-filter** | `BM25PreFilter(keep_fraction, min_keep)` scores lexical overlap, drops the bottom fraction — skippable via `prefilter=None` |
| **3. Score** | Surviving sentences go through `CrossEncoderScorer` (lazy-loaded on first `.score()` call — importing the module never triggers a network call) |
| **4. Return** | Ranked, scored sentences — caller decides the final cutoff |

`FakeKeywordOverlapScorer` mirrors the real scorer's interface exactly, so
all 37 existing tests run offline and fast without touching the network.

---

## Project layout

```
token-diet/
├── README.md
├── requirements.txt
├── .env.example
├── .gitignore
│
├── core/
│   ├── __init__.py
│   └── scorer.py            CrossEncoderScorer · BM25PreFilter · score_sentences()
│
├── scripts/
│   └── validate_scorer.py   5 test cases — ground truth vs. pre-filter behavior
│
└── tests/
    ├── __init__.py
    └── test_scorer.py       37 tests, offline-safe via FakeKeywordOverlapScorer
```

---

## Running it

```bash
pip install -r requirements.txt
python scripts/validate_scorer.py
```

First run downloads the cross-encoder (~90MB) and caches it locally. Output
is a pass/fail per case plus a keep_fraction recommendation based on what
BM25 actually kept vs. what the cross-encoder ranked first.

```bash
pytest tests/
```

Runs offline — no model download required.

---

## What's intentionally not here

- **Retrieval** (FAISS/Pinecone) — Token-Diet takes chunks directly; the
  compression step is the demo surface, not the retrieval step.
- **Full eval benchmark** — the 5 cases in `validate_scorer.py` are curated
  evidence of the specific failure mode, not a rigorous held-out eval suite.
- **LLM rewrite / prune-and-summarize stage** — sentence-level keep/drop
  only, for now. Compressing further via generation is future work.

---

<div align="right">

`MIT` · built for a hackathon deadline, not a paper

</div>
