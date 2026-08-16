/**
 * Token-Diet background service worker:
 *  - right-click context menu on any text selection
 *  - keyboard shortcut (Alt+Shift+T) for the focused text box
 * Both just relay a message to the content script, which owns the UI.
 */

const MENU_ID = "token-diet-compress-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Compress with Token-Diet",
      contexts: ["selection"]
    });
  });
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