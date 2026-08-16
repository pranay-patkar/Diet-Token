/**
 * Token-Diet Dynamic Context Compressor — in-browser compression engine.
 *
 * Pure-JS port of the core/ Python pipeline so the extension runs fully
 * local (zero API calls, zero latency to a server):
 *
 *     extractAtomicBlocks -> splitSentences -> Hybrid Scoring (BM25 keywords
 *     + char n-grams + entity/numerical constraints) -> MMR Deduplication
 *     -> Anaphora Anchor Recovery -> Reassembly -> Discourse Hedge & Filler Stripping
 *
 * Mirrors core/metrics.py token estimation (~1.3 tokens / word).
 */
(function (global) {
  "use strict";

  var STOPWORDS = new Set(
    (
      "the a an and or but if then else for of to in on at by with from as is are was were be been being it its this that these those " +
      "we you they he she them their our your i my me him her us his hers will would can could should may might shall do does did done " +
      "have has had not no nor so too very just also than then there here when where why how what which who whom whose all any both " +
      "each few more most other some such only own same don now over under again further once"
    ).split(" ")
  );

  var ABBREVIATIONS = new Set(
    (
      "mr mrs ms dr prof sr jr st vs etc e.g i.e eg ie u.s u.k u.n inc ltd co corp fig no vol approx dept al est min max mt rd ave " +
      "blvd jan feb mar apr jun jul aug sep oct nov dec"
    ).split(" ")
  );

  var BOUNDARY = /(?<=[.!?])\s+(?=[A-Z0-9"\u201c\u2018(])/;

  // Anaphoric pronouns / demonstratives that require an antecedent context sentence
  var ANAPHORA_STARTERS = /^(it|this|that|these|those|they|he|she|such|the above|as a result|consequently|therefore|however)\b/i;

  // Entity & numerical metrics / units regex
  var ENTITY_RE = /\b(?:\$?\d+(?:\.\d+)?(?:%|k|m|b|gb|mb|ms|usd)?|[A-Z]{2,}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;

  // Discourse hedges and conversational fluff
  var HEDGE_PATTERNS = [
    [/\b(it is important to note that|it should be noted that|it is worth mentioning that)\s*/gi, ""],
    [/\b(as (?:mentioned|stated|discussed) (?:before|above|previously))\s*,?\s*/gi, ""],
    [/\b(in order to)\b/gi, "to"],
    [/\b(due to the fact that)\b/gi, "because"],
    [/\b(for the purpose of)\b/gi, "for"],
    [/\b(at this point in time)\b/gi, "currently"],
    [/\b(first and foremost)\b/gi, "first"],
    [/\b(needless to say)\s*,?\s*/gi, ""],
    [/\b(as a matter of fact)\s*,?\s*/gi, ""],
    [/\[\d+(?:,\s*\d+)*\]/g, ""]  // Citations like [1] or [1, 2]
  ];

  var FILLER_WORDS = new Set([
    "basically", "obviously", "essentially", "literally", "totally",
    "actually", "definitely", "certainly", "absolutely", "clearly",
    "very", "extremely", "really", "quite", "rather", "somewhat",
    "in fact", "as such"
  ]);

  /* ------------------------------------------------------------------ */
  /* Atomic code & table block preservation                             */
  /* ------------------------------------------------------------------ */
  function extractAtomicBlocks(text) {
    var blocks = [];
    var processed = text;

    // 1. Triple-backtick code blocks
    processed = processed.replace(/```[\s\S]*?```/g, function (match) {
      var placeholder = " __ATOMIC_BLOCK_" + blocks.length + "__ ";
      blocks.push(match);
      return placeholder;
    });

    // 2. Markdown tables
    processed = processed.replace(/(?:^|\n)(\|[^\n]+\|\r?\n\|[-: |]+\|\r?\n(?:\|[^\n]+\|\r?\n?)+)/g, function (match) {
      var placeholder = "\n__ATOMIC_BLOCK_" + blocks.length + "__\n";
      blocks.push(match.trim());
      return placeholder;
    });

    return { text: processed, blocks: blocks };
  }

  function restoreAtomicBlocks(text, blocks) {
    var restored = text;
    for (var i = 0; i < blocks.length; i++) {
      var placeholder = new RegExp("__ATOMIC_BLOCK_" + i + "__", "g");
      restored = restored.replace(placeholder, blocks[i]);
    }
    return restored;
  }

  /* ------------------------------------------------------------------ */
  /* Token estimation — mirrors core/metrics.py fallback (1.3 tok/word)  */
  /* ------------------------------------------------------------------ */
  function countTokens(text) {
    if (!text) return 0;
    var words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words * 1.3));
  }

  /* ------------------------------------------------------------------ */
  /* Sentence splitting — mirrors core/sentence_split.py regex strategy  */
  /* ------------------------------------------------------------------ */
  function splitSentences(text) {
    text = (text || "").trim();
    if (!text) return [];

    var pieces = text.split(BOUNDARY);
    var sentences = [];
    var buffer = "";

    for (var i = 0; i < pieces.length; i++) {
      buffer = buffer ? buffer + " " + pieces[i] : pieces[i];
      var m = buffer.match(/\b([A-Za-z]+)\.\s*$/);
      if (m && ABBREVIATIONS.has(m[1].toLowerCase())) continue;
      sentences.push(buffer.trim());
      buffer = "";
    }
    if (buffer) sentences.push(buffer.trim());

    return sentences.filter(function (s) { return s.length > 0; });
  }

  /* ------------------------------------------------------------------ */
  /* Lexical helpers                                                     */
  /* ------------------------------------------------------------------ */
  function contentWords(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, " ")
      .split(/\s+/)
      .filter(function (w) { return w.length > 2 && !STOPWORDS.has(w); });
  }

  function charNgrams(text, n) {
    n = n || 3;
    var s = text.toLowerCase().replace(/\s+/g, " ");
    var set = new Set();
    for (var i = 0; i <= s.length - n; i++) set.add(s.slice(i, i + n));
    return set;
  }

  function extractEntities(text) {
    var matches = text.match(ENTITY_RE);
    if (!matches) return new Set();
    var set = new Set();
    matches.forEach(function (m) {
      var norm = m.toLowerCase().trim();
      if (norm.length > 1 && !STOPWORDS.has(norm)) set.add(norm);
    });
    return set;
  }

  function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    var inter = 0;
    a.forEach(function (v) { if (b.has(v)) inter++; });
    return inter / (a.size + b.size - inter);
  }

  function wordOverlap(a, b) {
    if (!a.length || !b.length) return 0;
    var setB = new Set(b);
    var hits = 0;
    for (var i = 0; i < a.length; i++) if (setB.has(a[i])) hits++;
    return hits / Math.max(a.length, b.length);
  }

  /* ------------------------------------------------------------------ */
  /* Micro-Pruning: Discourse hedges and filler word stripping          */
  /* ------------------------------------------------------------------ */
  function stripFillerWords(text) {
    var cleaned = text;

    // 1. Strip discourse hedges & structural fluff
    for (var i = 0; i < HEDGE_PATTERNS.length; i++) {
      cleaned = cleaned.replace(HEDGE_PATTERNS[i][0], HEDGE_PATTERNS[i][1]);
    }

    // 2. Strip single-word fillers
    FILLER_WORDS.forEach(function (filler) {
      var pattern = new RegExp("\\b" + filler + "\\b,?\\s*", "gi");
      cleaned = cleaned.replace(pattern, "");
    });

    // Clean whitespace & stray punctuation
    cleaned = cleaned.replace(/\s+/g, " ").trim();
    cleaned = cleaned.replace(/\s+([.,!?;:])/g, "$1");

    // Capitalize sentence start
    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
    return cleaned;
  }

  /* ------------------------------------------------------------------ */
  /* Main compression entry point                                        */
  /* ------------------------------------------------------------------ */
  /**
   * @param {string} text   raw context / prompt to compress
   * @param {string} query  optional user query to score relevance against
   * @param {Object} [opts]
   *   keepFraction      0..1  fraction of top sentences to keep (default 0.4)
   *   minKeep                floor on kept sentences (default 1)
   *   preserveAnaphora  bool  preserve antecedent sentence for pronouns (default true)
   *   stripFiller       bool  strip rhetorical hedges & filler words (default true)
   *   mmrLambda         0..1  MMR relevance vs diversity weight (default 0.75)
   *   costPerMillion         USD per 1M input tokens for cost stats (default 0.75)
   *   msPerToken             est. TTFT reduction per token saved (default 0.9)
   * @returns {Object} full result with stats
   */
  function compress(text, query, opts) {
    opts = opts || {};
    var keepFraction = opts.keepFraction != null ? opts.keepFraction : 0.4;
    var minKeep = opts.minKeep != null ? opts.minKeep : 1;
    var preserveAnaphora = opts.preserveAnaphora != null ? opts.preserveAnaphora : true;
    var stripFiller = opts.stripFiller != null ? opts.stripFiller : true;
    var mmrLambda = opts.mmrLambda != null ? opts.mmrLambda : 0.75;
    var costPerMillion = opts.costPerMillion != null ? opts.costPerMillion : 0.75;
    var msPerToken = opts.msPerToken != null ? opts.msPerToken : 0.9;

    var start = typeof performance !== "undefined" ? performance.now() : Date.now();

    var original = (text || "").trim();
    var originalTokens = countTokens(original);

    var base = {
      original: original,
      compressed: "",
      originalTokens: originalTokens,
      compressedTokens: 0,
      tokensSaved: 0,
      compressionRatio: 0,
      costSaved: 0,
      latencyMs: 0,
      latencyDropMs: 0,
      keptSentences: [],
      droppedByRedundancy: [],
      droppedByScore: [],
      keptCount: 0,
      totalCount: 0,
      dupRemovedCount: 0,
      cutByScoreCount: 0
    };

    if (!original) {
      base.latencyMs = nowSince(start);
      return base;
    }

    // Step 1: Protect atomic code and tabular blocks
    var extracted = extractAtomicBlocks(original);
    var sentences = splitSentences(extracted.text);
    base.totalCount = sentences.length;

    if (!sentences.length) {
      base.compressed = restoreAtomicBlocks(extracted.text, extracted.blocks);
      base.compressedTokens = countTokens(base.compressed);
      base.tokensSaved = originalTokens - base.compressedTokens;
      base.compressionRatio = originalTokens ? base.tokensSaved / originalTokens : 0;
      base.latencyMs = nowSince(start);
      return base;
    }

    var qWords = contentWords(query || "");
    var qGrams = charNgrams(query || "", 3);
    var qEntities = extractEntities(query || "");
    var hasQuery = qWords.length > 0;

    // Corpus document frequency for IDF weighting
    var df = new Map();
    sentences.forEach(function (s) {
      var seen = new Set(contentWords(s));
      seen.forEach(function (w) { df.set(w, (df.get(w) || 0) + 1); });
    });
    function idf(w) {
      var d = df.get(w) || 0;
      return Math.log((sentences.length + 1) / (d + 1)) + 1;
    }

    // Step 2: Multi-signal scoring (BM25 + Prefix n-Grams + Entity Constraints)
    var scored = sentences.map(function (s, i) {
      var isAtomic = s.indexOf("__ATOMIC_BLOCK_") !== -1;
      var sWords = contentWords(s);
      var sGrams = charNgrams(s, 3);
      var sEntities = extractEntities(s);
      var score = 0;

      if (isAtomic) {
        // High baseline priority for intact code and tables
        score = 5.0;
      } else if (hasQuery) {
        // Stage 1 (BM25-ish): exact keyword hits weighted by IDF
        var keyword = 0;
        for (var qi = 0; qi < qWords.length; qi++) {
          var w = qWords[qi];
          for (var si = 0; si < sWords.length; si++) {
            if (sWords[si] === w) { keyword += idf(w); break; }
          }
        }
        // Prefix n-gram pre-filter: catches morphological variations and stems
        for (var qj = 0; qj < qWords.length; qj++) {
          var qw = qWords[qj];
          if (qw.length < 4) continue;
          for (var sj = 0; sj < sWords.length; sj++) {
            if (sWords[sj].indexOf(qw) === 0) { keyword += idf(qw) * 0.5; break; }
          }
        }
        // Stage 2: Character 3-gram semantic overlap + lexical density
        var semantic = jaccard(qGrams, sGrams) * 2.2;
        var lexical = wordOverlap(qWords, sWords) * 1.5;

        // Entity / Constraint boost
        var entityBoost = 0;
        qEntities.forEach(function (ent) {
          if (sEntities.has(ent)) entityBoost += 0.5;
        });
        if (sEntities.size > 0) entityBoost += 0.2; // contains specific numerical/factual constraints

        score = keyword + semantic + lexical + entityBoost;
      } else {
        // Query-less mode: sentence-internal TF-IDF rarity (information density)
        var counts = new Map();
        sWords.forEach(function (w) { counts.set(w, (counts.get(w) || 0) + 1); });
        var total = 0;
        counts.forEach(function (c, w) { total += c * idf(w); });
        score = total / Math.max(1, sWords.length);
      }

      // Position prior: opening and concluding summary anchors
      score += i === 0 ? 0.6 : i === sentences.length - 1 ? 0.25 : 0;

      return {
        text: s,
        index: i,
        score: score,
        sWords: sWords,
        sGrams: sGrams,
        isAtomic: isAtomic
      };
    });

    // Step 3: Maximal Marginal Relevance (MMR) & Redundancy Filtering
    var sortedCandidates = scored.slice().sort(function (a, b) { return b.score - a.score; });
    var selected = [];
    var droppedByRedundancy = [];

    var targetKeep = Math.max(
      minKeep,
      Math.min(scored.length, Math.ceil(scored.length * keepFraction))
    );

    for (var ci = 0; ci < sortedCandidates.length; ci++) {
      if (selected.length >= targetKeep) break;
      var cand = sortedCandidates[ci];

      var maxRedundancy = 0.0;
      for (var si = 0; si < selected.length; si++) {
        var red = jaccard(cand.sGrams, selected[si].sGrams);
        if (red > maxRedundancy) maxRedundancy = red;
      }

      if (maxRedundancy >= 0.65 && selected.length >= minKeep && !cand.isAtomic) {
        droppedByRedundancy.push(cand);
      } else {
        selected.push(cand);
      }
    }

    // Step 4: Anaphoric Anchor Recovery (ensure antecedent context for "It", "This", "They")
    if (preserveAnaphora) {
      var selectedIndices = new Set(selected.map(function (s) { return s.index; }));
      var initialSelected = selected.slice();

      for (var ai = 0; ai < initialSelected.length; ai++) {
        var sObj = initialSelected[ai];
        if (sObj.index > 0 && ANAPHORA_STARTERS.test(sObj.text.trim())) {
          var prevIdx = sObj.index - 1;
          if (!selectedIndices.has(prevIdx)) {
            var prevSentence = scored.find(function (s) { return s.index === prevIdx; });
            if (prevSentence) {
              selected.push(prevSentence);
              selectedIndices.add(prevIdx);
            }
          }
        }
      }
    }

    // Step 5: Restore original sequential reading order
    var kept = selected.sort(function (a, b) { return a.index - b.index; });
    var keptIndices = new Set(kept.map(function (s) { return s.index; }));
    var droppedByScore = scored.filter(function (s) {
      return !keptIndices.has(s.index) && !droppedByRedundancy.some(function (d) { return d.index === s.index; });
    });

    // Step 6: Reassemble and restore atomic blocks
    var rawAssembled = kept.map(function (s) { return s.text; }).join(" ");
    var restoredText = restoreAtomicBlocks(rawAssembled, extracted.blocks);

    // Step 7: Micro-prune filler words and conversational fluff
    var finalCompressed = stripFiller ? stripFillerWords(restoredText) : restoredText;

    var compressedTokens = countTokens(finalCompressed);
    var tokensSaved = originalTokens - compressedTokens;
    var ratio = originalTokens ? tokensSaved / originalTokens : 0;

    base.compressed = finalCompressed;
    base.compressedTokens = compressedTokens;
    base.tokensSaved = tokensSaved;
    base.compressionRatio = ratio;
    base.costSaved = (tokensSaved / 1e6) * costPerMillion;
    base.latencyMs = nowSince(start);
    base.latencyDropMs = Math.round(tokensSaved * msPerToken);
    base.keptSentences = kept.map(function (s) { return restoreAtomicBlocks(s.text, extracted.blocks); });
    base.droppedByRedundancy = droppedByRedundancy.map(function (s) { return s.text; });
    base.droppedByScore = droppedByScore.map(function (s) { return s.text; });
    base.keptCount = kept.length;
    base.dupRemovedCount = droppedByRedundancy.length;
    base.cutByScoreCount = droppedByScore.length;

    return base;
  }

  function nowSince(start) {
    return typeof performance !== "undefined"
      ? performance.now() - start
      : Date.now() - start;
  }

  /* ------------------------------------------------------------------ */
  /* Popup defaults + demo seed                                         */
  /* ------------------------------------------------------------------ */
  var DEFAULTS = {
    keepFraction: 0.4,
    preserveAnaphora: true,
    stripFiller: true,
    costPerMillion: 0.75,
    msPerToken: 0.9
  };

  global.TokenDiet = {
    compress: compress,
    splitSentences: splitSentences,
    countTokens: countTokens,
    extractAtomicBlocks: extractAtomicBlocks,
    restoreAtomicBlocks: restoreAtomicBlocks,
    stripFillerWords: stripFillerWords,
    DEFAULTS: DEFAULTS
  };
})(typeof window !== "undefined" ? window : this);