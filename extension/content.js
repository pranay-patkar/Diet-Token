/**
 * Token-Diet Content Script (Capsule Hub / Tally Architecture).
 *
 * Implements direct inline DOM injection onto AI chatboxes (ChatGPT, Claude,
 * Gemini, DeepSeek, Perplexity, and general web textareas).
 *
 * Pattern:
 *   1. PROVIDERS map with robust fallback selector chains
 *   2. Active DOM mounting directly inside/adjacent to composer form
 *   3. Polling + Debounced MutationObserver for SPA navigation resilience
 *   4. Shadow DOM to prevent host CSS conflicts (Tailwind / reset resets)
 *   5. React Native Setter bypass for controlled inputs
 */

(function () {
  "use strict";

  if (window.__TOKEN_DIET_INLINE__) return;
  window.__TOKEN_DIET_INLINE__ = true;

  console.log("[Token-Diet] Initializing Capsule-style inline toolbar...");

  var settings = { keepFraction: 0.4, costPerMillion: 0.75 };

  /* ------------------------------------------------------------------ */
  /* 1. PROVIDERS Selector Configuration                                */
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
    generic: {
      name: "Generic",
      domains: [],
      selectors: {
        input: 'textarea, div[contenteditable="true"][role="textbox"], div[contenteditable="true"]',
        anchor: 'form, div[class*="input"], div[class*="chat"], div[class*="comment"]',
        sendButton: 'button[type="submit"], button[aria-label*="Send" i]'
      }
    }
  };

  function detectProvider() {
    var host = window.location.hostname || "";
    for (var key in PROVIDERS) {
      if (key === "generic") continue;
      var p = PROVIDERS[key];
      if (p.domains.some(function (d) { return host.indexOf(d) !== -1; })) {
        return key;
      }
    }
    return "generic";
  }

  function findTextBox() {
    var providerKey = detectProvider();
    var p = PROVIDERS[providerKey];
    var el = document.querySelector(p.selectors.input);
    if (!el && providerKey !== "generic") {
      el = document.querySelector(PROVIDERS.generic.selectors.input);
    }
    return el;
  }

  function findAnchor(textBox) {
    if (!textBox) return null;
    var providerKey = detectProvider();
    var p = PROVIDERS[providerKey];

    var form = textBox.closest("form");
    if (form) return form;

    if (p.selectors.anchor) {
      var specific = textBox.closest(p.selectors.anchor);
      if (specific) return specific;
    }

    return textBox.parentElement || textBox;
  }

  /* ------------------------------------------------------------------ */
  /* 2. Shadow DOM Toolbar UI Styles & Component                        */
  /* ------------------------------------------------------------------ */
  var SCISSORS_ICON =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88"/><path d="M14.47 14.48 20 20"/><path d="M8.12 8.12 12 12"/></svg>';

  var SHADOW_STYLES = [
    ":host { all: initial; display: block; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; font-size: 11px; color: #ededf0; }",
    ".td-bar { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; margin: 4px 0; background: #121216; border: 1px solid #2a2a36; border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,0.45); z-index: 999999; }",
    ".td-btn { display: inline-flex; align-items: center; gap: 5px; background: transparent; border: none; color: #ededf0; font-weight: 600; font-size: 11px; cursor: pointer; padding: 3px 6px; border-radius: 5px; transition: background 0.15s ease, color 0.15s ease; }",
    ".td-btn:hover { background: rgba(255,255,255,0.08); color: #ffffff; }",
    ".td-btn:active { transform: scale(0.97); }",
    ".td-btn svg { color: #34d399; }",
    ".td-badge { background: rgba(52,211,153,0.15); color: #34d399; border: 1px solid rgba(52,211,153,0.3); font-size: 9px; font-weight: 600; padding: 1px 5px; border-radius: 4px; font-family: ui-monospace, monospace; }",
    ".td-levels { display: flex; gap: 2px; background: #08080a; border: 1px solid #1e1e26; border-radius: 6px; padding: 2px; }",
    ".td-lvl-btn { border: none; background: transparent; color: #8a8a9e; font-size: 9px; font-weight: 600; padding: 2px 5px; border-radius: 4px; cursor: pointer; font-family: ui-monospace, monospace; }",
    ".td-lvl-btn.active { background: rgba(255,255,255,0.14); color: #ffffff; }",
    ".td-action { border: none; background: transparent; color: #8a8a9e; font-size: 10px; cursor: pointer; padding: 2px 5px; border-radius: 4px; }",
    ".td-action:hover { color: #ffffff; }",
    ".td-action.undo { color: #34d399; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }"
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
      '<button class="td-lvl-btn" type="button" data-level="0.6" title="Light Compression">L</button>' +
      '<button class="td-lvl-btn active" type="button" data-level="0.4" title="Balanced Compression">B</button>' +
      '<button class="td-lvl-btn" type="button" data-level="0.25" title="Aggressive Compression">A</button>' +
      '</div>' +
      '<button class="td-action undo" type="button" id="td-undo-btn" style="display:none;">Undo</button>';

    shadow.appendChild(bar);

    // Prevent clicking our buttons from stealing focus or submitting forms
    shadow.querySelectorAll("button").forEach(function (btn) {
      btn.addEventListener("mousedown", function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    var compressBtn = shadow.getElementById("td-compress-btn");
    var statBadge = shadow.getElementById("td-stat-badge");
    var undoBtn = shadow.getElementById("td-undo-btn");

    compressBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var input = findTextBox();
      if (!input) return;
      handleCompress(input, statBadge, undoBtn);
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
  /* 3. React Native Value Setter & Text Extraction                     */
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
      // Select entire content and execute native replacement
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

  function handleCompress(inputElement, badgeEl, undoEl) {
    var rawText = getFieldText(inputElement).trim();
    if (!rawText || rawText.length < 20) {
      if (badgeEl) {
        badgeEl.textContent = "Too short";
        badgeEl.style.display = "inline";
        setTimeout(function () { badgeEl.style.display = "none"; }, 2000);
      }
      return;
    }

    if (typeof window.TokenDiet === "undefined" || !window.TokenDiet.compress) {
      console.warn("[Token-Diet] engine.js is not loaded on window.");
      return;
    }

    var res = window.TokenDiet.compress(rawText, "", {
      keepFraction: settings.keepFraction,
      costPerMillion: settings.costPerMillion
    });

    if (!res.compressed || res.tokensSaved <= 0) {
      if (badgeEl) {
        badgeEl.textContent = "Already dense";
        badgeEl.style.display = "inline";
        setTimeout(function () { badgeEl.style.display = "none"; }, 2000);
      }
      return;
    }

    lastUndoState = { text: rawText, element: inputElement };
    writeTextToField(inputElement, res.compressed);

    if (badgeEl) {
      var pct = Math.round(res.compressionRatio * 100);
      badgeEl.textContent = "-" + pct + "% (" + res.tokensSaved + " tok)";
      badgeEl.style.display = "inline";
    }

    if (undoEl) {
      undoEl.style.display = "inline";
    }
  }

  /* ------------------------------------------------------------------ */
  /* 4. Active In-Page Injection Loop & MutationObserver                */
  /* ------------------------------------------------------------------ */
  function ensureToolbarInjected() {
    var textBox = findTextBox();
    if (!textBox) return;

    var existing = document.getElementById("token-diet-toolbar-host");
    var anchor = findAnchor(textBox);

    if (existing) {
      // If toolbar exists but got detached or moved out of the current form/anchor
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

  // Strategy A: Immediate and interval polling for SPA dynamic mount
  ensureToolbarInjected();
  var pollInterval = setInterval(ensureToolbarInjected, 1000);

  // Strategy B: MutationObserver on document.body to react instantly to SPA re-renders
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
  /* 5. Chrome Storage & Shortcut Listeners                             */
  /* ------------------------------------------------------------------ */
  chrome.storage.local.get(["keepFraction", "costPerMillion"], function (st) {
    if (st.keepFraction != null) settings.keepFraction = st.keepFraction;
    if (st.costPerMillion != null) settings.costPerMillion = st.costPerMillion;
  });

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "COMPRESS_FOCUSED" || msg.type === "COMPRESS_SELECTION") {
      var input = findTextBox() || document.activeElement;
      if (input) {
        var toolbar = document.getElementById("token-diet-toolbar-host");
        var shadow = toolbar ? toolbar.shadowRoot : null;
        var badge = shadow ? shadow.getElementById("td-stat-badge") : null;
        var undo = shadow ? shadow.getElementById("td-undo-btn") : null;
        handleCompress(input, badge, undo);
      }
      sendResponse({ ok: true });
    }
  });

})();