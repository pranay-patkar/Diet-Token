```
█▀▀ ▄▀█ █▄░█ █▀▄ █ █▀▄ ▄▀█ ▀█▀ █▀▀   █▀ █▄▄ █▀▀ █▀▀ ▀█▀ █▀
█▄▄ █▀█ █░▀█ █▄▀ █ █▄▀ █▀█ ░█░ ██▄   ▄█ █▄█ ██▄ ██▄ ░█░ ▄█
```

## ✂️ A two-stage sentence-relevance compressor for RAG context

Take a chunk of retrieved text. Score every sentence against the query — first
cheap (BM25), then precise (cross-encoder). Keep only what answers the
question. Ship less to the model, spend less on tokens.

*No vector DB. No LLM call to compress. Every sentence is scored, in Python,
before it ever reaches the prompt.*

`Pipeline` `Two-Stage` &nbsp; `Pre-filter` `BM25` &nbsp; `Scorer` `Cross-Encoder` &nbsp; `Runtime` `CPU-only` &nbsp; `Tests` `37 passing` &nbsp; `License` `MIT`

---

## What it does

Token-Diet takes a retrieved chunk (say, 40 sentences from a RAG pipeline)
and a user query, and prunes the chunk down to the sentences that actually
answer it — before that chunk gets stuffed into an LLM prompt. Two stages,
each earning its keep:

```
Query + Chunk → BM25 pre-filter → Cross-Encoder scorer → Kept sentences
```

**Stage 1 (BM25)** is a cheap lexical filter — fast, no model load, cuts
obviously irrelevant sentences before the expensive stage runs.

**Stage 2 (Cross-Encoder)** is `cross-encoder/ms-marco-MiniLM-L-6-v2` —
slower, but it actually understands semantic relevance, not just word
overlap.

No sentence gets to stage 2 without surviving stage 1 — which is exactly
the trade-off under test right now (see **Known issue**, below).

---

## Why the two-stage split isn't just an optimization

Most compression demos just run everything through one model and call it a
day. Token-Diet treats the *pre-filter* as a real architectural decision,
not a free speed-up:

- BM25 is **lexical**, not semantic — it scores sentences by token overlap
  with the query. Cheap, but blind to paraphrase.
- The cross-encoder is **semantic** — it understands that "delivery date
  postponed" answers "was the deadline extended?" even with zero shared
  words. But it's ~50-100× slower per sentence.
- Running the cross-encoder on every sentence in a large chunk isn't free.
  The pre-filter exists to cut the field down before the expensive model
  runs — but only if it doesn't cut the *right* sentence first.
- `keep_fraction` is the dial that trades recall for speed: how much of the
  chunk survives BM25 before the cross-encoder even sees it.

```
              ┌─────────────┐        ┌──────────────────┐
 Query + ───▶ │ BM25 filter │ ─────▶ │  Cross-Encoder    │ ───▶ Kept sentences
 Chunk        │ keep_frac   │  336   │  ms-marco-MiniLM  │ 218
 (560 sent)   └─────────────┘        └──────────────────┘
                    │                         │
                    ▼                         ▼
              lexical cut                semantic score
              (cheap, blind             (precise, slow)
               to paraphrase)
```

---

## Known issue — pre-filter drops paraphrased answers

`scripts/validate_scorer.py` is built around exactly this failure mode: a
sentence that answers the query using **different words** than the query
itself.

| # | Query | Chunk says | Result |
|---|---|---|---|
| 1 | "Was the deadline extended?" | "...delivery date has been postponed." | ❌ dropped by BM25 |
| 2 | "Capital of Australia?" | "...Canberra is the seat of government." | ✅ kept |
| 3 | "Money back after 30 days?" | "...exchanged for store credit within a month." | ❌ dropped by BM25 |
| 4 | "Water damage covered?" | "...liquid exposure voids warranty." | ✅ kept |
| 5 | RAM spec (control) | "...16GB of unified RAM." | ✅ kept (sanity check) |

At the current default (`keep_fraction=0.6`), BM25 drops the correct answer
in cases 1 and 3 — **zero token overlap** between query and answer sentence
is enough to lose it before the cross-encoder ever runs. The bug is in
stage 1, and it doesn't need the model loaded to reproduce.

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
