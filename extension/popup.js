/**
 * Token-Diet popup — compact stats panel.
 * The main compression flow happens in-page (content script button inside
 * the text box); this popup is only for quick paste-and-compress with stats.
 */
(function () {
  "use strict";

  var engine = window.TokenDiet;
  if (!engine) return;

  var settings = Object.assign({}, engine.DEFAULTS);

  var els = {
    ratio: document.getElementById("hero-ratio"),
    donutFill: document.getElementById("donut-fill"),
    donutCenter: document.getElementById("donut-center"),
    statTokens: document.getElementById("stat-tokens"),
    statLatency: document.getElementById("stat-latency"),
    statCost: document.getElementById("stat-cost"),
    segs: Array.prototype.slice.call(document.querySelectorAll(".seg")),
    segProfiles: Array.prototype.slice.call(document.querySelectorAll(".seg-p")),
    query: document.getElementById("input-query"),
    text: document.getElementById("input-text"),
    btnCompress: document.getElementById("btn-compress"),
    resultCard: document.getElementById("result-card"),
    resultText: document.getElementById("result-text"),
    resultMeta: document.getElementById("result-meta"),
    btnCopy: document.getElementById("btn-copy"),
    toast: document.getElementById("toast"),
    toastMsg: document.getElementById("toast-msg")
  };

  var toastTimer = null;

  /* ---------------- settings ---------------- */
  chrome.storage.local.get(null, function (stored) {
    if (stored.profile != null) setProfile(stored.profile, false);
    if (stored.keepFraction != null) setKeepFraction(stored.keepFraction, false);
    if (stored.costPerMillion != null) settings.costPerMillion = stored.costPerMillion;
  });

  function setProfile(profileKey, persist) {
    settings.profile = profileKey;
    els.segProfiles.forEach(function (b) {
      b.classList.toggle("active", b.dataset.profile === profileKey);
    });
    if (persist) chrome.storage.local.set({ profile: profileKey });
  }

  els.segProfiles.forEach(function (btn) {
    btn.addEventListener("click", function () {
      setProfile(btn.dataset.profile, true);
    });
  });

  function setKeepFraction(fraction, persist) {
    settings.keepFraction = fraction;
    els.segs.forEach(function (b) {
      b.classList.toggle("active", Number(b.dataset.keep) === fraction);
    });
    if (persist) chrome.storage.local.set({ keepFraction: fraction });
  }

  els.segs.forEach(function (btn) {
    btn.addEventListener("click", function () {
      setKeepFraction(Number(btn.dataset.keep), true);
    });
  });

  els.query.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); runCompression(); }
  });

  /* ---------------- compression ---------------- */
  els.btnCompress.addEventListener("click", runCompression);

  function runCompression() {
    var text = els.text.value.trim();
    if (!text) {
      showToast("Paste some context to compress first.");
      els.text.focus();
      return;
    }
    var query = els.query.value.trim();
    var t0 = performance.now();
    var res = engine.compress(text, query, {
      profile: settings.profile || "chat-prompt",
      keepFraction: settings.keepFraction,
      costPerMillion: settings.costPerMillion
    });
    var uiMs = performance.now() - t0;

    var pct = Math.round(res.compressionRatio * 100);

    els.ratio.textContent = res.originalTokens ? pct + "%" : "—";
    els.donutCenter.textContent = res.originalTokens ? pct + "%" : "—";

    var C = 150.8;
    var frac = res.originalTokens ? 1 - res.compressionRatio : 1;
    els.donutFill.style.strokeDasharray = C + " " + C;
    els.donutFill.style.strokeDashoffset = C * (1 - frac);

    els.statTokens.textContent = res.originalTokens + "→" + res.compressedTokens;
    els.statLatency.textContent = "-" + res.latencyDropMs + "ms";
    els.statCost.textContent = "$" + res.costSaved.toFixed(4);

    els.resultCard.hidden = false;
    els.resultText.textContent = res.keptSentences.length
      ? res.keptSentences.join(" ")
      : "Nothing worth keeping — your text was already dense.";
    els.resultText.style.color = res.keptSentences.length ? "" : "#8a8a9e";
    els.resultMeta.textContent =
      pct + "% · " + res.tokensSaved + " tok · " + uiMs.toFixed(1) + " ms";
  }

  /* ---------------- actions ---------------- */
  els.btnCopy.addEventListener("click", function () {
    var text = els.resultText.textContent;
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(function () { showToast("Copied compressed context."); })
      .catch(function () { showToast("Copy failed — select the text manually."); });
  });

  /* ---------------- toast ---------------- */
  function showToast(msg) {
    els.toastMsg.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, 2400);
  }
})();