/**
 * PromptTrim background service worker:
 *  - offload heavy compression from content script
 *  - right-click context menu on any text selection
 *  - keyboard shortcut (Alt+Shift+T) for the focused text box
 */

try {
  importScripts("tokenizer.js", "instruction-detector.js", "diff.js", "engine.js");
} catch (e) {
  console.warn("[PromptTrim Background] Could not load engine scripts in service worker:", e);
}

const MENU_ID = "prompttrim-compress-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Compress with PromptTrim",
      contexts: ["selection"]
    });
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.type === "COMPRESS_OFFLOAD") {
    try {
      const engine = self.PromptTrim || self.TokenDiet;
      if (engine && engine.compress) {
        const res = engine.compress(request.text, request.query, request.opts || {});
        sendResponse({ success: true, result: res });
      } else {
        sendResponse({ success: false, error: "Engine not initialized in background worker" });
      }
    } catch (err) {
      sendResponse({ success: false, error: err.message || String(err) });
    }
    return true; // async sendResponse
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || tab.id == null) return;
  chrome.tabs.sendMessage(tab.id, { type: "COMPRESS_SELECTION" }).catch(() => {});
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "compress-focused") return;
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab && tab.id != null) {
      chrome.tabs.sendMessage(tab.id, { type: "COMPRESS_FOCUSED" }).catch(() => {});
    }
  });
});