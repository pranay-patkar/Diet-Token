/**
 * PromptTrim Content Script (Capsule Hub / Tally Architecture).
 *
 * Implements direct inline DOM injection onto AI chatboxes (ChatGPT, Claude,
 * Gemini, DeepSeek, Perplexity, and general web textareas).
 *
 * Universal Fidelity Architecture:
 *   - Direct inline mounting inside/adjacent to composer forms
 *   - Shadow DOM styling isolation
 *   - Fidelity Mode toggle & inline paste confirmation toast
 *   - React native value tracker bypass
 */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* 1. PROVIDERS Selector Configuration (All Major AI Chatbots)       */
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
      domains: ["claude.ai", "anthropic.com"],
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
        input: 'div.ql-editor[contenteditable="true"], rich-textarea div[contenteditable="true"], textarea',
        anchor: 'input-area-v2, .input-area-container, .bottom-container, chat-window',
        sendButton: 'button.send-button, button[aria-label="Send message"]'
      }
    },
    aistudio: {
      name: "Google AI Studio",
      domains: ["aistudio.google.com"],
      selectors: {
        input: 'textarea.ms-TextArea-field, textarea, div[contenteditable="true"]',
        anchor: '.prompt-box, .chat-input, form, div.editor-container',
        sendButton: 'button[aria-label="Run"], button.run-button'
      }
    },
    deepseek: {
      name: "DeepSeek",
      domains: ["deepseek.com"],
      selectors: {
        input: 'textarea[placeholder*="DeepSeek"], textarea#chat-input, textarea',
        anchor: 'div[class*="chat-input"], form',
        sendButton: 'div[role="button"][aria-label="Send"], button[class*="send"]'
      }
    },
    perplexity: {
      name: "Perplexity",
      domains: ["perplexity.ai"],
      selectors: {
        input: 'textarea[placeholder*="Ask"], textarea[placeholder*="Search"], textarea',
        anchor: 'div[class*="bottom-0"], div[class*="search-bar"], form',
        sendButton: 'button[aria-label="Submit"]'
      }
    },
    copilot: {
      name: "Copilot",
      domains: ["copilot.microsoft.com", "bing.com"],
      selectors: {
        input: 'textarea#userInput, textarea[placeholder*="Message"], textarea, div[contenteditable="true"]',
        anchor: 'form, div[class*="input-container"], .cib-serp-main',
        sendButton: 'button[aria-label="Submit"], button[title="Submit"]'
      }
    },
    poe: {
      name: "Poe",
      domains: ["poe.com"],
      selectors: {
        input: 'textarea[class*="ChatMessageInput_textInput"], textarea',
        anchor: 'footer, form',
        sendButton: 'button[class*="ChatMessageSendButton_sendButton"]'
      }
    },
    mistral: {
      name: "Mistral",
      domains: ["mistral.ai"],
      selectors: {
        input: 'textarea[placeholder*="Ask"], textarea, div[contenteditable="true"]',
        anchor: 'form, div[class*="chat-input"]',
        sendButton: 'button[type="submit"]'
      }
    },
    huggingchat: {
      name: "HuggingChat",
      domains: ["huggingface.co", "hf.co"],
      selectors: {
        input: 'textarea[placeholder*="Ask anything"], textarea',
        anchor: 'form, div[class*="input-container"]',
        sendButton: 'button[type="submit"]'
      }
    },
    grok: {
      name: "Grok",
      domains: ["grok.com", "x.ai", "x.com"],
      selectors: {
        input: 'textarea[placeholder*="Ask"], textarea[placeholder*="Grok"], div[contenteditable="true"][data-testid*="grok"], textarea',
        anchor: 'form, div[class*="composer"], div[data-testid*="grok"], div[class*="r-1awozwy"]',
        sendButton: 'button[data-testid*="send"], button[aria-label*="Grok"]'
      }
    },
    meta_ai: {
      name: "Meta AI",
      domains: ["meta.ai"],
      selectors: {
        input: 'textarea[placeholder*="Ask"], div[contenteditable="true"][role="textbox"], textarea',
        anchor: 'form, div[class*="composer"], div[role="region"]',
        sendButton: 'button[aria-label*="Send"], button[type="submit"]'
      }
    },
    v0: {
      name: "v0 by Vercel",
      domains: ["v0.dev"],
      selectors: {
        input: 'textarea[placeholder*="Ask v0"], textarea[placeholder*="What can I build"], textarea',
        anchor: 'form, div[class*="relative"]',
        sendButton: 'button[type="submit"]'
      }
    },
    bolt: {
      name: "Bolt.new",
      domains: ["bolt.new"],
      selectors: {
        input: 'textarea[placeholder*="Bolt"], textarea, div[contenteditable="true"]',
        anchor: 'form, div[class*="chat-input"]',
        sendButton: 'button[type="submit"]'
      }
    },
    lovable: {
      name: "Lovable",
      domains: ["lovable.dev"],
      selectors: {
        input: 'textarea[placeholder*="Ask Lovable"], textarea, div[contenteditable="true"]',
        anchor: 'form, div[class*="prompt-box"]',
        sendButton: 'button[type="submit"]'
      }
    },
    phind: {
      name: "Phind",
      domains: ["phind.com"],
      selectors: {
        input: 'textarea[placeholder*="Search"], textarea',
        anchor: 'form, div[class*="search-bar"]',
        sendButton: 'button[type="submit"]'
      }
    },
    you: {
      name: "You.com",
      domains: ["you.com"],
      selectors: {
        input: 'textarea[placeholder*="Ask"], textarea',
        anchor: 'form, div[class*="search-container"]',
        sendButton: 'button[type="submit"]'
      }
    },
    kimi: {
      name: "Kimi",
      domains: ["kimi.moonshot.cn", "kimi.ai"],
      selectors: {
        input: 'div[contenteditable="true"], textarea',
        anchor: 'div[class*="input-box"], form',
        sendButton: 'button[class*="send"]'
      }
    },
    qwen: {
      name: "Qwen",
      domains: ["qwenlm.ai", "tongyi.aliyun.com"],
      selectors: {
        input: 'textarea, div[contenteditable="true"]',
        anchor: 'div[class*="input"], form',
        sendButton: 'button[class*="send"]'
      }
    },
    character_ai: {
      name: "Character.ai",
      domains: ["character.ai"],
      selectors: {
        input: 'textarea[placeholder*="Message"], textarea, div[contenteditable="true"]',
        anchor: 'form, div[class*="chat-input"]',
        sendButton: 'button[aria-label="Send"]'
      }
    },
    github_copilot: {
      name: "GitHub Copilot",
      domains: ["github.com"],
      selectors: {
        input: 'textarea[placeholder*="Ask Copilot"], textarea#copilot-chat-textarea, textarea',
        anchor: 'form, div[class*="copilot-chat"]',
        sendButton: 'button[type="submit"]'
      }
    },
    openwebui: {
      name: "Open WebUI / Ollama",
      domains: ["localhost", "127.0.0.1", "0.0.0.0", "openwebui.com"],
      selectors: {
        input: 'textarea#chat-textarea, textarea#prompt-textarea, #demo-prompt, textarea#input-text, textarea.input, textarea, div[contenteditable="true"]',
        anchor: '#chat-input-container, .chat-input-wrapper, form, div.card',
        sendButton: 'button#btn-send, button.btn'
      }
    },
    universal: {
      name: "AI Chatbot",
      domains: [],
      selectors: {
        input: 'textarea, div[contenteditable="true"][role="textbox"], div.ProseMirror, div.ql-editor, div[contenteditable="true"]',
        anchor: 'form, div[class*="composer"], div[class*="input"], div[class*="prompt"], footer, fieldset',
        sendButton: 'button[type="submit"], button[aria-label*="Send"]'
      }
    }
  };

  var hostname = window.location.hostname;
  var currentProvider = Object.keys(PROVIDERS).find(function (k) {
    return PROVIDERS[k].domains && PROVIDERS[k].domains.some(function (d) {
      return hostname === d || hostname.endsWith("." + d);
    });
  }) || "universal";

  if (window.__PROMPTTRIM_INLINE__) return;
  window.__PROMPTTRIM_INLINE__ = true;

  console.log("[PromptTrim] Initializing Capsule toolbar on chatbot: " + (PROVIDERS[currentProvider] ? PROVIDERS[currentProvider].name : currentProvider));

  var settings = {
    keepFraction: 0.5,
    fidelityMode: true,
    profile: "chat-prompt",
    costPerMillion: 0.75
  };

  /* ------------------------------------------------------------------ */
  /* 2. Asynchronous Compression Offloading (MV3 Service Worker / Async)*/
  /* ------------------------------------------------------------------ */
  function compressTextAsync(rawText, query, opts, callback) {
    var engine = window.PromptTrim || window.TokenDiet;

    // Try offloading via background service worker (isolated MV3 worker, zero CSP conflict)
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      var responded = false;
      try {
        chrome.runtime.sendMessage({
          type: "COMPRESS_OFFLOAD",
          text: rawText,
          query: query,
          opts: opts
        }, function (response) {
          if (responded) return;
          responded = true;
          if (chrome.runtime.lastError || !response || !response.success || !response.result) {
            runInPageEngine();
          } else {
            callback(response.result);
          }
        });

        // Safety fallback timer if message passing is delayed
        setTimeout(function () {
          if (!responded) {
            responded = true;
            runInPageEngine();
          }
        }, 1200);
        return;
      } catch (e) {
        // Fall through to in-page engine
      }
    }

    runInPageEngine();

    function runInPageEngine() {
      if (engine && engine.compress) {
        // Run on next tick to prevent any synchronous main thread frame blocking
        setTimeout(function () {
          try {
            var res = engine.compress(rawText, query, opts);
            callback(res);
          } catch (err) {
            callback({ compressed: rawText, tokensSaved: 0, error: err.message || String(err) });
          }
        }, 0);
      } else {
        callback({ compressed: rawText, tokensSaved: 0, error: "Engine not loaded" });
      }
    }
  }

  function findTextBox() {
    var p = PROVIDERS[currentProvider];
    if (p && p.selectors && p.selectors.input) {
      var el = document.querySelector(p.selectors.input);
      if (el) return el;
    }
    // Fallback: look for focused or active chat inputs
    var active = document.activeElement;
    if (active && (active.tagName === "TEXTAREA" || active.isContentEditable || active.getAttribute("contenteditable") === "true")) {
      return active;
    }
    return document.querySelector('textarea, div[contenteditable="true"][role="textbox"], div.ProseMirror, div.ql-editor, div[contenteditable="true"]');
  }

  function findAnchor(textBox) {
    if (!textBox) return null;
    var p = PROVIDERS[currentProvider];

    if (currentProvider === "gemini") {
      // In Gemini, anchor above the outermost input area container
      var geminiOuter = textBox.closest("input-area-v2, .input-area-container, .bottom-container, div[class*='input-area-container']");
      if (geminiOuter) return geminiOuter;
      var chatWindow = textBox.closest("chat-window");
      if (chatWindow) return chatWindow;
    }

    if (p && p.selectors && p.selectors.anchor) {
      var specific = textBox.closest(p.selectors.anchor);
      if (specific) return specific;
    }

    var form = textBox.closest("form");
    if (form) return form;

    var container = textBox.closest("div[class*='composer'], div[class*='input'], div[class*='prompt'], div[class*='search'], footer, fieldset");
    if (container) return container;

    return textBox.parentElement || textBox;
  }

  /* ------------------------------------------------------------------ */
  /* 3. Shadow DOM Toolbar UI Styles & Component                        */
  /* ------------------------------------------------------------------ */
  var SCISSORS_ICON =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88"/><path d="M14.47 14.48 20 20"/><path d="M8.12 8.12 12 12"/></svg>';

  var BW_ICON =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88"/><path d="M14.47 14.48 20 20"/><path d="M8.12 8.12 12 12"/></svg>';

  var SHADOW_STYLES = [
    ":host { all: initial; display: inline-block; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; font-size: 11px; color: #ededf0; overflow: visible !important; position: relative; z-index: 999999; }",
    ":host([data-provider='gemini']) { display: flex; justify-content: flex-start; width: 100%; max-width: 840px; margin: 0 auto 6px auto; padding: 0 16px; box-sizing: border-box; }",
    ".td-host-wrap { position: relative; display: inline-flex; align-items: center; margin: 3px 0; overflow: visible !important; }",
    
    "/* Minimal Black & White Trigger Button */",
    ".td-trigger-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: #0c0c10; border: 1px solid #282834; border-radius: 7px; color: #ffffff; cursor: pointer; padding: 0; outline: none; box-shadow: 0 2px 8px rgba(0,0,0,0.4); transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1); user-select: none; position: relative; }",
    ".td-trigger-btn:hover { background: #181822; border-color: #55556a; color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.6); transform: translateY(-1px); }",
    ".td-trigger-btn:active { transform: scale(0.95); }",
    ".td-trigger-btn.open { background: #1e1e28; border-color: #ffffff; box-shadow: 0 0 0 2px rgba(255,255,255,0.15), 0 4px 14px rgba(0,0,0,0.6); }",
    ".td-trigger-btn.loading svg { animation: td-spin 1s linear infinite; }",
    ".td-trigger-btn .td-saved-dot { position: absolute; top: -2px; right: -2px; width: 7px; height: 7px; background: #34d399; border: 1.5px solid #0c0c10; border-radius: 50%; display: none; }",
    ".td-trigger-btn.has-savings .td-saved-dot { display: block; }",
    "@keyframes td-spin { 100% { transform: rotate(360deg); } }",

    "/* Popup Popover Card */",
    ".td-popover { position: absolute; bottom: calc(100% + 8px); left: 0; min-width: 320px; background: #121216; border: 1px solid #2a2a36; border-radius: 10px; box-shadow: 0 16px 40px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06); padding: 8px 10px; display: none; flex-direction: column; gap: 8px; z-index: 2147483647; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); animation: td-popover-pop 0.16s cubic-bezier(0.16, 1, 0.3, 1); overflow: visible !important; }",
    ".td-popover.open { display: flex !important; }",
    "@keyframes td-popover-pop { from { opacity: 0; transform: translateY(6px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }",

    "/* Top Controls Row */",
    ".td-controls-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: nowrap; }",
    ".td-left-group { display: flex; align-items: center; gap: 6px; }",
    ".td-right-group { display: flex; align-items: center; gap: 6px; }",

    ".td-btn { display: inline-flex; align-items: center; gap: 5px; background: #1a1a22; border: 1px solid #2c2c3a; color: #ffffff; font-weight: 600; font-size: 11px; cursor: pointer; padding: 4px 8px; border-radius: 6px; transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease; }",
    ".td-btn:hover { background: #262634; border-color: #34d399; color: #ffffff; }",
    ".td-btn:active { transform: scale(0.97); }",
    ".td-btn svg { color: #34d399; }",
    ".td-btn.loading svg { animation: td-spin 1s linear infinite; }",
    
    ".td-badge { background: rgba(52,211,153,0.15); color: #34d399; border: 1px solid rgba(52,211,153,0.3); font-size: 9.5px; font-weight: 600; padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, monospace; white-space: nowrap; }",
    
    ".td-levels { display: flex; gap: 2px; background: #08080a; border: 1px solid #1e1e26; border-radius: 6px; padding: 2px; }",
    ".td-lvl-btn { border: none; background: transparent; color: #8a8a9e; font-size: 9px; font-weight: 600; padding: 2px 5px; border-radius: 4px; cursor: pointer; font-family: ui-monospace, monospace; }",
    ".td-lvl-btn.active { background: rgba(255,255,255,0.14); color: #ffffff; }",
    
    ".td-dropdown { position: relative; display: inline-flex; align-items: center; overflow: visible !important; }",
    ".td-dropdown-btn { display: inline-flex; align-items: center; gap: 4px; background: #08080a; border: 1px solid #1e1e26; border-radius: 6px; color: #ededf0; font-size: 9.5px; font-weight: 600; padding: 3px 6px; cursor: pointer; outline: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease; user-select: none; }",
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
    
    ".td-fidelity { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; color: #8a8a9e; cursor: pointer; user-select: none; }",
    ".td-fidelity input { margin: 0; cursor: pointer; accent-color: #34d399; }",
    
    ".td-action { border: none; background: transparent; color: #8a8a9e; font-size: 10px; cursor: pointer; padding: 2px 5px; border-radius: 4px; }",
    ".td-action:hover { color: #ffffff; }",
    ".td-action.undo { color: #34d399; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }",
    
    "/* Paste Confirmation Toast */",
    ".td-toast { position: absolute; top: calc(100% + 6px); left: 0; display: none; align-items: center; gap: 6px; background: #0e0e13; border: 1px solid rgba(52,211,153,0.45); border-radius: 7px; padding: 5px 9px; font-size: 10px; font-weight: 600; color: #a7f3d0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: nowrap; box-shadow: 0 10px 28px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06); z-index: 2147483647; animation: td-toast-in 0.18s cubic-bezier(0.16, 1, 0.3, 1); }",
    ".td-toast.show { display: inline-flex; }",
    ".td-toast.fade-out { opacity: 0; transition: opacity 0.3s ease; }",
    ".td-toast svg { color: #34d399; flex: none; }",
    "@keyframes td-toast-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }"
  ].join("\n");

  var lastUndoState = null;
  var isWritingProgrammatically = false;

  function createToolbarElement(targetInput) {
    var host = document.createElement("div");
    host.id = "prompttrim-toolbar-host";
    host.setAttribute("data-prompttrim", "true");
    host.setAttribute("data-provider", currentProvider || "");

    var shadow = host.attachShadow({ mode: "open" });
    var style = document.createElement("style");
    style.textContent = SHADOW_STYLES;
    shadow.appendChild(style);

    var wrap = document.createElement("div");
    wrap.className = "td-host-wrap";

    // 1. Compact Black & White Trigger Button
    var triggerBtn = document.createElement("button");
    triggerBtn.className = "td-trigger-btn";
    triggerBtn.type = "button";
    triggerBtn.id = "td-trigger-btn";
    triggerBtn.title = "PromptTrim: Token Diet Compressor";
    triggerBtn.innerHTML = BW_ICON + '<span class="td-saved-dot" id="td-saved-dot"></span>';
    wrap.appendChild(triggerBtn);

    // 2. Popover Container with all options
    var popover = document.createElement("div");
    popover.className = "td-popover";
    popover.id = "td-popover";
    popover.innerHTML =
      '<div class="td-controls-row">' +
      '  <div class="td-left-group">' +
      '    <button class="td-btn" type="button" id="td-compress-btn">' +
      SCISSORS_ICON +
      '      <span>PromptTrim</span>' +
      '    </button>' +
      '    <span class="td-badge" id="td-stat-badge" style="display:none;"></span>' +
      '    <button class="td-action undo" type="button" id="td-undo-btn" style="display:none;">Undo</button>' +
      '  </div>' +
      '  <div class="td-right-group">' +
      '    <div class="td-levels">' +
      '      <button class="td-lvl-btn" type="button" data-level="0.6" title="Light Compression (60% kept)">L</button>' +
      '      <button class="td-lvl-btn active" type="button" data-level="0.5" title="Balanced Compression (50% kept)">B</button>' +
      '      <button class="td-lvl-btn" type="button" data-level="0.25" title="Aggressive Compression (25% kept)">A</button>' +
      '    </div>' +
      '    <div class="td-dropdown" id="td-dropdown">' +
      '      <button class="td-dropdown-btn" type="button" id="td-dropdown-btn" title="Compression Profile">' +
      '        <span id="td-dropdown-label">Chat</span>' +
      '        <svg class="td-dropdown-arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
      '      </button>' +
      '      <div class="td-dropdown-menu" id="td-dropdown-menu">' +
      '        <div class="td-dropdown-item" data-value="chat-prompt">' +
      '          <div class="td-item-top"><span class="td-item-title">Chat</span><svg class="td-item-check" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>' +
      '          <span class="td-item-sub">Conversational filler strip</span>' +
      '        </div>' +
      '        <div class="td-dropdown-item" data-value="code-review">' +
      '          <div class="td-item-top"><span class="td-item-title">Code</span><svg class="td-item-check" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>' +
      '          <span class="td-item-sub">Paths, lines, hex &amp; syntax</span>' +
      '        </div>' +
      '        <div class="td-dropdown-item" data-value="legal-compliance">' +
      '          <div class="td-item-top"><span class="td-item-title">Legal</span><svg class="td-item-check" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>' +
      '          <span class="td-item-sub">Clauses, dates &amp; strict terms</span>' +
      '        </div>' +
      '        <div class="td-dropdown-item" data-value="rag-context">' +
      '          <div class="td-item-top"><span class="td-item-title">RAG</span><svg class="td-item-check" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>' +
      '          <span class="td-item-sub">Aggressive multi-chunk MMR</span>' +
      '        </div>' +
      '      </div>' +
      '    </div>' +
      '    <label class="td-fidelity" title="Preserve critical instructions and constraints">' +
      '      <input type="checkbox" id="td-fidelity-toggle" ' + (settings.fidelityMode ? 'checked' : '') + '>' +
      '      <span>Fidelity</span>' +
      '    </label>' +
      '  </div>' +
      '</div>';

    wrap.appendChild(popover);

    var toast = document.createElement("div");
    toast.className = "td-toast";
    toast.id = "td-toast";
    toast.innerHTML =
      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' +
      '<span id="td-toast-msg"></span>';
    wrap.appendChild(toast);
    shadow.appendChild(wrap);

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
    
    // Toggle popover on trigger button click
    function togglePopover(forceState) {
      var isCurrentlyOpen = popover.classList.contains("open");
      var willOpen = forceState != null ? forceState : !isCurrentlyOpen;
      if (willOpen) {
        popover.classList.add("open");
        triggerBtn.classList.add("open");
      } else {
        popover.classList.remove("open");
        triggerBtn.classList.remove("open");
        if (dropdown) {
          dropdown.classList.remove("open");
          dropdownMenu.style.display = "none";
        }
      }
    }

    triggerBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      togglePopover();
    });

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

    // Close popover / dropdown on outside click
    document.addEventListener("click", function (e) {
      if (!host.contains(e.target)) {
        togglePopover(false);
      }
    });

    shadow.addEventListener("click", function (e) {
      if (dropdown && !dropdown.contains(e.target) && e.target !== dropdownBtn) {
        dropdown.classList.remove("open");
        dropdownMenu.style.display = "none";
      }
    });

    fidelityToggle.addEventListener("change", function (e) {
      settings.fidelityMode = e.target.checked;
      chrome.storage.local.set({ fidelityMode: settings.fidelityMode });
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
      
      var targetText = lastUndoState.text;
      lastUndoState = null;
      
      writeTextToField(input, targetText);

      undoBtn.style.display = "none";
      statBadge.style.display = "none";
      triggerBtn.classList.remove("has-savings");
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

  /**
   * Fast, non-blocking text setter for Textarea and ContentEditable elements.
   * Avoids execCommand locks, excessive spellcheck thrashing, and event cascades.
   */
  function writeTextToField(element, text) {
    if (!element) return;
    if (isWritingProgrammatically) return;
    isWritingProgrammatically = true;

    try {
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
        // Handle Rich ContentEditable (Gemini Quill, Claude ProseMirror, ChatGPT Lexical)
        var sel = window.getSelection();
        if (sel) {
          var range = document.createRange();
          range.selectNodeContents(element);
          sel.removeAllRanges();
          sel.addRange(range);
        }

        var handled = false;
        try {
          // Attempt modern DataTransfer input event first (ProseMirror / Lexical native)
          if (typeof DataTransfer !== "undefined") {
            var dt = new DataTransfer();
            dt.setData("text/plain", text);
            var ev = new InputEvent("beforeinput", {
              inputType: "insertReplacementText",
              dataTransfer: dt,
              data: text,
              bubbles: true,
              cancelable: true,
              composed: true
            });
            var dispatched = element.dispatchEvent(ev);
            if (!dispatched) {
              handled = true;
            }
          }
        } catch (e) {
          handled = false;
        }

        if (!handled) {
          // Quick direct text replacement without blocking UI thread
          try {
            var execOk = document.execCommand("insertText", false, text);
            if (!execOk) {
              element.textContent = text;
            }
          } catch (err) {
            element.textContent = text;
          }
        }

        element.dispatchEvent(new InputEvent("input", {
          inputType: "insertText",
          data: text,
          bubbles: true,
          cancelable: false,
          composed: true
        }));
      }
    } finally {
      setTimeout(function () {
        isWritingProgrammatically = false;
      }, 50);
    }
  }

  function showToast(shadow, message) {
    if (!shadow) return;
    var toast = shadow.getElementById("td-toast");
    var msgEl = shadow.getElementById("td-toast-msg");
    if (!toast || !msgEl) return;
    msgEl.textContent = message;
    toast.classList.remove("fade-out");
    toast.classList.add("show");
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(function () {
      toast.classList.add("fade-out");
      setTimeout(function () {
        toast.classList.remove("show", "fade-out");
      }, 300);
    }, 2800);
  }

  function flashHighlight(inputElement) {
    if (!inputElement) return;
    var prev = {
      outline: inputElement.style.outline,
      outlineOffset: inputElement.style.outlineOffset,
      boxShadow: inputElement.style.boxShadow
    };
    inputElement.style.transition = "outline 0.25s ease, box-shadow 0.25s ease";
    inputElement.style.outline = "2px solid rgba(52,211,153,0.85)";
    inputElement.style.outlineOffset = "2px";
    inputElement.style.boxShadow = "0 0 0 4px rgba(52,211,153,0.28)";
    setTimeout(function () {
      inputElement.style.outline = prev.outline;
      inputElement.style.outlineOffset = prev.outlineOffset;
      inputElement.style.boxShadow = prev.boxShadow;
      inputElement.style.transition = "";
    }, 1400);
  }

  function handleCompress(inputElement, shadow) {
    var triggerBtn = shadow ? shadow.getElementById("td-trigger-btn") : null;
    var compressBtn = shadow ? shadow.getElementById("td-compress-btn") : null;
    var statBadge = shadow ? shadow.getElementById("td-stat-badge") : null;
    var undoBtn = shadow ? shadow.getElementById("td-undo-btn") : null;

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
    if (triggerBtn) {
      triggerBtn.classList.add("loading");
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
        if (triggerBtn) {
          triggerBtn.classList.remove("loading");
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

        if (triggerBtn) {
          triggerBtn.classList.add("has-savings");
        }

        if (statBadge) {
          var pct = Math.round(res.compressionRatio * 100);
          statBadge.textContent = "-" + pct + "% (" + res.tokensSaved + " tok)";
          statBadge.style.display = "inline";
        }

        if (undoBtn) {
          undoBtn.style.display = "inline";
        }

        flashHighlight(inputElement);
        showToast(shadow, "Prompt trimmed & pasted -" + Math.round(res.compressionRatio * 100) + "% - " + res.tokensSaved + " tokens");
      }
    );
  }

  /* ------------------------------------------------------------------ */
  /* 5. Active In-Page Injection Loop & MutationObserver                */
  /* ------------------------------------------------------------------ */
  function ensureToolbarInjected() {
    if (isWritingProgrammatically) return;

    var textBox = findTextBox();
    if (!textBox) return;

    var existing = document.getElementById("prompttrim-toolbar-host") || document.getElementById("token-diet-toolbar-host");
    var anchor = findAnchor(textBox);

    if (existing) {
      if (anchor && anchor.parentNode && !anchor.parentNode.contains(existing)) {
        anchor.parentNode.insertBefore(existing, anchor);
      }
      return;
    }

    if (anchor && anchor.parentNode) {
      var toolbar = createToolbarElement(textBox);
      anchor.parentNode.insertBefore(toolbar, anchor);
      console.log("[PromptTrim] Compact trigger icon mounted above anchor:", anchor);
    }
  }

  ensureToolbarInjected();
  var pollInterval = setInterval(ensureToolbarInjected, 1000);

  var debounceTimer = null;
  var observer = new MutationObserver(function () {
    if (isWritingProgrammatically) return;
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
        var toolbar = document.getElementById("prompttrim-toolbar-host") || document.getElementById("token-diet-toolbar-host");
        var shadow = toolbar ? toolbar.shadowRoot : null;
        handleCompress(input, shadow);
      }
      sendResponse({ ok: true });
    }
  });

})();