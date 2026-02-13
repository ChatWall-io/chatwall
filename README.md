# ChatWall - AI Firewall Extension

ChatWall is a browser extension that acts as a privacy firewall between you and AI providers (ChatGPT, Claude, Gemini, etc.). It automatically detects and anonymizes private and sensitive data (PII) like names, emails, phone numbers, and bank details *before* they leave your browser.

## 🌐 [Visit ChatWall.io](https://chatwall.io)


![ChatWall Screenshot](https://chatwall.io/img/sc3.png)

### ▶️ Watch the Demo

[![ChatWall Demo](https://chatwall.io/img/sc1.png)](https://chatwall.io)

## 🛡️ Key Features

-   **Local Processing**: All detection and masking happens 100% inside your browser. No PII is ever sent to our servers.
-   **Smart Detection**: Identifies 30+ types of PII including Names, Emails, Phones, IBANs, Credit Cards, API Keys, JWTs, and more.
-   **Secure Overlay**: A Shadow DOM isolated environment to type your prompts safely, preventing the host website from "seeing" what you type until you choose to send the masked version.
-   **Context-Aware**: Understands context (e.g., "Call John" vs just "John") for accurate name detection.
-   **Multi-Language**: Supports 7 languages (EN, FR, ES, DE, IT, NL, PT).

## 🏗️ Architecture

ChatWall is built on a **"Local First"** architecture to maximize privacy.

### Core Components
1.  **Local NLP Engine**: A JavaScript-based detection engine (`detectors/*.js`) that uses advanced Regular Expressions and Contextual Logic (not heavy ML models) to detect PII with near-zero latency.
2.  **Shadow DOM Overlay**: The UI is injected into a `Shadow Root` (`mode: closed`), isolating your input from the host page's scripts and DOM. This prevents the AI provider from using keyloggers or screen scrapers on your sensitive drafts.
3.  **Ephemeral Token System**:
    -   **Detection**: `John Doe` -> Detected as `NAME`.
    -   **Tokenization**: Replaced with `[NAME_1]`.
    -   **Storage**: The mapping (`[NAME_1]: John Doe`) is stored in `chrome.storage.session` (RAM-like).
    -   **Lifecycle**: Tokens are **Session-Bound**. Closing the tab wipes the key. We strictly *do not* persist PII to disk.
4.  **Secure Favorites**: Custom favorite terms (words you want always masked) are stored locally in Chrome Storage (base64 encoded) to persist across sessions. They are **not synced** to the cloud.
    > ⚠️ Favorites are stored locally on your device. Do not add sensitive data to favorites on a public or shared computer.

### Data Flow
1.  **Input**: User types in Secure Overlay.
2.  **Process**: Text is scanned -> PII replaced with Tokens -> Mapping stored in Memory.
3.  **Output**: Masked text (`[NAME_1] asked about [PROJECT_X]`) is injected into the AI Chatbox.
4.  **Response**: When AI replies with tokens (`[NAME_1]`), ChatWall detects them and offers a "Click to Unmask" feature using the local in-memory map.

## 📂 Code Structure

-   **`content/`**: Modular content scripts, loaded in order via `manifest.json`. All files share a global scope (no bundler needed).
    -   `01_variables.js` – Global state, constants, entity tiers, SVG assets.
    -   `02_storage.js` – Token map, counters, favorites, plan persistence.
    -   `03_utils.js` – DOM helpers, text extraction, button detection, token locking.
    -   `04_processing.js` – Core text analysis, scoring, overlap resolution, rendering.
    -   `05_masking.js` – Outbound masking flow: tokenize → send to AI prompt.
    -   `06_unmasking.js` – Inbound unmasking flow: detect tokens → restore originals.
    -   `07_overlay_ui.js` – Overlay lifecycle (create / show / hide), toasts, plan UI.
    -   `08_float_button.js` – Floating button, risk analysis, decision popup.
    -   `09_overlay_events.js` – Overlay interaction (input, toolbar, scroll sync, settings, license).
    -   `10_context_menu.js` – Right-click context menu (cut, copy, paste, mask/unmask, favorites).
    -   `11_page_events.js` – Chrome messages, typing detection, MutationObserver, bootstrap.
-   **`detectors/`**: Contains the detection modules.
    -   `detector.js`: Base class for logic.
    -   `name.js`, `email.js`, etc.: Specific implementation rules.
    -   `_data/`: Datasets (Names, Cities) loaded dynamically to save memory.
-   **`_locales/`**: Internationalization files (`messages.json`).
-   **`manifest.json`**: V3 Manifest defining permissions and host matches.

## 🚀 Usage

1.  **Install**: Install ChatWall from the Browser Web Store (https://chatwall.io/index.html#download) or load the extension folder in Chrome (`chrome://extensions` -> Load Unpacked).
2.  **Masking**:
    -   Go to a supported site (e.g., `chatgpt.com`).
    -   Click the **ChatWall Logo** in the input bar.
    -   Type your confidential prompt in the Overlay.
    -   Click **"Send to AI Prompt"**.
    -   Submit the *masked* prompt to the AI.
3.  **Unmasking**:
    -   If the AI mentions a token (e.g., `[NAME_1]`), ChatWall highlights it.
    -   Click the **Floating Unmask Green Button** to reveal the original text.
    -   Or **Right-Click** the **Copy Button** of the response.
    -   Or **Right-Click** -> `ChatWall` -> `Unmask & Copy`.
    
📖 **Full Documentation**: [chatwall.io/support](https://chatwall.io/support.html)

## 🔒 Privacy & Security

-   **Zero-Knowledge**: We do not know who you are masking or what you are typing.
-   **No Analytics on Content**: We do not track prompt content.
-   **License Validation**: The only network request made to `chatwall.io` is to validate your License Key (if Premium). This sends your email, anonymous ID and License Key.
-   **Open Source-ish**: The code is inspectable. You can verify network activity in DevTools (Network Tab) to see that no data leaves your machine.

## 🤝 Contribution

1.  Fork the repository.
2.  Create a branch from `develop` following the naming convention below.
3.  Make your changes and commit using conventional commit messages.
4.  Submit a Pull Request targeting `develop`.

### Branch Naming

Branches must follow the pattern **`type/issue-number-short-description`**, where `type` matches one of the [issue templates](.github/ISSUE_TEMPLATE/):

| Type | Description | Branch Example |
|---|---|---|
| `feat` | New feature or enhancement | `feat/12-add-iban-detector` |
| `fix` | Bug fix | `fix/34-overlay-scroll-desync` |
| `refactor` | Code restructuring (no behavior change) | `refactor/7-split-content-modules` |
| `perf` | Performance improvement | `perf/45-optimize-large-text` |
| `style` | Code style / formatting | `style/51-lint-detectors` |
| `test` | Adding or updating tests | `test/60-name-detector-cases` |
| `docs` | Documentation changes | `docs/18-update-readme` |
| `chore` | Maintenance, deps, build tasks | `chore/22-update-manifest-version` |

### Commit Messages

Commits must use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
type: short description

# Examples
feat: add GPS coordinate detector
fix: prevent overlay from closing on outside click
refactor: extract honorific list into shared module
perf: cache DOM queries in overlay rendering
```

### Adding a New Detector

1.  Create your detector file in `detectors/` (extend `ContextualDetector` from `detector.js`).
2.  Register it in both `manifest.json` and `manifest.firefox.json`.
3.  Instantiate it in the `DETECTORS` array in `background.js`.

**Note**: Detectors must use strictly local logic (Regex/Algorithmic). No API calls allowed.

## 📄 License

**Proprietary / Source Available**
Copyright © 2025 StarObject S.A. - Philippe Collignon.
All Rights Reserved.

-   **Allowed**: View source code for security auditing; Modify for personal use.
-   **Prohibited**: Resale, redistribution, commercial use, or uploading to extension stores.

See [License.txt](License.txt) for details.
