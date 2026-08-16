```
█▀▀ ▄▀█ █▄░█ █▀▄ █ █▀▄ ▄▀█ ▀█▀ █▀▀   █▀ █▄▄ █▀▀ █▀▀ ▀█▀ █▀
█▄▄ █▀█ █░▀█ █▄▀ █ █▄▀ █▀█ ░█░ ██▄   ▄█ █▄█ ██▄ ██▄ ░█░ ▄█
```

## ✂️ Dynamic Context Compressor for RAG & AI Chat Prompts

Take a prompt or a chunk of retrieved text. Score every sentence against the query — first cheap (Hybrid BM25 + sub-word n-Gram), then precise (Cross-Encoder / JS Engine). Keep only what answers the question. Ship less to the model, spend less on tokens.

*No vector DB needed. No extra LLM call to compress. Every sentence is scored and pruned before it ever reaches the model.*

`Pipeline` `Two-Stage` &nbsp; `Pre-filter` `Hybrid (BM25 + 3-gram)` &nbsp; `Scorer` `Cross-Encoder` &nbsp; `Chrome Extension` `Inline Composer` &nbsp; `Validation` `5/5 passing` &nbsp; `Tests` `32 passing` &nbsp; `License` `MIT`

---

## 🚀 Features

- **⚡ Two-Stage Sentence Relevance Engine**: Fast hybrid lexical filter + cross-encoder ranker that prevents paraphrase drops.
- **🛡️ Referential & Anaphoric Anchoring**: Automatically detects pronoun starters (`it`, `this`, `that`, `they`, `such`) and preserves antecedent context sentences.
- **📦 Atomic Code & Table Block Isolation**: Isolates markdown code fences and tables so syntax is never mangled during sentence splitting.
- **🔄 Maximal Marginal Relevance (MMR) Deduplication**: Penalizes redundant sentences across retrieved chunks to ensure information density.
- **🔢 Entity & Constraint Multipliers**: Protects numbers, percentages, currencies, and technical units from being pruned.
- **✂️ Discourse Hedge & Filler Micro-Pruning**: Strips rhetorical padding (*"It is important to note that"*, *"in order to"* → *"to"*, citations `[1]`, filler adverbs) while keeping facts intact.
- **🧩 Browser Extension (Capsule Hub / Tally Style)**: Mounts an inline **✂ Diet-Token** toolbar directly on ChatGPT, Claude, Gemini, DeepSeek, and Perplexity composers.
- **🌐 Interactive Web Playground**: Dark-mode visualizer with real-time token count, cost savings, latency metrics, and sentence heatmaps.
- **🛡️ 100% Client-Side / Local**: Runs on-device with zero external API dependencies or token leakage.

---

## 🧩 Chrome Extension (Inline AI Chat Toolbar)

The extension automatically attaches an in-page compression toolbar right to the prompt box on AI chat platforms:

- **Supported Platforms**: ChatGPT, Claude.ai, Google Gemini, DeepSeek, Perplexity, and general web textareas.
- **Direct Inline Mounting**: Uses Shadow DOM isolation (`:host { all: initial }`) so page stylesheets and Tailwind resets cannot break the toolbar.
- **React Native Value Setter**: Bypasses React's `_valueTracker` override so the AI site's send button activates immediately after compression.
- **Levels & One-Click Undo**: Pick **L** (Light, 60%), **B** (Balanced, 40%), or **A** (Aggressive, 25%) compression, or click **Undo** to restore original prompt text.
- **Global Shortcut**: Press `Alt + Shift + T` to compress whatever text box is currently focused.

### Installing the Extension:
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the [`extension/`](./extension) directory.
4. Open any AI chat tab (e.g. ChatGPT or Claude) and click inside the prompt box!

---

## 🧠 Python Scoring Pipeline

Every call to `score_sentences()` runs the two-stage pipeline:

```
Query + Chunk → Hybrid pre-filter → Cross-Encoder scorer → Kept sentences
```

| Stage | What happens |
|---|---|
| **1. Split** | Chunk arrives as a list of sentences (already split upstream) |
| **2. Pre-filter** | `HybridPreFilter(keep_fraction, min_keep)` combines BM25 lexical overlap with sub-word 3-grams to keep paraphrase candidates |
| **3. Score** | Surviving sentences go through `CrossEncoderScorer` (`cross-encoder/ms-marco-MiniLM-L-6-v2`) |
| **4. Return** | Ranked, scored sentences with token and cost reduction metrics |

### Ground-Truth Validation (5/5 Passing)

`scripts/validate_scorer.py` validates that paraphrase drops are eliminated:

| # | Query | Chunk text | Result |
|---|---|---|---|
| 1 | "Was the deadline extended?" | "...delivery date has been postponed." | ✅ KEPT by Hybrid (n-Gram match) |
| 2 | "Capital of Australia?" | "...Canberra is the seat of government." | ✅ KEPT |
| 3 | "Money back after 30 days?" | "...exchanged for store credit within a month." | ✅ KEPT by Hybrid (n-Gram match) |
| 4 | "Water damage covered?" | "...liquid exposure voids warranty." | ✅ KEPT |
| 5 | RAM spec (control) | "...16GB of unified RAM." | ✅ KEPT |

---

## 📁 Project Layout

```
Diet-Token/
├── extension/               Chrome Extension (Manifest V3)
│   ├── manifest.json        Permissions, match patterns, background worker
│   ├── content.js           Capsule-style inline DOM injector (ChatGPT, Claude, etc.)
│   ├── engine.js            Standalone client-side scoring & tokenizer engine
│   ├── background.js        Context menu & shortcut handler
│   ├── popup.html / .js     Standalone popup compressor interface
│   └── icons/               Extension icons (16, 32, 48, 128px)
│
├── core/                    Python Core Engine
│   ├── scorer.py            CrossEncoderScorer & pipeline entrypoint
│   ├── hybrid_filter.py     BM25 + character n-gram hybrid pre-filter
│   └── pruner.py            Context pruner & token counter
│
├── scripts/
│   └── validate_scorer.py   Ground truth validation suite (5 cases)
│
├── tests/
│   └── test_scorer.py       Unit tests (offline-safe)
│
├── index.html               Interactive Web Playground & Visualizer
└── requirements.txt         Python dependencies
```

---

## 🛠️ Getting Started (Python Core)

```bash
# Clone the repository
git clone https://github.com/pranay-patkar/Diet-Token.git
cd Diet-Token

# Install dependencies
pip install -r requirements.txt

# Run ground-truth validation
python scripts/validate_scorer.py

# Run test suite
pytest tests/
```

---

<div align="right">

`MIT License` · built for maximum prompt efficiency

</div>
