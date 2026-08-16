/**
 * PromptTrim Dynamic Context Compressor — in-browser compression engine.
 *
 * Universal Fidelity Compression Engine:
 * - Atomic block protection (Code, Tables, Numbered/Bulleted Lists, Blockquotes, YAML, Technical Inline Code)
 * - Auto-query extraction for query-less prompts
 * - Multi-signal scoring with instruction & constraint detection
 * - Semantic MMR (Word Jaccard + Entity Diff) protecting critical specs
 * - Referential anaphora anchoring
 * - Conservative discourse hedge micro-pruning
 * - Model-aware token estimation
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

  var BOUNDARY = /(?<=[.!?])\s+(?=[A-Z0-9"\u201c\u2018(_])|\n\s*\n+/;

  // Anaphoric pronouns / demonstratives that require an antecedent context sentence
  var ANAPHORA_STARTERS = /^(it|this|that|these|those|they|he|she|such|the above|as a result|consequently|therefore|however)\b/i;

  // Entity & numerical metrics / units regex
  var ENTITY_RE = /\b(?:\$?\d+(?:\.\d+)?(?:%|k|m|b|gb|mb|ms|usd|kb|fps|hz|ghz)?|#[0-9a-fA-F]{3,8}|[A-Z]{2,}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;

  // Conservative discourse hedges and conversational fluff
  var HEDGE_PATTERNS = [
    [/\b(it is important to note that|it should be noted that|it is worth mentioning that)\s*/gi, ""],
    [/\b(as (?:mentioned|stated|discussed) (?:before|above|previously))\s*,?\s*/gi, ""],
    // "in order to" only stripped if NOT followed by an action verb
    [/\bin order to\b(?!\s+(?:run|execute|invoke|call|perform|complete|finish|start|begin|stop|halt|abort|trigger|fire|emit|dispatch|send|receive|accept|reject|deny|allow|permit|enable|disable|activate|deactivate|initialize|terminate|destroy|create|delete|update|modify|change|set|get|read|write|append|prepend|insert|remove|add|clear|reset|flush|sync|commit|rollback|push|pull|fetch|load|save|persist|cache|invalidate|refresh|reload|restart|reboot|shutdown|wake|sleep|suspend|resume)\b)/gi, "to"],
    [/\b(due to the fact that)\b/gi, "because"],
    // "for the purpose of" only stripped if followed by a determiner/pronoun
    [/\b(for the purpose of)\b(?=\s+(?:the|a|an|this|that|these|those|my|your|our|their|its|his|her)\b)/gi, "for"],
    [/\b(at this point in time)\b/gi, "currently"],
    [/\b(first and foremost)\b/gi, "first"],
    [/\b(needless to say)\s*,?\s*/gi, ""],
    [/\b(as a matter of fact)\s*,?\s*/gi, ""],
    // Citations: strip [1], [2], [1, 2] when preceded by whitespace/punctuation (preserving code arr[0])
    [/(?<![a-zA-Z0-9_])\[\d+(?:[,\s–-]+\d+)*\]/g, ""],
    [/\[et al\.\]/gi, ""]
  ];

  var FILLER_WORDS = new Set([
    "basically", "obviously", "essentially", "literally", "totally",
    "definitely", "certainly", "absolutely", "clearly",
    "extremely", "really", "quite", "rather", "somewhat",
    "in fact", "as such"
  ]);

  var TOKEN_RATIOS = {
    "gpt-4o": 1.25,
    "gpt-4": 1.3,
    "gpt-3.5": 1.3,
    "claude": 1.3,
    "llama": 1.35,
    "default": 1.3
  };

  var PROFILES = {
    "chat-prompt": {
      name: "Chat Prompt",
      keepFraction: 0.5,
      protectBlocks: ["code", "table", "inline-code"],
      instructionSensitivity: "medium",
      stripFiller: true,
      mmrThreshold: 0.70,
      description: "Balanced pruning for conversational prompts"
    },
    "code-review": {
      name: "Code Review",
      keepFraction: 0.5,
      protectBlocks: ["code", "table", "inline-code", "path", "line-number", "hex"],
      instructionSensitivity: "high",
      stripFiller: true,
      mmrThreshold: 0.80,
      description: "Strict protection for code, paths, configs"
    },
    "legal-compliance": {
      name: "Legal / Compliance",
      keepFraction: 0.7,
      protectBlocks: ["code", "table", "date", "amount", "clause-number", "party"],
      instructionSensitivity: "high",
      stripFiller: false,
      mmrThreshold: 0.85,
      description: "Conservative pruning preserving clauses and numbers"
    },
    "rag-context": {
      name: "RAG Context",
      keepFraction: 0.4,
      protectBlocks: ["code", "table"],
      instructionSensitivity: "medium",
      stripFiller: true,
      mmrThreshold: 0.65,
      description: "Aggressive redundancy pruning for retrieved chunks"
    }
  };

  function getProfile(name) {
    return PROFILES[name] || PROFILES["chat-prompt"];
  }

  /* ------------------------------------------------------------------ */
  /* Model-aware token estimation (BPE Tokenizer + Fallback)            */
  /* ------------------------------------------------------------------ */
  function countTokens(text, model) {
    if (!text) return 0;
    if (global.Tokenizer && typeof global.Tokenizer.countTokens === "function") {
      return global.Tokenizer.countTokens(text, model);
    }
    var ratio = TOKEN_RATIOS[model] || TOKEN_RATIOS["default"];
    var words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words * ratio));
  }

  /* ------------------------------------------------------------------ */
  /* Expanded Atomic Block Isolation                                    */
  /* ------------------------------------------------------------------ */
  function extractAtomicBlocks(text) {
    var blocks = [];
    var processed = (text || "").trim();

    // 1. Triple-backtick code blocks
    processed = processed.replace(/```[\s\S]*?```/g, function (match) {
      var placeholder = "\n\n__ATOMIC_BLOCK_" + blocks.length + "__.\n\n";
      blocks.push(match);
      return placeholder;
    });

    // 2. Markdown tables
    processed = processed.replace(/(?:^|\n)(\|[^\n]+\|\r?\n\|[-: |]+\|\r?\n(?:\|[^\n]+\|\r?\n?)+)/g, function (match) {
      var placeholder = "\n\n__ATOMIC_BLOCK_" + blocks.length + "__.\n\n";
      blocks.push(match.trim());
      return placeholder;
    });

    // 3. Numbered lists (1. item / 2. item / ...)
    processed = processed.replace(/(?:^|\n)((?:\s*\d+\.\s+[^\n]+\n?){2,})/g, function (match) {
      var placeholder = "\n\n__ATOMIC_BLOCK_" + blocks.length + "__.\n\n";
      blocks.push(match.trim());
      return placeholder;
    });

    // 4. Bulleted lists (- item / * item)
    processed = processed.replace(/(?:^|\n)((?:\s*[-*]\s+[^\n]+\n?){2,})/g, function (match) {
      var placeholder = "\n\n__ATOMIC_BLOCK_" + blocks.length + "__.\n\n";
      blocks.push(match.trim());
      return placeholder;
    });

    // 5. Blockquotes (> ...)
    processed = processed.replace(/(?:^|\n)((?:>[^\n]*\n?){2,})/g, function (match) {
      var placeholder = "\n\n__ATOMIC_BLOCK_" + blocks.length + "__.\n\n";
      blocks.push(match.trim());
      return placeholder;
    });

    // 6. YAML frontmatter (--- ... ---)
    processed = processed.replace(/(?:^|\n)(---\r?\n[\s\S]*?\r?\n---)/g, function (match) {
      var placeholder = "\n\n__ATOMIC_BLOCK_" + blocks.length + "__.\n\n";
      blocks.push(match.trim());
      return placeholder;
    });

    // 7. Inline code with backticks (technical content only: paths, configs, symbols, digits)
    processed = processed.replace(/`([^`\n]{4,})`/g, function (match, inner) {
      if (/[/.\-_#@:]/.test(inner) || /\d{2,}/.test(inner)) {
        var placeholder = " __ATOMIC_INLINE_" + blocks.length + "__ ";
        blocks.push(match);
        return placeholder;
      }
      return match;
    });

    return { text: processed, blocks: blocks };
  }

  function restoreAtomicBlocks(text, blocks) {
    var restored = text;
    for (var i = 0; i < blocks.length; i++) {
      var phBlock = new RegExp("__ATOMIC_BLOCK_" + i + "__\\.?", "g");
      var phInline = new RegExp("__ATOMIC_INLINE_" + i + "__", "g");
      restored = restored.replace(phBlock, blocks[i]);
      restored = restored.replace(phInline, blocks[i]);
    }
    return restored;
  }

  /* ------------------------------------------------------------------ */
  /* Sentence Splitting                                                 */
  /* ------------------------------------------------------------------ */
  function splitSentences(text) {
    text = (text || "").trim();
    if (!text) return [];

    var pieces = text.split(BOUNDARY);
    var sentences = [];
    var buffer = "";

    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i].trim();
      if (!p) continue;
      buffer = buffer ? buffer + " " + p : p;
      var m = buffer.match(/\b([A-Za-z]+)\.\s*$/);
      if (m && ABBREVIATIONS.has(m[1].toLowerCase())) continue;
      sentences.push(buffer.trim());
      buffer = "";
    }
    if (buffer && buffer.trim()) sentences.push(buffer.trim());

    return sentences.filter(function (s) { return s.length > 0; });
  }

  /* ------------------------------------------------------------------ */
  /* Lexical & Entity Helpers                                            */
  /* ------------------------------------------------------------------ */
  function contentWords(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, " ")
      .split(/\s+/)
      .filter(function (w) { return w.length > 2 && !STOPWORDS.has(w); });
  }

  function charNgrams(text, n) {
    n = n || 3;
    var s = (text || "").toLowerCase().replace(/\s+/g, " ");
    var set = new Set();
    for (var i = 0; i <= s.length - n; i++) set.add(s.slice(i, i + n));
    return set;
  }

  function extractEntities(text) {
    var matches = (text || "").match(ENTITY_RE);
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
  /* Auto-Query Extraction (for query-less prompts)                     */
  /* ------------------------------------------------------------------ */
  function extractAutoQuery(text, maxTerms) {
    maxTerms = maxTerms || 15;
    var words = contentWords(text);
    var entities = extractEntities(text);

    var freq = new Map();
    words.forEach(function (w) { freq.set(w, (freq.get(w) || 0) + 1); });

    var scored = [];
    freq.forEach(function (count, w) {
      scored.push({ word: w, score: count * (w.length > 6 ? 2 : 1) });
    });
    scored.sort(function (a, b) { return b.score - a.score; });

    var topWords = scored.slice(0, maxTerms).map(function (s) { return s.word; });
    var entityArr = [];
    entities.forEach(function (e) { entityArr.push(e); });

    return topWords.concat(entityArr).join(" ");
  }

  /* ------------------------------------------------------------------ */
  /* Conservative Micro-Pruning of Hedges & Fluff                       */
  /* ------------------------------------------------------------------ */
  function stripFillerWords(text) {
    var cleaned = text;

    for (var i = 0; i < HEDGE_PATTERNS.length; i++) {
      cleaned = cleaned.replace(HEDGE_PATTERNS[i][0], HEDGE_PATTERNS[i][1]);
    }

    FILLER_WORDS.forEach(function (filler) {
      var pattern = new RegExp("\\b" + filler + "\\b,?\\s*", "gi");
      cleaned = cleaned.replace(pattern, "");
    });

    cleaned = cleaned.replace(/\s+/g, " ").trim();
    cleaned = cleaned.replace(/\s+([.,!?;:])/g, "$1");

    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
    return cleaned;
  }

  /* ------------------------------------------------------------------ */
  /* Main Compression Pipeline                                          */
  /* ------------------------------------------------------------------ */
  /**
   * @param {string} text   raw context / prompt to compress
   * @param {string} query  optional user query to score relevance against
   * @param {Object} [opts]
   *   keepFraction      0..1  fraction of top sentences to keep (default 0.5)
   *   minKeep                floor on kept sentences (default 1)
   *   preserveAnaphora  bool  preserve antecedent sentence for pronouns (default true)
   *   stripFiller       bool  strip rhetorical hedges & filler words (default true)
   *   fidelityMode      bool  enable universal spec & instruction preservation (default true)
   *   model             str   LLM model name for tokenizer calibration (default "default")
   *   costPerMillion         USD per 1M input tokens for cost stats (default 0.75)
   *   msPerToken             est. TTFT reduction per token saved (default 0.9)
   * @returns {Object} full result with breakdown stats
   */
  function compress(text, query, opts) {
    opts = opts || {};
    var profileName = opts.profile || "chat-prompt";
    var profile = getProfile(profileName);

    var keepFraction = typeof opts.keepFraction === "number" ? opts.keepFraction : profile.keepFraction;
    var fidelityMode = opts.fidelityMode != null ? Boolean(opts.fidelityMode) : true;
    var preserveAnaphora = opts.preserveAnaphora != null ? Boolean(opts.preserveAnaphora) : true;
    var stripFiller = opts.stripFiller != null ? Boolean(opts.stripFiller) : profile.stripFiller;
    var costPerMillion = typeof opts.costPerMillion === "number" ? opts.costPerMillion : 0.75;
    var msPerToken = typeof opts.msPerToken === "number" ? opts.msPerToken : 0.9;
    var minKeep = typeof opts.minKeep === "number" ? opts.minKeep : 1;
    var model = opts.model || "default";
    var mmrThreshold = typeof opts.mmrThreshold === "number" ? opts.mmrThreshold : profile.mmrThreshold;

    var start = typeof performance !== "undefined" ? performance.now() : Date.now();

    var original = (text || "").trim();
    var originalTokens = countTokens(original, model);

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
      cutByScoreCount: 0,
      instructionDensity: 0
    };

    if (!original) {
      base.latencyMs = nowSince(start);
      return base;
    }

    // Step 1: Protect expanded atomic blocks (code, tables, lists, quotes, YAML, inline code)
    var extracted = extractAtomicBlocks(original);
    var sentences = splitSentences(extracted.text);
    base.totalCount = sentences.length;

    if (!sentences.length) {
      base.compressed = restoreAtomicBlocks(extracted.text, extracted.blocks);
      base.compressedTokens = countTokens(base.compressed, model);
      base.tokensSaved = originalTokens - base.compressedTokens;
      base.compressionRatio = originalTokens ? base.tokensSaved / originalTokens : 0;
      base.latencyMs = nowSince(start);
      return base;
    }

    // Compute instruction density & adapt keep fraction
    var density = global.InstructionDetector
      ? global.InstructionDetector.density(sentences.map(function (s) { return restoreAtomicBlocks(s, extracted.blocks); }))
      : 0;
    base.instructionDensity = density;

    var adaptiveKeepFraction = keepFraction;
    if (fidelityMode) {
      if (density > 0.4) {
        adaptiveKeepFraction = Math.max(0.6, keepFraction);
      } else if (density > 0.2) {
        adaptiveKeepFraction = Math.max(0.5, keepFraction);
      }
    }

    // Step 2: Auto-query extraction for query-less prompts
    var effectiveQuery = (query || "").trim();
    var isAutoQuery = false;
    if (!effectiveQuery) {
      effectiveQuery = extractAutoQuery(original, 15);
      isAutoQuery = true;
    }

    var qWords = contentWords(effectiveQuery);
    var qGrams = charNgrams(effectiveQuery, 3);
    var qEntities = extractEntities(effectiveQuery);
    var hasQuery = qWords.length > 0;

    // Corpus IDF mapping
    var df = new Map();
    sentences.forEach(function (s) {
      var seen = new Set(contentWords(s));
      seen.forEach(function (w) { df.set(w, (df.get(w) || 0) + 1); });
    });
    function idf(w) {
      var d = df.get(w) || 0;
      return Math.log((sentences.length + 1) / (d + 1)) + 1;
    }

    // Step 3: Multi-signal scoring
    var scored = sentences.map(function (s, i) {
      var rawSentence = restoreAtomicBlocks(s, extracted.blocks);
      var isAtomic = s.indexOf("__ATOMIC_BLOCK_") !== -1 || s.indexOf("__ATOMIC_INLINE_") !== -1;
      var sWords = contentWords(s);
      var sGrams = charNgrams(s, 3);
      var sEntities = extractEntities(rawSentence);
      var score = 0;

      var instrType = global.InstructionDetector
        ? global.InstructionDetector.detect(rawSentence)
        : null;
      var instrBoost = 0;
      if (instrType === "critical") instrBoost = 3.0;
      else if (instrType === "instruction") instrBoost = 2.0;
      else if (instrType === "technical") instrBoost = 1.5;
      else if (instrType === "logical") instrBoost = 1.0;

      if (isAtomic) {
        score = 5.0 + instrBoost;
      } else if (hasQuery && !isAutoQuery) {
        // Explicit query provided
        var keyword = 0;
        for (var qi = 0; qi < qWords.length; qi++) {
          var w = qWords[qi];
          if (sWords.indexOf(w) !== -1) {
            keyword += idf(w);
          }
        }

        var interGrams = 0;
        sGrams.forEach(function (g) { if (qGrams.has(g)) interGrams++; });
        var unionGrams = sGrams.size + qGrams.size - interGrams;
        var semantic = unionGrams > 0 ? interGrams / unionGrams : 0;

        var interWords = 0;
        var sWordSet = new Set(sWords);
        qWords.forEach(function (w) { if (sWordSet.has(w)) interWords++; });
        var lexical = qWords.length > 0 ? interWords / qWords.length : 0;

        var entityBoost = 0;
        qEntities.forEach(function (e) {
          if (sEntities.has(e)) entityBoost += 1.5;
        });

        score = keyword + semantic + lexical + entityBoost + instrBoost;
      } else {
        // Query-less / Auto-query mode: balanced information density + instruction weight
        var counts = new Map();
        sWords.forEach(function (w) { counts.set(w, (counts.get(w) || 0) + 1); });
        var rarityTotal = 0;
        counts.forEach(function (c, w) { rarityTotal += c * idf(w); });
        var rarity = rarityTotal / Math.max(1, sWords.length);

        var hasEntity = sEntities.size > 0 ? 0.5 : 0;
        var wordCount = sWords.length;
        var lengthFactor = wordCount < 3 ? 0.3 : wordCount > 40 ? 0.8 : 1.0;

        score = (rarity * 0.4 + instrBoost + hasEntity) * lengthFactor;
      }

      // Position prior: opening & closing anchors
      score += i === 0 ? 0.6 : i === sentences.length - 1 ? 0.25 : 0;

      return {
        text: s,
        rawText: rawSentence,
        index: i,
        score: score,
        sWords: sWords,
        sGrams: sGrams,
        sEntities: sEntities,
        isAtomic: isAtomic,
        isCritical: instrType === "critical" || instrType === "instruction" || instrType === "technical"
      };
    });

    // Step 4: Semantic MMR (Word Jaccard + Entity Set Diff)
    var sortedCandidates = scored.slice().sort(function (a, b) { return b.score - a.score; });
    var selected = [];
    var droppedByRedundancy = [];

    var targetKeep = Math.max(
      minKeep,
      Math.min(scored.length, Math.ceil(scored.length * adaptiveKeepFraction))
    );

    for (var ci = 0; ci < sortedCandidates.length; ci++) {
      var cand = sortedCandidates[ci];
      if (selected.length >= targetKeep && !cand.isAtomic && !cand.isCritical) {
        continue;
      }

      var maxRedundancy = 0.0;
      for (var si = 0; si < selected.length; si++) {
        var sel = selected[si];

        // Word overlap
        var wordSetA = new Set(cand.sWords);
        var wordSetB = new Set(sel.sWords);
        var inter = 0;
        wordSetA.forEach(function (w) { if (wordSetB.has(w)) inter++; });
        var union = wordSetA.size + wordSetB.size - inter;
        var wordRed = union > 0 ? inter / union : 0;

        // Entity set diff (if entities differ, they are not redundant)
        var entInter = 0;
        cand.sEntities.forEach(function (e) { if (sel.sEntities.has(e)) entInter++; });
        var entUnion = cand.sEntities.size + sel.sEntities.size - entInter;
        var entSim = entUnion > 0 ? entInter / entUnion : (cand.sEntities.size === 0 && sel.sEntities.size === 0 ? 1 : 0);

        var combined = wordRed * 0.7 + entSim * 0.3;
        if (combined > maxRedundancy) maxRedundancy = combined;
      }

      if (maxRedundancy >= mmrThreshold && selected.length >= minKeep && !cand.isAtomic && !cand.isCritical) {
        droppedByRedundancy.push(cand);
      } else {
        selected.push(cand);
      }
    }

    // Step 5: Anaphoric Anchor Recovery
    if (preserveAnaphora) {
      var selectedIndices = new Set(selected.map(function (s) { return s.index; }));
      var initialSelected = selected.slice();

      for (var ai = 0; ai < initialSelected.length; ai++) {
        var sObj = initialSelected[ai];
        if (sObj.index > 0 && ANAPHORA_STARTERS.test(sObj.rawText.trim())) {
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

    // Step 6: Sequential Reassembly
    var kept = selected.sort(function (a, b) { return a.index - b.index; });
    var keptIndices = new Set(kept.map(function (s) { return s.index; }));
    var droppedByScore = scored.filter(function (s) {
      return !keptIndices.has(s.index) && !droppedByRedundancy.some(function (d) { return d.index === s.index; });
    });

    var rawAssembled = kept.map(function (s) { return s.text; }).join(" ");
    var restoredText = restoreAtomicBlocks(rawAssembled, extracted.blocks);

    // Step 7: Conservative Micro-Prune
    var finalCompressed = stripFiller ? stripFillerWords(restoredText) : restoredText;

    var compressedTokens = countTokens(finalCompressed, model);
    var tokensSaved = originalTokens - compressedTokens;
    var ratio = originalTokens ? tokensSaved / originalTokens : 0;

    base.compressed = finalCompressed;
    base.compressedTokens = compressedTokens;
    base.tokensSaved = tokensSaved;
    base.compressionRatio = ratio;
    base.reductionPercent = Math.round(ratio * 100);
    base.reductionPercentage = Math.round(ratio * 100);
    base.costSaved = (tokensSaved / 1e6) * costPerMillion;
    base.latencyMs = nowSince(start);
    base.latencyDropMs = Math.round(tokensSaved * msPerToken);
    base.keptSentences = kept.map(function (s) { return restoreAtomicBlocks(s.text, extracted.blocks); });
    base.droppedByRedundancy = droppedByRedundancy.map(function (s) { return restoreAtomicBlocks(s.text, extracted.blocks); });
    base.droppedByScore = droppedByScore.map(function (s) { return restoreAtomicBlocks(s.text, extracted.blocks); });
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

  var DEFAULTS = {
    keepFraction: 0.5,
    fidelityMode: true,
    preserveAnaphora: true,
    stripFiller: true,
    costPerMillion: 0.75,
    msPerToken: 0.9,
    model: "default",
    profile: "chat-prompt"
  };

  var api = {
    compress: compress,
    splitSentences: splitSentences,
    countTokens: countTokens,
    extractAtomicBlocks: extractAtomicBlocks,
    restoreAtomicBlocks: restoreAtomicBlocks,
    extractAutoQuery: extractAutoQuery,
    stripFillerWords: stripFillerWords,
    PROFILES: PROFILES,
    getProfile: getProfile,
    DEFAULTS: DEFAULTS
  };

  global.PromptTrim = api;
  global.TokenDiet = api; // alias for backwards compatibility
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));