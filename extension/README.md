# Token-Diet — Browser Extension

The one-click companion to the Token-Diet dashboard. Compresses text **inside any
website text box** — ChatGPT, Claude, Gmail, or any page — before it reaches the
LLM, using the exact same two-stage scoring philosophy as the core pipeline:

```
Raw text → Sentence split → Hybrid scoring (TF-IDF keywords + char n-gram semantic
overlap) → Redundancy removal → Cherry-pick prune → Original order preserved
```

The whole engine is a zero-dependency JS port of `core/` (`engine.js`) that runs
**100% locally** — no server, no API key, no network round-trip. Same "one brain,
two ways to use it" design as the main site: the popup is the dashboard's overview
card + playground in miniature, styled with the same design tokens
(`#08080A` canvas, `#121216` cards, `#1E1E26` borders, emerald accents,
Plus Jakarta Sans + JetBrains Mono).

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this `extension/` folder

## How to use

| Trigger | What happens |
|---|---|
| **Focus any text box with text** | A `✂ Token-Diet` pill appears **inside the box's bottom-right corner** (Compose AI / Capsule Hub style). Click it to compress the whole box in place. Select a passage first → it compresses just that selection. |
| **Result strip** | After compression, a small bar appears under the field: **% saved · tokens · ms**, a **L/B/A level picker** (Light/Balanced/Aggressive), and one-click **Undo**. |
| **Alt+Shift+T** | Compresses the currently focused text box from anywhere. |
| **Right-click a selection → "Compress with Token-Diet"** | Replaces editable selections in place; copies to clipboard on plain page text. |
| **Extension popup (small stats panel)** | Quick paste-and-compress with the dashboard stats: compression ratio, tokens before→after, est. TTFT drop (ms), cost saved. **Copy** the result. |

> The whole compression flow is in-page — no popup needed, so the chat box
> never loses focus and nothing closes mid-use. The browser popup is just a
> compact stats panel (300px) for when you're not on a text box.

### Compression levels

| Level | keep_fraction | Use for |
|---|---|---|
| Light | 0.60 | Chat messages, casual writing — least aggressive |
| Balanced | 0.40 | Default; general prompts and RAG context |
| Aggressive | 0.25 | Max token savings for long reference docs |

## Files

```
extension/
├── manifest.json     MV3 — permissions, content script, commands
├── engine.js         Shared compression engine (popup + content script)
├── background.js     Context menu + Alt+Shift+T relay
├── content.js        In-field ✂ button (Shadow DOM), selection-aware
│                     compression, result strip with levels + Undo
├── popup.html/.css/.js   Compact 300px stats panel (mirrors site design)
└── icons/            16/32/48/128 PNG (white tile + scissors mark)
```

## Troubleshooting — button not showing

The most common causes, in order:

1. **Extension not reloaded after edits.** Go to `chrome://extensions` → click the
   **reload (↻)** icon on the Token-Diet card.
2. **Page not refreshed.** Content scripts only re-run on page load — after
   reloading the extension, **refresh the chat page** (Ctrl+Shift+R).
3. **Incognito window.** Extensions are disabled in incognito unless you tick
   "Allow in Incognito" on the extension details page.
4. **Verify the script ran:** press F12 → Console → you should see
   `[Token-Diet] content script injected v1.2.0`, and typing `__TD_DEBUG`
   shows `{ injected: true, lastEditable: ... }`. If `lastError` is set,
   report it. If there's no log line at all, the script didn't run on that
   page (wrong URL / page cached — hard-refresh).
5. **The button only appears while the field is focused** (click inside the
   chat box / type something). It sits at the field's bottom-right corner.
   It is hidden again once you click away.

## Notes

- The in-field button only appears while the field is focused **and** has at
  least ~20 characters — it never blocks an empty composer.
- All injected UI lives in a Shadow DOM, so page CSS can't restyle or break it
  (the approach used by Compose AI-class extensions).
- Selecting text inside the box before clicking compresses only the selection;
  otherwise the whole box is compressed. Undo always restores the full original.
- Token counting mirrors `core/metrics.py` fallback (~1.3 tokens/word), so popup
  numbers line up with the Python engine's estimate.
- Text is injected via React-safe value setters and `execCommand("insertText")`,
  so ChatGPT/Claude/React apps see a normal `input` event — send is supported.
- Cost-per-million-token pricing (default $0.75/M input) lives in
  `chrome.storage.local`; the content script reads the same value so stats stay
  consistent everywhere.

## Future work

- Optional bridge to the FastAPI backend (`/api/compress`) for cross-encoder
  quality on long documents, with automatic fallback to the local engine.
- Domain packs (legal / code / medical stopword + abbreviation sets).
- Right-click "Compress selection" for non-editable page text via a mini popover
  instead of clipboard-only.