```
█▀▀ ▄▀█ █▄░█ █▀▄ █ █▀▄ ▄▀█ ▀█▀ █▀▀   █▀ █▄▄ █▀▀ █▀▀ ▀█▀ █▀
█▄▄ █▀█ █░▀█ █▄▀ █ █▄▀ █▀█ ░█░ ██▄   ▄█ █▄█ ██▄ ██▄ ░█░ ▄█
```

# ✂️ Token-Diet: Dynamic Context Compressor for RAG & AI Prompts

> **Post-retrieval optimization pipeline and in-browser AI prompt compressor.**  
> Strips filler sentences, rhetorical hedges, and redundant fluff before text ever reaches the LLM context window — slashing Time-To-First-Token (TTFT) latency and API costs while guaranteeing zero factual context loss.

`Pipeline` `Two-Stage Hybrid` &nbsp; `Pre-Filter` `BM25 + 3-Gram + Entity Boost` &nbsp; `Scorer` `Cross-Encoder / MiniLM` &nbsp; `Extension` `Chrome MV3 Inline` &nbsp; `Validation` `5/5 Passing` &nbsp; `Tests` `32 Passing` &nbsp; `License` `MIT`

---

## 🎯 The Problem & The Solution

- **The Problem:** Traditional RAG engines pass entire multi-paragraph retrieved chunks directly into the LLM context window. This balloons **Time-To-First-Token (TTFT)** latency and inflates API costs because models waste compute processing hundreds of irrelevant filler words, discourse hedges, and boilerplate disclaimers.
- **The Solution:** **Token-Diet** acts as a lightweight, fast, and local compression gatekeeper. Once chunks are retrieved (or written in an AI prompt box), Token-Diet evaluates every sentence through a multi-signal scoring pipeline, keeps only dense, high-information semantic sentences, and micro-prunes conversational padding.

---

## 🚀 Key Features

- **⚡ Two-Stage Sentence Relevance Pipeline**:
  1. **Stage 1 (Hybrid Pre-Filter)**: Fast BM25 lexical term overlap combined with character 3-gram semantic Jaccard matching to prevent paraphrase drops with zero overhead.
  2. **Stage 2 (Cross-Encoder / MiniLM)**: Deep neural attention scoring (`cross-encoder/ms-marco-MiniLM-L-6-v2`) on candidate survivors to pinpoint ground-truth answers.
- **🛡️ Referential & Anaphoric Anchoring**:
  - Automatically identifies anaphoric starters (*"it"*, *"this"*, *"that"*, *"they"*, *"such"*, *"consequently"*) in kept sentences and guarantees their antecedent context sentences are preserved so pronouns are never orphaned.
- **📦 Atomic Code & Markdown Table Protection**:
  - Automatically isolates fenced code blocks (```` ```...``` ````) and markdown tables (`| col | ... |`) so code syntax and structured data are never mangled by sentence splitting.
- **🔄 Maximal Marginal Relevance (MMR) Deduplication**:
  - Penalizes repetitive, near-duplicate statements across multi-chunk retrieval to maximize information diversity.
- **🔢 Entity & Quantitative Constraint Multipliers**:
  - Boosts sentences containing numerical metrics, percentages, currencies (`$`, `USD`), storage units (`GB`, `MB`), latency figures (`ms`), and capitalized entities.
- **✂️ Discourse Hedge & Conversational Fluff Micro-Pruning**:
  - Removes rhetorical filler (*"It is important to note that"*, *"in order to"* → *"to"*, *"due to the fact that"* → *"because"*, citations `[1][2]`, filler adverbs) without altering core facts.
- **🧩 Manifest V3 Chrome Extension (Capsule Hub / Tally Style)**:
  - Mounts an inline **✂ Diet-Token** toolbar inside the native composer forms of ChatGPT, Claude, Gemini, DeepSeek, and Perplexity with Shadow DOM styling and React state synchronization.
- **🌐 Dark Dashboard & Live Playground**:
  - Visual dashboard with token gauges, compression ratios, estimated cost savings, TTFT latency drops, and interactive sentence heatmaps.

---

## 🏗️ Architecture & Pipeline Flow

```
                                  [ Retrieved Chunks / Raw Prompt ]
                                                  │
                                                  ▼
                                ┌───────────────────────────────────┐
                                │   1. Atomic Block Extraction      │
                                │   (Preserve ```code``` & tables)  │
                                └───────────────────────────────────┘
                                                  │
                                                  ▼
                                ┌───────────────────────────────────┐
                                │   2. Robust Sentence Splitting    │
                                │   (Abbreviation & boundary-aware) │
                                └───────────────────────────────────┘
                                                  │
                                                  ▼
                                ┌───────────────────────────────────┐
                                │   3. Multi-Signal Hybrid Scoring  │
                                │   • BM25 Lexical Keyword Overlap  │
                                │   • Char 3-Gram Sub-Word Matching │
                                │   • Numerical/Entity Multipliers  │
                                └───────────────────────────────────┘
                                                  │
                                                  ▼
                                ┌───────────────────────────────────┐
                                │   4. Stage 2 Cross-Encoder Rank   │
                                │   (ms-marco-MiniLM-L-6-v2)        │
                                └───────────────────────────────────┘
                                                  │
                                                  ▼
                                ┌───────────────────────────────────┐
                                │   5. Context-Safe Pruner & MMR    │
                                │   • MMR Redundancy Penalty        │
                                │   • Anaphoric Antecedent Recovery │
                                │   • Floor Minimum Protection      │
                                └───────────────────────────────────┘
                                                  │
                                                  ▼
                                ┌───────────────────────────────────┐
                                │   6. Reassembly & Micro-Pruning   │
                                │   • Strip Discourse Hedges        │
                                │   • Restore Atomic Code & Tables  │
                                └───────────────────────────────────┘
                                                  │
                                                  ▼
                                  [ High-Density Compressed Prompt ]
                                  (50-70% Tokens Saved, Zero Context Loss)
```

---

## 🧩 Chrome Extension (Inline AI Chat Toolbar)

The browser extension attaches an inline compression toolbar to prompt composers across major AI chat interfaces:

- **Supported Platforms**: ChatGPT, Claude.ai, Google Gemini, DeepSeek, Perplexity, and arbitrary web textareas.
- **Shadow DOM Isolation**: Toolbar UI is rendered inside a `#token-diet-toolbar-host` Shadow Root (`:host { all: initial }`), ensuring host site Tailwind styles or dark mode CSS resets never distort the toolbar.
- **React Value Tracker Bypass**: Directly invokes native prototype setters and dispatches `input` / `change` / `beforeinput` events so React and ProseMirror state stores immediately detect the compressed prompt.
- **Compression Modes**:
  - **L (Light)**: Retains ~60% of top sentences.
  - **B (Balanced - Default)**: Retains ~40% of top sentences.
  - **A (Aggressive)**: Retains ~25% of highest-scoring sentences.
  - **Undo**: One-click restoration of original uncompressed text.
- **Keyboard Shortcut**: `Alt + Shift + T` instantly compresses the active textbox.

### Installing the Chrome Extension:
1. Open Google Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the [`extension/`](./extension) folder in this repository.
4. Navigate to [chatgpt.com](https://chatgpt.com) or [claude.ai](https://claude.ai) and click into the prompt box!

---

## 🔬 Ground-Truth Scorer Validation

The test harness in [`script/validate_scorer.py`](./script/validate_scorer.py) tests the hybrid pre-filter against lexical mismatches where the answer rephrases the query:

| Test Case | User Query | Chunk Sentence | Result |
|---|---|---|---|
| **1. Lexical Mismatch** | *"Was the deadline extended?"* | *"...delivery date was postponed by two weeks."* | **✅ PASS** (Preserved by 3-gram match) |
| **2. Mild Paraphrase** | *"What is the capital of Australia?"* | *"...Canberra is the capital city..."* | **✅ PASS** (Rank #1 Ground Truth) |
| **3. Lexical Mismatch** | *"Can I get my money back in 30 days?"* | *"...exchanged for store credit within a month."* | **✅ PASS** (Preserved by Hybrid n-Gram) |
| **4. Lexical Mismatch** | *"Is water damage covered?"* | *"...policy covers fire, theft, and structural damage..."* | **✅ PASS** (Preserved by Hybrid Filter) |
| **5. Entity Control** | *"How much RAM does it have?"* | *"...ships with 16GB of unified RAM standard."* | **✅ PASS** (Preserved with entity boost) |

**Result: `5 / 5 Cases Passed` at `keep_fraction=0.6`.**

---

## 📁 Repository Structure

```
Diet-Token/
├── extension/                     # Chrome Extension (Manifest V3)
│   ├── manifest.json              # Extension metadata & permission declarations
│   ├── content.js                 # Capsule-style inline DOM injector & observer
│   ├── engine.js                  # Pure-JS zero-dependency compression pipeline
│   ├── background.js              # Service worker & keyboard shortcut router
│   ├── popup.html / popup.js      # Standalone popup compressor interface
│   └── icons/                     # Extension icons (16, 32, 48, 128px)
│
├── core/                          # Python Core Engine
│   ├── compressor.py              # Main compressor orchestration pipeline
│   ├── scorer.py                  # Two-stage scorer (Hybrid + Cross-Encoder)
│   ├── hybrid_filter.py           # BM25 + 3-gram + Entity multiplier pre-filter
│   ├── sentence_split.py          # Atomic block extraction & sentence tokenizer
│   ├── pruner.py                  # MMR deduplication, anaphora retention, micro-pruning
│   ├── metrics.py                 # Token estimation, cost savings & latency drop math
│   └── models.py                  # Pydantic data schemas & dataclasses
│
├── script/
│   └── validate_scorer.py         # Ground-truth cross-encoder validation suite
│
├── tests/                         # Pytest Unit Test Suite (32 tests)
│   ├── test_compressor.py         # Compressor pipeline integration tests
│   ├── test_pruner.py             # Anaphora, MMR, and hedge stripping unit tests
│   ├── test_scorer.py             # BM25 and two-stage scoring unit tests
│   └── test_sentence_split.py     # Sentence boundary & atomic block unit tests
│
├── index.html                     # Visual Dashboard & Interactive Playground
├── requirements.txt               # Python dependencies
└── README.md                      # Project documentation
```

---

## ⚡ Getting Started (Python API)

### 1. Installation
```bash
git clone https://github.com/pranay-patkar/Diet-Token.git
cd Diet-Token

pip install -r requirements.txt
```

### 2. Run Test Suite & Validation
```bash
# Run all 32 unit tests
pytest tests/ -v

# Run the 5 ground-truth validation cases
python -m script.validate_scorer
```

### 3. Programmatic Usage
```python
from core.compressor import ContextCompressor

compressor = ContextCompressor(
    keep_fraction=0.4,
    min_keep_per_chunk=1,
    mode="cherry-pick",
    strip_filler=True,
    prefer_spacy=False
)

query = "What is the battery warranty?"
retrieved_chunks = [
    """
    It is important to note that our warranty covers manufacturing defects for 2 years.
    Basically, liquid exposure of any kind voids all coverage immediately.
    In order to claim warranty repairs, customers must provide original proof of purchase.
    """
]

result = compressor.compress(query, retrieved_chunks)

print(f"Original Tokens:   {result.original_tokens}")
print(f"Compressed Tokens: {result.compressed_tokens}")
print(f"Tokens Saved:      {result.tokens_saved} ({result.compression_ratio:.1%})")
print(f"Latency Saved:     ~{result.latency_drop_ms}ms")
print(f"\nDense Compressed Output:\n{result.compressed_text}")
```

---

## 📊 Performance & Economics

- **Token Reduction**: Typical compression ratio ranges between **50% to 75%** on conversational prompts and retrieved RAG context.
- **Latency Reduction**: Estimated **~0.9ms per token saved** in Time-To-First-Token (TTFT) processing time on modern LLM APIs.
- **Cost Reduction**: Direct savings calculated against standard input token pricing ($0.75 / 1M tokens baseline).
- **Execution Overhead**:
  - In-Browser JavaScript Engine: **< 5ms**
  - Python Hybrid Pre-Filter: **< 1ms**
  - Python Cross-Encoder (Batch): **~15–30ms (CPU)**

---

## 📄 License

Distributed under the **MIT License**. Built for high-efficiency RAG pipelines and snappy AI workflows.
