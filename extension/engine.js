/**
 * Token-Diet Dynamic Context Compressor — in-browser compression engine.
 *
 * Pure-JS port of the core/ Python pipeline so the extension runs fully
 * local (zero API calls, zero latency to a server):
 *
 *     split_sentences  ->  hybrid lexical scoring (TF-IDF keywords + char
 *                          n-gram semantic overlap)  ->  redundancy removal
 *                          (near-duplicate detection)  ->  cherry-pick prune
 *                          ->  reassemble in original order
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
  /* Main compression entry point                                        */
  /* ------------------------------------------------------------------ */
  /**
   * @param {string} text   raw context / prompt to compress
   * @param {string} query  optional user query to score relevance against
   * @param {Object} [opts]
   *   keepFraction  0..1  fraction of top sentences to keep (default 0.4)
   *   minKeep            floor on kept sentences (default 1)
   *   costPerMillion     USD per 1M input tokens for cost stats (default 0.75)
   *   msPerToken         est. TTFT reduction per token saved (default 0.9)
   * @returns {Object} full result with stats
   */
  function compress(text, query, opts) {
    opts = opts || {};
    var keepFraction = opts.keepFraction != null ? opts.keepFraction : 0.4;
    var minKeep = opts.minKeep != null ? opts.minKeep : 1;
    var costPerMillion = opts.costPerMillion != null ? opts.costPerMillion : 0.75;
    var msPerToken = opts.msPerToken != null ? opts.msPerToken : 0.9;

    var start = typeof performance !== "undefined" ? performance.now() : Date.now();

    var original = (text || "").trim();
    var sentences = splitSentences(original);
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
      totalCount: sentences.length,
      dupRemovedCount: 0,
      cutByScoreCount: 0
    };

    if (!sentences.length) {
      base.latencyMs = nowSince(start);
      return base;
    }

    var qWords = contentWords(query || "");
    var qGrams = charNgrams(query || "", 3);
    var hasQuery = qWords.length > 0;

    // corpus document frequency for IDF weighting (rarer words matter more)
    var df = new Map();
    sentences.forEach(function (s) {
      var seen = new Set(contentWords(s));
      seen.forEach(function (w) { df.set(w, (df.get(w) || 0) + 1); });
    });
    function idf(w) {
      var d = df.get(w) || 0;
      return Math.log((sentences.length + 1) / (d + 1)) + 1;
    }

    var scored = sentences.map(function (s, i) {
      var sWords = contentWords(s);
      var sGrams = charNgrams(s, 3);
      var score = 0;

      if (hasQuery) {
        // Stage 1 (BM25-ish): exact keyword hits, weighted by IDF
        var keyword = 0;
        for (var qi = 0; qi < qWords.length; qi++) {
          var w = qWords[qi];
          for (var si = 0; si < sWords.length; si++) {
            if (sWords[si] === w) { keyword += idf(w); break; }
          }
        }
        // Hybrid n-gram pre-filter: partial-prefix matches catch paraphrases
        for (var qj = 0; qj < qWords.length; qj++) {
          var qw = qWords[qj];
          if (qw.length < 4) continue;
          for (var sj = 0; sj < sWords.length; sj++) {
            if (sWords[sj].indexOf(qw) === 0) { keyword += idf(qw) * 0.5; break; }
          }
        }
        // Stage 2 (semantic-ish): char 3-gram overlap is a browser-safe proxy
        // for embedding similarity — catches rephrased answers with zero
        // shared keywords.
        var semantic = jaccard(qGrams, sGrams) * 2.2;
        var lexical = wordOverlap(qWords, sWords) * 1.5;
        score = keyword + semantic + lexical;
      } else {
        // Query-less mode: sentence-internal TF-IDF rarity (information density)
        var counts = new Map();
        sWords.forEach(function (w) { counts.set(w, (counts.get(w) || 0) + 1); });
        var total = 0;
        counts.forEach(function (c, w) { total += c * idf(w); });
        score = total / Math.max(1, sWords.length);
      }

      // position prior: opening + closing sentences anchor flow
      score += i === 0 ? 0.6 : i === sentences.length - 1 ? 0.25 : 0;

      return { text: s, index: i, score: score, sWords: sWords, sGrams: sGrams };
    });

    // ---- redundancy removal: greedy keep, drop near-duplicates ----
    var ranked = scored.slice().sort(function (a, b) { return b.score - a.score; });
    var selected = [];
    var droppedByRedundancy = [];

    ranked.forEach(function (s) {
      var dup = selected.some(function (k) {
        if (jaccard(s.sGrams, k.sGrams) >= 0.6) return true;
        var shorter = s.text.length <= k.text.length ? s.text : k.text;
        var longer = s.text.length <= k.text.length ? k.text : s.text;
        if (shorter.length > 20 && longer.indexOf(shorter) !== -1) return true;
        return false;
      });
      if (dup) droppedByRedundancy.push(s);
      else selected.push(s);
    });

    // ---- cherry-pick prune: keep top-k, restore original order ----
    var keepCount = Math.max(
      minKeep,
      Math.min(selected.length, Math.round(selected.length * keepFraction))
    );
    var kept = selected
      .slice(0, keepCount)
      .sort(function (a, b) { return a.index - b.index; });

    var droppedByScore = selected.slice(keepCount);
    var compressed = kept.map(function (s) { return s.text; }).join(" ");

    var compressedTokens = countTokens(compressed);
    var tokensSaved = originalTokens - compressedTokens;
    var ratio = originalTokens ? tokensSaved / originalTokens : 0;

    base.compressed = compressed;
    base.compressedTokens = compressedTokens;
    base.tokensSaved = tokensSaved;
    base.compressionRatio = ratio;
    base.costSaved = (tokensSaved / 1e6) * costPerMillion;
    base.latencyMs = nowSince(start);
    base.latencyDropMs = Math.round(tokensSaved * msPerToken);
    base.keptSentences = kept.map(function (s) { return s.text; });
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
  /* Popup defaults + demo seed (matches dashboard's 560 -> 160 example) */
  /* ------------------------------------------------------------------ */
  var DEFAULTS = {
    keepFraction: 0.4,
    costPerMillion: 0.75,
    msPerToken: 0.9
  };

  global.TokenDiet = {
    compress: compress,
    splitSentences: splitSentences,
    countTokens: countTokens,
    DEFAULTS: DEFAULTS
  };
})(typeof window !== "undefined" ? window : this);