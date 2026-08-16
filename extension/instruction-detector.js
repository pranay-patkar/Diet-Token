/**
 * Instruction Detector — identifies sentences that carry procedural/spec weight.
 * These get a score floor so they survive MMR pruning.
 */
(function (global) {
  "use strict";

  // Imperative starters: "Replace the...", "Use monospace...", "Avoid gradients..."
  var IMPERATIVE_START = /^(do not|don't|replace|use|keep|avoid|remove|add|ensure|fix|check|review|click|clicking|store|encrypt|decrypt|prioritize|preserve|maintain|set|configure|install|run|build|create|design|implement|refactor|update|change|modify|redesign|restructure|reorganize|simplify|streamline|optimize|compress|strip|protect|isolate|mount|dispatch|invoke|call|return|throw|catch|handle|process|parse|validate|sanitize|escape|encode|decode|hash|sign|verify|authenticate|authorize|redirect|forward|proxy|cache|invalidate|prefetch|lazy-load|preload|defer|async|await|yield|break|continue|abort|retry|fallback|escalate|notify|alert|log|trace|debug|profile|benchmark|test|deploy|rollback|scale|shard|replicate|partition|index|query|fetch|save|load|persist|serialize|deserialize|clone|merge|diff|patch|commit|push|pull|rebase|cherry-pick|stash|drop|restore|reset|revert|amend|squash)\b/i;

  // Field/spec patterns: "Each row should...", "The component must..."
  var SPEC_PATTERN = /^(each|every|all|the (component|row|column|field|section|panel|button|input|output|request|response|payload|header|parameter|argument|option|flag|setting|config|property|attribute|method|function|class|module|service|endpoint|route|handler|controller|model|view|template|schema|migration)|palette|colors?|theme|styles?|layout|get|post|put|patch|delete|head|options|rate limit|data retention|access logs|gdpr|ccpa|audit trail)\b/i;

  // Constraint patterns: numbers with units, percentages, hex codes, thresholds, status codes
  var CONSTRAINT_RE = /(\b\d+(\.\d+)?%|#\b[0-9a-fA-F]{3,8}\b|\b[<>]=?\s?\d+\b|\b>=?\s?\d+\b|\b<=?\s?\d+\b|\b≈\s?\d+\b|\b~\s?\d+\b|\b\d+\s?(?:ms|s|sec|min|mins|minutes?|hour|hours?|day|days?|year|years?|us|ns|gb|mb|kb|bytes?|hz|khz|mhz|ghz|rpm|fps|tps|qps|rps|ops|req|reqs|conns?|threads?|workers?|px|em|rem|col|cols|columns?|rows?|pages?)\b|\b(?:line|port|status|code|http)\s+\d+\b|\b(?:200|201|204|400|401|403|404|500)\b)/i;

  // Modal verbs indicating requirements: "must", "should", "shall", "required", "needs to"
  var MODAL_RE = /\b(must|should|shall|required|needs?\s?to|has\s?to|ought\s?to|will|won't|cannot|can't|mustn't|shouldn't)\b/i;

  // Technical value patterns: file paths, URLs, version numbers, IP addresses
  var TECHNICAL_RE = /(\/[^\s]+\.(js|py|ts|tsx|jsx|go|rs|java|c|cpp|h|hpp|cc|cxx|rb|php|swift|kt|scala|clj|exs|ex|erl|hs|ml|fs|fsx|vb|cs|pl|pm|t|sh|bash|zsh|fish|ps1|bat|cmd|vbs|ahk|lua|tcl|r|jl|dart|elm|purs|idr|agda|coq|lean|nim|zig|crystal|d|odin|jai|v|carbon|mojo|vala|genie|graphql|gql|proto|thrift|avro|json|yaml|yml|toml|ini|cfg|conf|env|lock|sum|md5|sha1|sha224|sha256|sha384|sha512|asc|sig|pem|crt|cer|key|pub|gpg|pgp|bz2|gz|xz|zip|tar|7z|rar|ar|cpio|zst|lz|lz4|lzo|rz|sfark|zpaq|pea|arc|exe|dll|so|dylib|o|a|lib|lo|la|obj|pdb|ilk|exp|idb|wpdb|ipdb|tlog|lastbuildstate|unsuccessfulbuild|recipe|makefile|cmake|ninja|meson|bazel|buck|pants|scons|waf|autotools|automake|autoconf|libtool|pkg-config))\b/i;
  var TECHNICAL_RE2 = /\b(\d+\.\d+\.\d+(?:-[\w.]+)?\b|\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b|\b(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}\b)/i;

  // Conditional/logical patterns: "if...then", "when...else", "only if", "unless"
  var CONDITIONAL_RE = /\b(if|when|unless|only\s?if|in\s?case|otherwise|else|then|suppose|assuming|provided\s?that|granted\s?that|given\s?that|in\s?the\s?event\s?that|should\s?it)\b/i;

  function detectInstructionType(text) {
    var t = (text || "").trim();
    if (!t) return null;

    var signals = {
      imperative: IMPERATIVE_START.test(t),
      spec: SPEC_PATTERN.test(t),
      constraint: CONSTRAINT_RE.test(t),
      modal: MODAL_RE.test(t),
      technical: TECHNICAL_RE.test(t) || TECHNICAL_RE2.test(t),
      conditional: CONDITIONAL_RE.test(t)
    };

    var hitCount = Object.values(signals).filter(Boolean).length;
    if (hitCount === 0) return null;

    if (signals.imperative && (signals.constraint || signals.technical || signals.spec)) return "critical";
    if (signals.imperative) return "instruction";
    if ((signals.spec || signals.modal) && (signals.constraint || signals.technical || signals.modal)) return "critical";
    if (signals.spec || signals.modal) return "instruction";
    if (signals.constraint || signals.technical) return "technical";
    if (signals.conditional) return "logical";

    return "contextual";
  }

  function isInstructionCritical(text) {
    var type = detectInstructionType(text);
    return type === "critical" || type === "instruction";
  }

  function instructionDensity(sentences) {
    if (!sentences || !sentences.length) return 0;
    var rawSentences = sentences.map(function (s) {
      return typeof s === "string" ? s : (s && s.text ? s.text : "");
    });
    var hits = rawSentences.filter(isInstructionCritical).length;
    return hits / rawSentences.length;
  }

  global.InstructionDetector = {
    detect: detectInstructionType,
    isCritical: isInstructionCritical,
    density: instructionDensity
  };
})(typeof window !== "undefined" ? window : this);
