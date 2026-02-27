# ChatWall — Security Model & Data Boundaries

> **Audience:** Developers, security reviewers, and curious users asking:  
> *"Can the host chatbot website (ChatGPT, Claude, Gemini …) access my real data through ChatWall?"*

---

## 1. Token Map (`[NAME_1]` → `"John Smith"`)

**Storage location:** `chrome.storage.session` (`02_storage.js`)  
**Fallback (Firefox/Safari):** Background Service Worker in-memory state, retrieved via `chrome.runtime.sendMessage`.

```js
// 02_storage.js
const res = await chrome.storage.session.get(['chatwall_token_map']);
```

`chrome.storage` is an **extension-exclusive API**. It is completely inaccessible to host-page JavaScript — the chatbot website cannot enumerate, read, or observe it under any circumstances.

Additionally, the content script that reads this map runs in an **Isolated World**: a separate JavaScript heap from the host page. Even if the host page injected a script, it would exist in a different JS context and could not access `chrome.*` APIs or the content script's variables.

**Lifecycle:** Session storage is automatically cleared when the browser is closed. No token-to-PII mapping is ever written to disk.

| Attack vector | Possible? |
|---|---|
| Host page reads `chrome.storage.session` | ❌ No — extension-only API |
| Host page reads content script memory | ❌ No — Isolated World boundary |
| Token map persists after browser close | ❌ No — session-scoped |

---

## 2. Tokens in the AI Response DOM (`[NAME_1]`, `[EMAIL_2]` …)

When the AI echoes a token back in its response, that token string **is** present in the host page DOM as a plain text node. The chatbot website's own JavaScript can read it via `document.body.innerText`.

**However:** A token like `[NAME_1]` is a meaningless opaque identifier. Without the token map (stored in `chrome.storage.session`, inaccessible to the host), the host site has no way to reverse it to the original PII.

> **Analogy:** The host page can see a locker number. It cannot see what is inside the locker.

| Attack vector | Possible? |
|---|---|
| Host reads token strings from the DOM | ✅ Yes — they are plain text |
| Host reverses a token to the original PII | ❌ No — map is inaccessible |

---

## 3. "Unmask & Preview" — Shadow DOM Pills

When the user right-clicks a response and selects **Unmask & Preview**, the extension calls `unmaskInResponseDOM(container, previewMode = true)` (`06_unmasking.js`).

```js
// SECURE PREVIEW: add .cw-revealed class to the host element.
// • The original value lives entirely inside the closed shadow DOM.
// • Host page JS cannot access it via textContent, innerText, or shadowRoot.
for (const pill of pills) {
    pill.classList.add('cw-revealed');
    pill.title = 'ChatWall — content revealed (protected)';
}
```

The real value is rendered **inside a closed Shadow DOM**. Closed shadow roots return `null` for `element.shadowRoot`, blocking traversal. The host page's `innerText` / `textContent` on the pill host element exposes only the masked token, not the original value.

| Attack vector | Possible? |
|---|---|
| Host reads `element.shadowRoot` | ❌ No — closed shadow mode |
| Host reads `element.innerText` / `textContent` | ❌ No — shadow content excluded |
| Host reads `element.getAttribute('data-cw-orig')` | ⚠️ See §3.1 below |

### 3.1 `data-cw-orig` attribute

The unmasked copy helper `getContainerTextUnmasked()` reads `data-cw-orig` from pill elements to build clipboard text without touching the shadow DOM. This attribute **is** readable by the host page via `element.getAttribute('data-cw-orig')` because it lives on the light DOM host element.

**Risk assessment:** Low in practice. The attribute is only populated on pill elements that have already been placed by the extension into the chatbot's response DOM. A determined host-page script *could* query for `[data-cw-redact]` elements and read their `data-cw-orig` attribute to reconstruct unmasked values.

**Mitigation options (future):**
- Remove `data-cw-orig` after the clipboard operation completes.
- Store the mapping exclusively in the shadow DOM's `internals` or retrieve it fresh from `chrome.storage` at copy time (already done for token-map-based pills).

---

## 4. "Unmask & Copy" — Clipboard

When the user selects **Unmask & Copy**, the extension writes the unmasked plain text to the system clipboard:

```js
// 06_unmasking.js — handleResponseAction('UNMASK_COPY')
await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blobText })]);
```

At this moment, if the host page holds the `clipboard-read` browser permission, it could read the clipboard contents. Modern browsers require:
1. An explicit user gesture (e.g. click) to trigger `navigator.clipboard.read()`.
2. A **user-granted permission prompt** for `clipboard-read` on that origin.

Mainstream AI chat platforms do not request `clipboard-read`. This risk is **theoretical, not practical** for current deployments.

| Attack vector | Possible? |
|---|---|
| Host reads clipboard after "Unmask & Copy" | ⚠️ Only with user-granted `clipboard-read` permission |
| Risk on ChatGPT / Claude / Gemini today | ❌ None of these request `clipboard-read` |

---

## 5. Favorites

### What are favorites?
Favorites are words or phrases the user explicitly marks as "always mask." They are accumulated in a runtime `Set<string>` called `favoritesList` (`01_variables.js`) and treated as mandatory masking candidates on every processing sweep (`04_processing.js`, `05_masking.js`).

### Storage
Favorites are persisted in `chrome.storage.local` (`02_storage.js`):

```js
function saveFavorites() {
    const arr = Array.from(favoritesList);
    const hashed = arr.map(s => btoa(unescape(encodeURIComponent(s))));
    chrome.storage.local.set({ 'chatwall_favorites': hashed });
}
```

Each favorite string is **Base64-encoded** before being written to storage.

| Property | Detail |
|---|---|
| Storage API | `chrome.storage.local` — extension-only, inaccessible to host page |
| Encoding | Base64 (`btoa`) — not encryption; it provides obfuscation against casual inspection in Chrome's DevTools storage panel, but is trivially reversible |
| Persistence | Survives browser restarts (unlike session storage). Cleared only on extension uninstall or explicit user action |
| Host page access | ❌ Not possible — `chrome.storage.local` is extension-exclusive |

> **Note on Base64:** The encoding is **not cryptographic**. It prevents accidental exposure in log output or DevTools panels but should not be treated as encryption. The data is still stored in plaintext on disk within Chrome's local profile directory, protected only by the OS user-account boundary.

### Runtime exposure
While the extension is active, `favoritesList` is a JavaScript `Set` in the content script's **Isolated World** memory. The host page cannot access it.

### What favorites reveal
A favorite entry represents a **word or phrase the user considers sensitive** — typically a real name, company name, place, or personal term. Unlike tokens (which are transient per session), favorites are **long-lived** and directly contain the original sensitive string. This makes their storage security particularly important.

### Favorites and the DOM
When a favorite word appears in user input, it is masked to a token (e.g. `[NAME_3]`) before the prompt is submitted — the original word is **never** sent to the AI in unmasked form, and never appears in the response DOM.

| Attack vector | Possible? |
|---|---|
| Host reads `chrome.storage.local` | ❌ No — extension-only API |
| Host reads `favoritesList` at runtime | ❌ No — Isolated World |
| Favorite words appear in the page DOM | ❌ No — always masked before submission |
| Favorite words exposed via `data-cw-orig` | ❌ No — favorites are input-side only; pills are generated from response tokens |
| OS-level disk access to Chrome profile | ⚠️ Possible if OS account is compromised (same risk as all browser storage) |

---

## 6. Summary

| Data surface | Location | Host page access? | PII exposed? |
|---|---|---|---|
| Token map (`[X]` → real value) | `chrome.storage.session` | ❌ No | ❌ No |
| Token strings in AI response | Host page DOM | ✅ Yes (opaque) | ❌ No (no map) |
| Unmask Preview (real value) | Closed shadow DOM | ❌ No | ❌ No |
| `data-cw-orig` on pill elements | Light DOM attribute | ⚠️ Yes (see §3.1) | ⚠️ Partially |
| Unmask & Copy (clipboard) | System clipboard | ⚠️ With user grant | ✅ Briefly |
| Favorites list (runtime) | Isolated World memory | ❌ No | ❌ No |
| Favorites list (disk) | `chrome.storage.local` | ❌ No | ❌ No (Base64) |

---

## 7. Recommended Improvement: `data-cw-orig` Scrubbing

The most actionable hardening step is to remove `data-cw-orig` from pill elements after the clipboard write is complete, eliminating the §3.1 surface:

```js
// After clipboard.write() succeeds:
container.querySelectorAll('[data-cw-orig]').forEach(el => el.removeAttribute('data-cw-orig'));
```

This would make the Preview → Copy flow fully zero-knowledge from the host page's perspective.
