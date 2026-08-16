/**
 * Token-Diet Content Script (Capsule Hub / Tally Architecture).
 *
 * Implements direct inline DOM injection onto AI chatboxes (ChatGPT, Claude,
 * Gemini, DeepSeek, Perplexity, and general web textareas).
 *
 * Universal Fidelity Architecture:
 *   - Direct inline mounting inside/adjacent to composer forms
 *   - Shadow DOM styling isolation
 *   - Fidelity Mode toggle & compression breakdown inspector
 *   - React native value tracker bypass
 */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* 1. PROVIDERS Selector Configuration (Chatbots Only)                */
  /* ------------------------------------------------------------------ */
  var PROVIDERS = {
    chatgpt: {
      name: "ChatGPT",
      domains: ["chatgpt.com", "openai.com"],
      selectors: {
        input: '#prompt-textarea, textarea[data-id="root"], div[contenteditable="true"][data-id], textarea#prompt-textarea, div[contenteditable="true"]',
        anchor: 'form:has(#prompt-textarea), #composer-background, div[class*="composer-parent"], form',
        sendButton: 'button[data-testid="send-button"], button[aria-label="Send"], button[aria-label="Send prompt"]'
      }
    },
    claude: {
      name: "Claude",
      domains: ["claude.ai"],
      selectors: {
        input: 'div[contenteditable="true"][role="textbox"], div.ProseMirror[contenteditable="true"], div[contenteditable="true"]',
        anchor: 'div[aria-label="Message Claude"], fieldset, form, div[class*="composer"]',
        sendButton: 'button[aria-label="Send Message"], button[aria-label="Send"]'
      }
    },
    gemini: {
      name: "Gemini",
      domains: ["gemini.google.com"],
      selectors: {
        input: 'rich-textarea div[contenteditable="true"], div[contenteditable="true"][role="textbox"], div[contenteditable="true"]',
        anchor: 'rich-textarea, .input-area-container, form, div[class*="chat-input"]',
        sendButton: 'button[aria-label="Send message"], button[aria-label="Send"]'
      }
    },
    deepseek: {
      name: "DeepSeek",
      domains: ["deepseek.com"],
      selectors: {
        input: '#chat-input, textarea[placeholder*="message" i], textarea[placeholder*="Ask" i], div[contenteditable="true"]',
        anchor: 'div[class*="input-box"], form, div[class*="chat-input"]',
        sendButton: 'button[class*="send"], div[class*="send"]'
      }
    },
    perplexity: {
      name: "Perplexity",
      domains: ["perplexity.ai"],
      selectors: {
        input: 'textarea[id*="input"], textarea[placeholder*="Ask" i], div[contenteditable="true"]',
        anchor: 'div[class*="search-bar"], form, div[class*="bottom-"]',
        sendButton: 'button[aria-label="Submit"], button[aria-label="Ask"]'
      }
    },
    copilot: {
      name: "Copilot",
      domains: ["copilot.microsoft.com", "bing.com"],
      selectors: {
        input: 'textarea[id*="userInput"], textarea, div[contenteditable="true"]',
        anchor: 'form, div[class*="input-area"], div[class*="composer"]',
        sendButton: 'button[aria-label*="Submit" i], button[aria-label*="Send" i]'
      }
    },
    mistral: {
      name: "Mistral",
      domains: ["mistral.ai"],
      selectors: {
        input: 'textarea, div[contenteditable="true"]',
        anchor: 'form, div[class*="chat-input"]',
        sendButton: 'button[type="submit"]'
      }
    },
    poe: {
      name: "Poe",
      domains: ["poe.com"],
      selectors: {
        input: 'textarea[class*="ChatMessageInput"], textarea',
        anchor: 'footer, form, div[class*="ChatMessageInputContainer"]',
        sendButton: 'button[class*="sendButton"]'
      }
    },
    local: {
      name: "Local AI (OpenWebUI / Ollama)",
      domains: ["localhost", "127.0.0.1", "0.0.0.0", "hf.co", "huggingface.co"],
      selectors: {
        input: '#chat-textarea, textarea[placeholder*="message" i], textarea[placeholder*="prompt" i], textarea, div[contenteditable="true"]',
        anchor: 'form, div[class*="chat-input"], div[class*="input-area"]',
        sendButton: 'button[type="submit"], button[aria-label*="Send" i]'
      }
    }
  };

  function detectProvider() {
    var host = (window.location.hostname || "").toLowerCase();
    for (var key in PROVIDERS) {
      var p = PROVIDERS[key];
      if (p.domains.some(function (d) {
        return host === d || host.endsWith("." + d) || host.indexOf(d) !== -1;
      })) {
        return key;
      }
    }
    return null;
  }

  // Only run inline toolbar on recognized AI chatbot domains
  var currentProvider = detectProvider();
  if (!currentProvider) {
    return;
  }

  if (window.__TOKEN_DIET_INLINE__) return;
  window.__TOKEN_DIET_INLINE__ = true;

  console.log("[Token-Diet] Initializing Capsule toolbar on chatbot: " + PROVIDERS[currentProvider].name);

  var settings = {
    keepFraction: 0.5,
    fidelityMode: true,
    profile: "chat-prompt",
    costPerMillion: 0.75
  };

  /* ------------------------------------------------------------------ */
  /* 2. Web Worker Asynchronous Delegation                              */
  /* ------------------------------------------------------------------ */
  var workerInstance = null;
  var workerReqId = 0;
  var workerCallbacks = {};

  function getWorker() {
    if (!workerInstance && typeof Worker !== "undefined") {
      try {
        var workerUrl = chrome.runtime.getURL("worker.js");
        workerInstance = new Worker(workerUrl);
        workerInstance.onmessage = function (e) {
          var data = e.data;
          if (data && data.type === "COMPRESS_RESULT" && workerCallbacks[data.id]) {
            var cb = workerCallbacks[data.id];
            delete workerCallbacks[data.id];
            cb(data);
          }
        };
        workerInstance.onerror = function (err) {
          console.warn("[Token-Diet] Worker error, falling back to main-thread engine:", err);
          workerInstance = null;
        };
      } catch (err) {
        console.warn("[Token-Diet] Worker unavailable:", err);
        workerInstance = null;
      }
    }
    return workerInstance;
  }

  function compressTextAsync(rawText, query, opts, callback) {
    var worker = getWorker();
    if (worker) {
      var reqId = ++workerReqId;
      var timeout = setTimeout(function () {
        if (workerCallbacks[reqId]) {
          delete workerCallbacks[reqId];
          if (typeof window.TokenDiet !== "undefined" && window.TokenDiet.compress) {
            var res = window.TokenDiet.compress(rawText, query, opts);
            callback(res);
          }
        }
      }, 2500);

      workerCallbacks[reqId] = function (data) {
        clearTimeout(timeout);
        if (data.success && data.result) {
          callback(data.result);
        } else if (typeof window.TokenDiet !== "undefined" && window.TokenDiet.compress) {
          var res = window.TokenDiet.compress(rawText, query, opts);
          callback(res);
        } else {
          callback({ compressed: rawText, tokensSaved: 0, error: data.error });
        }
      };

      worker.postMessage({
        type: "COMPRESS",
        id: reqId,
        text: rawText,
        query: query,
        keepFraction: opts.keepFraction,
        model: opts.model,
        fidelityMode: opts.fidelityMode,
        profile: opts.profile,
        costPerMillion: opts.costPerMillion
      });
    } else if (typeof window.TokenDiet !== "undefined" && window.TokenDiet.compress) {
      var res = window.TokenDiet.compress(rawText, query, opts);
      callback(res);
    } else {
      callback({ compressed: rawText, tokensSaved: 0, error: "Engine not loaded" });
    }
  }

  function findTextBox() {
    var p = PROVIDERS[currentProvider];
    if (!p) return null;
    return document.querySelector(p.selectors.input);
  }

  function findAnchor(textBox) {
    if (!textBox) return null;
    var p = PROVIDERS[currentProvider];
    if (!p) return null;

    var form = textBox.closest("form");
    if (form) return form;

    if (p.selectors.anchor) {
      var specific = textBox.closest(p.selectors.anchor);
      if (specific) return specific;
    }

    return textBox.parentElement || textBox;
  }

  /* ------------------------------------------------------------------ */
  /* 3. Shadow DOM Toolbar UI Styles & Component                        */
  /* ------------------------------------------------------------------ */
  var SCISSORS_ICON =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88"/><path d="M14.47 14.48 20 20"/><path d="M8.12 8.12 12 12"/></svg>';

  var SHADOW_STYLES = [
    ":host { all: initial; display: block; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; font-size: 11px; color: #ededf0; overflow: visible !important; }",
    ".td-bar { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; margin: 4px 0; background: #121216; border: 1px solid #2a2a36; border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,0.45); z-index: 999999; flex-wrap: wrap; position: relative; overflow: visible !important; }",
    ".td-btn { display: inline-flex; align-items: center; gap: 5px; background: transparent; border: none; color: #ededf0; font-weight: 600; font-size: 11px; cursor: pointer; padding: 3px 6px; border-radius: 5px; transition: background 0.15s ease, color 0.15s ease; }",
    ".td-btn:hover { background: rgba(255,255,255,0.08); color: #ffffff; }",
    ".td-btn:active { transform: scale(0.97); }",
    ".td-btn svg { color: #34d399; }",
    ".td-btn.loading svg { animation: td-spin 1s linear infinite; }",
    "@keyframes td-spin { 100% { transform: rotate(360deg); } }",
    ".td-badge { background: rgba(52,211,153,0.15); color: #34d399; border: 1px solid rgba(52,211,153,0.3); font-size: 9px; font-weight: 600; padding: 1px 5px; border-radius: 4px; font-family: ui-monospace, monospace; }",
    ".td-levels { display: flex; gap: 2px; background: #08080a; border: 1px solid #1e1e26; border-radius: 6px; padding: 2px; }",
    ".td-lvl-btn { border: none; background: transparent; color: #8a8a9e; font-size: 9px; font-weight: 600; padding: 2px 5px; border-radius: 4px; cursor: pointer; font-family: ui-monospace, monospace; }",
    ".td-lvl-btn.active { background: rgba(255,255,255,0.14); color: #ffffff; }",
    ".td-dropdown { position: relative; display: inline-flex; align-items: center; overflow: visible !important; }",
    ".td-dropdown-btn { display: inline-flex; align-items: center; gap: 4px; background: #08080a; border: 1px solid #1e1e26; border-radius: 6px; color: #ededf0; font-size: 9.5px; font-weight: 600; padding: 2px 6px; cursor: pointer; outline: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease; user-select: none; }",
    ".td-dropdown-btn:hover { border-color: #34d399; background: #14141a; color: #ffffff; }",
    ".td-dropdown.open .td-dropdown-btn { border-color: #34d399; background: #14141a; box-shadow: 0 0 0 2px rgba(52,211,153,0.18); }",
    ".td-dropdown-arrow { color: #8a8a9e; transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), color 0.15s ease; }",
    ".td-dropdown.open .td-dropdown-arrow { transform: rotate(180deg); color: #34d399; }",
    ".td-dropdown-menu { position: absolute; top: calc(100% + 4px); left: 0; min-width: 160px; background: #0e0e13; border: 1px solid #282836; border-radius: 8px; box-shadow: 0 12px 32px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.08); padding: 4px; z-index: 2147483647; display: none; flex-direction: column; gap: 2px; backdrop-filter: blur(16px); animation: td-dropdown-pop 0.15s cubic-bezier(0.16, 1, 0.3, 1); }",
    ".td-dropdown.open .td-dropdown-menu { display: flex !important; visibility: visible !important; opacity: 1 !important; }",
    "@keyframes td-dropdown-pop { from { opacity: 0; transform: translateY(-4px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }",
    ".td-dropdown-item { display: flex; flex-direction: column; padding: 5px 8px; border-radius: 6px; cursor: pointer; transition: background 0.12s ease; background: transparent; user-select: none; }",
    ".td-dropdown-item:hover { background: rgba(255,255,255,0.08); }",
    ".td-dropdown-item.active { background: rgba(52,211,153,0.14); }",
    ".td-item-top { display: flex; align-items: center; justify-content: space-between; }",
    ".td-item-title { font-size: 10px; font-weight: 600; color: #ededf0; }",
    ".td-dropdown-item.active .td-item-title { color: #34d399; }",
    ".td-item-check { color: #34d399; display: none; }",
    ".td-dropdown-item.active .td-item-check { display: block; }",
    ".td-item-sub { font-size: 8px; color: #717182; margin-top: 1px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }",
    ".td-dropdown-item.active .td-item-sub { color: #a7f3d0; }",
    ".td-fidelity { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; color: #8a8a9e; cursor: pointer; user-select: none; margin-left: 2px; }",
    ".td-fidelity input { margin: 0; cursor: pointer; accent-color: #34d399; }",
    ".td-action { border: none; background: transparent; color: #8a8a9e; font-size: 10px; cursor: pointer; padding: 2px 5px; border-radius: 4px; }",
    ".td-action:hover { color: #ffffff; }",
    ".td-action.undo { color: #34d399; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }",
    ".td-breakdown { margin-top: 6px; padding: 8px; background: #0a0a0d; border: 1px solid #1e1e26; border-radius: 6px; max-height: 240px; overflow-y: auto; font-size: 10px; }",
    ".td-breakdown-header { display: flex; align-items: center; justify-content: space-between; font-weight: 600; color: #ededf0; margin-bottom: 6px; }",
    ".td-tabs { display: flex; gap: 4px; border-bottom: 1px solid #1e1e26; padding-bottom: 4px; margin-bottom: 6px; }",
    ".td-tab-btn { background: transparent; border: none; color: #8a8a9e; font-size: 9px; font-weight: 600; padding: 2px 6px; border-radius: 4px; cursor: pointer; }",
    ".td-tab-btn.active { background: rgba(255,255,255,0.12); color: #34d399; }",
    ".td-tab-panel { display: none; }",
    ".td-tab-panel.active { display: block; }",
    ".td-diff-view { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 10px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; padding: 6px; background: #060608; border-radius: 4px; border: 1px solid #181820; max-height: 160px; overflow-y: auto; }",
    ".td-diff-ctx { color: #c0c0d0; }",
    ".td-diff-del { background: rgba(239,68,68,0.22); color: #f87171; text-decoration: line-through; border-radius: 2px; padding: 0 1px; }",
    ".td-diff-add { background: rgba(52,211,153,0.22); color: #34d399; border-radius: 2px; padding: 0 1px; }",
    ".td-breakdown-section { margin-bottom: 6px; }",
    ".td-breakdown-label { display: block; color: #8a8a9e; margin-bottom: 2px; }",
    ".td-breakdown-label.td-dropped { color: #ef4444; }",
    ".td-breakdown-list { display: flex; flex-direction: column; gap: 2px; }",
    ".td-breakdown-item { padding: 2px 4px; border-radius: 3px; color: #a0a0b0; word-break: break-word; }",
    ".td-dropped-item { opacity: 0.6; text-decoration: line-through; }"
  ].join("\n");

  var lastUndoState = null;

  function createToolbarElement(targetInput) {
    var host = document.createElement("div");
    host.id = "token-diet-toolbar-host";
    host.setAttribute("data-token-diet", "true");

    var shadow = host.attachShadow({ mode: "open" });
    var style = document.createElement("style");
    style.textContent = SHADOW_STYLES;
    shadow.appendChild(style);

    var bar = document.createElement("div");
    bar.className = "td-bar";
    bar.innerHTML =
      '<button class="td-btn" type="button" id="td-compress-btn">' +
      SCISSORS_ICON +
      '<span>Diet-Token</span>' +
      '</button>' +
      '<span class="td-badge" id="td-stat-badge" style="display:none;"></span>' +
      '<div class="td-levels">' +
      '<button class="td-lvl-btn" type="button" data-level="0.6" title="Light Compression (60% kept)">L</button>' +
      '<button class="td-lvl-btn active" type="button" data-level="0.5" title="Balanced Compression (50% kept)">B</button>' +
      '<button class="td-lvl-btn" type="button" data-level="0.25" title="Aggressive Compression (25% kept)">A</button>' +
      '</div>' +
      '<div class="td-dropdown" id="td-dropdown">' +
      '<button class="td-dropdown-btn" type="button" id="td-dropdown-btn" title="Compression Profile">' +
      '<span id="td-dropdown-label">Chat</span>' +
      '<svg class="td-dropdown-arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
      '</button>' +
      '<div class="td-dropdown-menu" id="td-dropdown-menu">' +
      '<div class="td-dropdown-item" data-value="chat-prompt">' +
      '<div class="td-item-top"><span class="td-item-title">Chat</span><svg class="td-item-check" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>' +
      '<span class="td-item-sub">Conversational filler strip</span>' +
      '</div>' +
      '<div class="td-dropdown-item" data-value="code-review">' +
      '<div class="td-item-top"><span class="td-item-title">Code</span><svg class="td-item-check" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>' +
      '<span class="td-item-sub">Paths, lines, hex &amp; syntax</span>' +
      '</div>' +
      '<div class="td-dropdown-item" data-value="legal-compliance">' +
      '<div class="td-item-top"><span class="td-item-title">Legal</span><svg class="td-item-check" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>' +
      '<span class="td-item-sub">Clauses, dates &amp; strict terms</span>' +
      '</div>' +
      '<div class="td-dropdown-item" data-value="rag-context">' +
      '<div class="td-item-top"><span class="td-item-title">RAG</span><svg class="td-item-check" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>' +
      '<span class="td-item-sub">Aggressive multi-chunk MMR</span>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<label class="td-fidelity">' +
      '<input type="checkbox" id="td-fidelity-toggle" ' + (settings.fidelityMode ? 'checked' : '') + '>' +
      '<span>Fidelity</span>' +
      '</label>' +
      '<button class="td-action undo" type="button" id="td-undo-btn" style="display:none;">Undo</button>';

    shadow.appendChild(bar);

    // Tabbed breakdown panel
    var breakdown = document.createElement("div");
    breakdown.className = "td-breakdown";
    breakdown.id = "td-breakdown";
    breakdown.style.display = "none";
    breakdown.innerHTML =
      '<div class="td-breakdown-header">' +
      '<span>Compression Inspector</span>' +
      '<div class="td-tabs">' +
      '<button class="td-tab-btn active" type="button" data-tab="diff">Diff</button>' +
      '<button class="td-tab-btn" type="button" data-tab="kept">Kept</button>' +
      '<button class="td-tab-btn" type="button" data-tab="dropped">Dropped</button>' +
      '</div>' +
      '</div>' +
      '<div class="td-tab-panel active" id="td-panel-diff">' +
      '<div class="td-diff-view" id="td-diff-content"></div>' +
      '</div>' +
      '<div class="td-tab-panel" id="td-panel-kept">' +
      '<div id="td-kept-list" class="td-breakdown-list"></div>' +
      '</div>' +
      '<div class="td-tab-panel" id="td-panel-dropped">' +
      '<div id="td-dropped-list" class="td-breakdown-list"></div>' +
      '</div>';
    shadow.appendChild(breakdown);

    // Tab switching
    shadow.querySelectorAll(".td-tab-btn").forEach(function (tabBtn) {
      tabBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var tab = tabBtn.getAttribute("data-tab");
        shadow.querySelectorAll(".td-tab-btn").forEach(function (b) {
          b.classList.toggle("active", b === tabBtn);
        });
        shadow.querySelectorAll(".td-tab-panel").forEach(function (p) {
          p.classList.toggle("active", p.id === "td-panel-" + tab);
        });
      });
    });

    // Prevent clicking buttons from stealing focus or submitting forms
    shadow.querySelectorAll("button, input").forEach(function (el) {
      el.addEventListener("mousedown", function (e) {
        e.stopPropagation();
      });
    });

    var compressBtn = shadow.getElementById("td-compress-btn");
    var statBadge = shadow.getElementById("td-stat-badge");
    var undoBtn = shadow.getElementById("td-undo-btn");
    var fidelityToggle = shadow.getElementById("td-fidelity-toggle");
    
    // Custom Profile Dropdown Logic
    var dropdown = shadow.getElementById("td-dropdown");
    var dropdownBtn = shadow.getElementById("td-dropdown-btn");
    var dropdownMenu = shadow.getElementById("td-dropdown-menu");
    var dropdownLabel = shadow.getElementById("td-dropdown-label");
    var dropdownItems = shadow.querySelectorAll(".td-dropdown-item");

    var profileLabels = {
      "chat-prompt": "Chat",
      "code-review": "Code",
      "legal-compliance": "Legal",
      "rag-context": "RAG"
    };

    function updateProfileUI(val) {
      settings.profile = val;
      if (dropdownLabel) {
        dropdownLabel.textContent = profileLabels[val] || "Chat";
      }
      dropdownItems.forEach(function (item) {
        item.classList.toggle("active", item.getAttribute("data-value") === val);
      });
    }

    updateProfileUI(settings.profile || "chat-prompt");

    dropdownBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var isOpen = dropdown.classList.contains("open");
      if (isOpen) {
        dropdown.classList.remove("open");
        dropdownMenu.style.display = "none";
      } else {
        dropdown.classList.add("open");
        dropdownMenu.style.display = "flex";
      }
    });

    dropdownItems.forEach(function (item) {
      item.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var val = item.getAttribute("data-value");
        updateProfileUI(val);
        chrome.storage.local.set({ profile: settings.profile });
        dropdown.classList.remove("open");
        dropdownMenu.style.display = "none";
      });
    });

    // Close dropdown on outside click
    document.addEventListener("click", function (e) {
      if (dropdown && !dropdown.contains(e.target) && e.target !== host) {
        dropdown.classList.remove("open");
        dropdownMenu.style.display = "none";
      }
    });
    shadow.addEventListener("click", function (e) {
      if (dropdown && !dropdown.contains(e.target)) {
        dropdown.classList.remove("open");
        dropdownMenu.style.display = "none";
      }
    });

    fidelityToggle.addEventListener("change", function (e) {
      settings.fidelityMode = e.target.checked;
      chrome.storage.local.set({ fidelityMode: settings.fidelityMode });
      if (!settings.fidelityMode) {
        breakdown.style.display = "none";
      }
    });

    compressBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var input = findTextBox();
      if (!input) return;
      handleCompress(input, shadow);
    });

    undoBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var input = findTextBox();
      if (!input || !lastUndoState) return;
      writeTextToField(input, lastUndoState.text);
      lastUndoState = null;
      undoBtn.style.display = "none";
      statBadge.style.display = "none";
      breakdown.style.display = "none";
    });

    shadow.querySelectorAll(".td-lvl-btn").forEach(function (lvlBtn) {
      lvlBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var val = parseFloat(lvlBtn.getAttribute("data-level"));
        settings.keepFraction = val;
        shadow.querySelectorAll(".td-lvl-btn").forEach(function (b) {
          b.classList.toggle("active", b === lvlBtn);
        });
        chrome.storage.local.set({ keepFraction: val });
      });
    });

    return host;
  }

  /* ------------------------------------------------------------------ */
  /* 4. React Native Value Setter & Text Extraction                     */
  /* ------------------------------------------------------------------ */
  function getFieldText(element) {
    if (!element) return "";
    if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
      return element.value || "";
    }
    return element.innerText || element.textContent || "";
  }

  function writeTextToField(element, text) {
    if (!element) return;
    element.focus();

    if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
      var proto = element.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, "value");
      if (setter && setter.set) {
        setter.set.call(element, text);
      } else {
        element.value = text;
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (element.isContentEditable || element.getAttribute("contenteditable") === "true") {
      var sel = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(element);
      sel.removeAllRanges();
      sel.addRange(range);

      var success = document.execCommand("insertText", false, text);
      if (!success) {
        element.innerText = text;
        element.dispatchEvent(new InputEvent("input", {
          inputType: "insertText",
          data: text,
          bubbles: true,
          cancelable: false,
          composed: true
        }));
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function handleCompress(inputElement, shadow) {
    var compressBtn = shadow ? shadow.getElementById("td-compress-btn") : null;
    var statBadge = shadow ? shadow.getElementById("td-stat-badge") : null;
    var undoBtn = shadow ? shadow.getElementById("td-undo-btn") : null;
    var breakdown = shadow ? shadow.getElementById("td-breakdown") : null;
    var diffContent = shadow ? shadow.getElementById("td-diff-content") : null;
    var keptList = shadow ? shadow.getElementById("td-kept-list") : null;
    var droppedList = shadow ? shadow.getElementById("td-dropped-list") : null;

    var rawText = getFieldText(inputElement).trim();
    if (!rawText || rawText.length < 20) {
      if (statBadge) {
        statBadge.textContent = "Too short";
        statBadge.style.display = "inline";
        setTimeout(function () { statBadge.style.display = "none"; }, 2000);
      }
      return;
    }

    if (compressBtn) {
      compressBtn.classList.add("loading");
    }

    compressTextAsync(
      rawText,
      "",
      {
        keepFraction: settings.keepFraction,
        fidelityMode: settings.fidelityMode,
        profile: settings.profile,
        costPerMillion: settings.costPerMillion
      },
      function (res) {
        if (compressBtn) {
          compressBtn.classList.remove("loading");
        }

        if (!res.compressed || res.tokensSaved <= 0) {
          if (statBadge) {
            statBadge.textContent = "Already dense";
            statBadge.style.display = "inline";
            setTimeout(function () { statBadge.style.display = "none"; }, 2000);
          }
          return;
        }

        lastUndoState = { text: rawText, element: inputElement };
        writeTextToField(inputElement, res.compressed);

        if (statBadge) {
          var pct = Math.round(res.compressionRatio * 100);
          statBadge.textContent = "-" + pct + "% (" + res.tokensSaved + " tok)";
          statBadge.style.display = "inline";
        }

        if (undoBtn) {
          undoBtn.style.display = "inline";
        }

        if (settings.fidelityMode && breakdown) {
          // Word-level diff
          if (diffContent && window.Diff && window.Diff.diffWords) {
            var diff = window.Diff.diffWords(rawText, res.compressed);
            diffContent.innerHTML = window.Diff.renderDiffHtml(diff);
          }

          if (keptList) {
            keptList.innerHTML = (res.keptSentences || []).map(function (s) {
              var type = window.InstructionDetector ? window.InstructionDetector.detect(s) : null;
              var icon = type === "critical" ? "🔴" : type === "instruction" ? "🟡" : "🟢";
              return '<div class="td-breakdown-item">' + icon + ' ' + s.substring(0, 80) + (s.length > 80 ? '...' : '') + '</div>';
            }).join("");
          }

          if (droppedList) {
            var dropped = (res.droppedByScore || []).concat(res.droppedByRedundancy || []);
            droppedList.innerHTML = dropped.map(function (s) {
              return '<div class="td-breakdown-item td-dropped-item">' + s.substring(0, 80) + (s.length > 80 ? '...' : '') + '</div>';
            }).join("");
          }

          breakdown.style.display = "block";
        } else if (breakdown) {
          breakdown.style.display = "none";
        }
      }
    );
  }

  /* ------------------------------------------------------------------ */
  /* 5. Active In-Page Injection Loop & MutationObserver                */
  /* ------------------------------------------------------------------ */
  function ensureToolbarInjected() {
    var textBox = findTextBox();
    if (!textBox) return;

    var existing = document.getElementById("token-diet-toolbar-host");
    var anchor = findAnchor(textBox);

    if (existing) {
      if (anchor && !anchor.parentNode.contains(existing)) {
        anchor.parentNode.insertBefore(existing, anchor);
      }
      return;
    }

    if (anchor && anchor.parentNode) {
      var toolbar = createToolbarElement(textBox);
      anchor.parentNode.insertBefore(toolbar, anchor);
      console.log("[Token-Diet] Toolbar mounted above anchor:", anchor);
    }
  }

  ensureToolbarInjected();
  var pollInterval = setInterval(ensureToolbarInjected, 1000);

  var debounceTimer = null;
  var observer = new MutationObserver(function () {
    if (debounceTimer) return;
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      ensureToolbarInjected();
    }, 200);
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  /* ------------------------------------------------------------------ */
  /* 6. Chrome Storage & Shortcut Listeners                             */
  /* ------------------------------------------------------------------ */
  chrome.storage.local.get(["keepFraction", "fidelityMode", "profile", "costPerMillion"], function (st) {
    if (st.keepFraction != null) settings.keepFraction = st.keepFraction;
    if (st.fidelityMode != null) settings.fidelityMode = st.fidelityMode;
    if (st.profile != null) settings.profile = st.profile;
    if (st.costPerMillion != null) settings.costPerMillion = st.costPerMillion;
  });

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "COMPRESS_FOCUSED" || msg.type === "COMPRESS_SELECTION") {
      var input = findTextBox() || document.activeElement;
      if (input) {
        var toolbar = document.getElementById("token-diet-toolbar-host");
        var shadow = toolbar ? toolbar.shadowRoot : null;
        handleCompress(input, shadow);
      }
      sendResponse({ ok: true });
    }
  });

})();