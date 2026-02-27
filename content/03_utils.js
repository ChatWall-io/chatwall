/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */
// --- UTILS ---

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function localizeHtml(html) {
    return html.replace(/\{\{MSG_(\w+)\}\}/g, function (match, key) {
        return chrome.i18n.getMessage(key) || key;
    });
}

function simpleMarkdownToHtml(markdown) {
    let html = markdown || "";
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');
    html = html.replace(/^---$/gim, '<hr>');
    html = html.replace(/^\* (.*$)/gim, '<li>$1</li>');
    html = html.replace(/^- (.*$)/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>');
    html = html.replace(/<\/ul>\s*<ul>/gim, '');
    html = html.replace(/\n/g, '<br>');
    return html;
}

function processHtmlForClipboard(html) {
    // Strip ChatWall artifacts if present, though usually we copy raw text
    // Only used to ensure clipboard has rich text structure
    return html;
}

function extractTextFromElement(target, isReEdit = false) {
    if (!target) return "";
    let text = "";
    let isValue = false;

    if (typeof target.value === 'string') {
        text = target.value;
        isValue = true;
    } else if (target.isContentEditable || (target.getAttribute && target.getAttribute('contenteditable') === 'true')) {
        // Walk the DOM to reconstruct text with proper paragraph boundaries.
        // Using innerText alone is unreliable: Chrome collapses or adds newlines
        // differently depending on the CSS and nesting depth.
        text = extractContentEditableText(target);
    } else {
        text = target.innerText || target.value || "";
    }

    // Normalize CR
    text = text.replace(/\r\n/g, '\n');

    if (isReEdit || isValue) {
        // Re-edit OR Textarea: Trust the source (internal state or user typed raw).
        // Just cap excessive whitespace (e.g. 3+ blank lines -> 1 blank line)
        return text.replace(/\n{3,}/g, '\n\n').trim();
    } else {
        // First Open from ContentEditable (DOM):
        // DOM visual newline mapping is inconsistent (2-3 newlines).
        // STRATEGY: Robust Collapse.
        // 2 or 3 newlines -> 1 newline (Standard Block Break).
        // 4+ newlines -> 2 newlines (Explicit Blank Line).
        return text.replace(/\n{2,}/g, (m) => (m.length >= 4 ? '\n\n' : '\n')).trim();
    }
}

/**
 * Walk a contenteditable element's DOM and reconstruct the plain text,
 * preserving line breaks created by <br>, <p>, and block <div> elements.
 */
function extractContentEditableText(el) {
    let out = '';

    function walk(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            out += node.textContent;
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const tag = node.tagName.toUpperCase();

        if (tag === 'BR') {
            out += '\n';
            return;
        }

        // Block-level elements: wrap with newline before/after
        const isBlock = /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|PRE|TR|TD|TH)$/.test(tag);
        if (isBlock && out.length > 0 && !out.endsWith('\n')) {
            out += '\n';
        }

        for (const child of node.childNodes) walk(child);

        if (isBlock && !out.endsWith('\n')) {
            out += '\n';
        }
    }

    walk(el);
    // Normalize: collapse 3+ consecutive newlines to 2, trim edges
    return out.replace(/\n{3,}/g, '\n\n');
}


function getSelectionHtml() {
    let html = "";
    if (typeof window.getSelection != "undefined") {
        let sel = window.getSelection();
        if (sel.rangeCount > 0) {
            let container = document.createElement("div");
            container.appendChild(sel.getRangeAt(0).cloneContents());
            html = container.innerHTML;
        }
    }
    return html;
}

function getEditableTarget(el) {
    if (!el) return null;
    return el.closest('textarea, input, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
}

function getVisualAnchor(el) {
    if (!el) return null;
    let current = el;
    for (let i = 0; i < 5; i++) {
        if (!current || current === document.body || current === document.documentElement) break;
        const style = window.getComputedStyle(current);
        const overflowY = style.overflowY;
        const isScrollable = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay');
        if (isScrollable) return current;
        current = current.parentElement;
    }
    return el;
}

function findMainInput() {
    const inputs = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'));
    const visibleInputs = inputs.filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    });
    return visibleInputs.length > 0 ? visibleInputs[visibleInputs.length - 1] : null;
}

// --- BUTTON DETECTION UTILS ---

function isCopyButton(btn) {
    const text = (btn.innerText || "").toLowerCase().trim();
    const label = (btn.getAttribute('aria-label') || "").toLowerCase().trim();
    const testId = (btn.getAttribute('data-testid') || btn.getAttribute('data-test-id') || "").toLowerCase();
    const html = btn.innerHTML.toLowerCase();

    if (testId.includes('copy')) return true;
    if ((label.includes('copy') || text.includes('copy')) && !text.includes('regenerate')) return true;
    if (html.includes('content_copy')) return true;

    const svgPath = btn.querySelector('path');
    if (svgPath) {
        const d = svgPath.getAttribute('d') || "";
        if (COPY_SIGNATURES.some(sig => d.includes(sig))) return true;
    }
    return false;
}

function findLastCopyButton() {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
    const copyButtons = candidates.filter(isCopyButton);
    return copyButtons.length > 0 ? copyButtons[copyButtons.length - 1] : null;
}



function findCopyButtonRelative(element) {
    if (!element) return null;
    const container = element.closest('article, [data-message-id], .group, .conversation-turn, .message-row, [role="row"]');
    const searchRoot = container || document.body;

    const treeWalker = document.createTreeWalker(
        searchRoot,
        NodeFilter.SHOW_ELEMENT,
        { acceptNode: function (node) { return NodeFilter.FILTER_ACCEPT; } }
    );

    treeWalker.currentNode = element;
    let attempts = 0;
    const MAX_NODES_TO_SCAN = searchRoot === document.body ? 50 : 500;

    while (treeWalker.nextNode() && attempts < MAX_NODES_TO_SCAN) {
        attempts++;
        const node = treeWalker.currentNode;

        if (!container && (node.tagName === 'ARTICLE' || node.classList.contains('group'))) {
            break;
        }

        if (node.tagName === 'BUTTON' || node.getAttribute('role') === 'button') {
            if (isCopyButton(node)) {
                return node;
            }
        }
    }
    return null;
}

function findAllMatches(text, regex, type) {
    let matches = [];
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(text)) !== null) {
        const candidate = match[0];
        const isIgnored = ignoredEntities.has(candidate.trim());
        matches.push({ start: match.index, end: match.index + candidate.length, text: candidate, type: type, isNLP: false, isIgnored: isIgnored });
    }
    return matches;
}

// Identify tokens currently used in the page (History) - these must NOT be modified
// We must ensure that we do NOT count the tokens currently in the Active Draft (Host Input OR Overlay) as "History".
const getLockedTokens = () => {
    // Use textContent instead of innerText to avoid forced layout reflow.
    // innerText triggers a full reflow which hangs the browser when the page has huge text (e.g. 1.7M chars in chat input).
    const bodyText = document.body.textContent;
    const allMatches = bodyText.match(/\[[A-Z]+_[A-Z0-9]+\]/g) || [];

    // Count total occurrences in Body
    const counts = {};
    allMatches.forEach(t => counts[t] = (counts[t] || 0) + 1);

    const substractTokens = (text, source) => {
        if (!text) return;
        const matches = text.match(/\[[A-Z]+_[A-Z0-9]+\]/g) || [];
        if (matches.length > 0) {
            matches.forEach(t => {
                if (counts[t]) counts[t]--;
            });
        }
    };

    // 1. Subtract occurrences in Active Target (Host Input)
    if (activeTarget) {
        // Value (for inputs/textareas)
        if (activeTarget.value !== undefined) substractTokens(activeTarget.value, "ActiveTarget.Value");

        // InnerText/Content (for contenteditable or just in case)
        substractTokens(activeTarget.textContent || "", "ActiveTarget.Content");

        // AGGRESSIVE SUBTRACTION:
        // Modern editors often duplicate content in a 'preview' div or 'hidden' div within the same wrapper.
        // We walk up 2 levels and subtract EVERYTHING found in that near vicinity to ensure we don't count
        // the "Ghost" draft copies as "History".
        let parent = activeTarget.parentElement;
        for (let i = 0; i < 3; i++) {
            if (parent && parent !== document.body && parent !== document.documentElement) {
                substractTokens(parent.textContent || "", `Parent_L${i}`);
                parent = parent.parentElement;
            }
        }
    }

    // 2. Subtract occurrences in Overlay (Shadow DOM)
    if (shadowRoot) {
        if (elInputText) substractTokens(elInputText.value, "Overlay.Input");

        if (elOutputText) substractTokens(elOutputText.innerText, "Overlay.Output");
    }

    // Any token with count > 0 is present OUTSIDE of the active draft logic -> Locked
    const locked = new Set();
    Object.keys(counts).forEach(k => {
        if (counts[k] > 0) locked.add(k);
    });
    return locked;
};

// ─── Native element writer ───────────────────────────────────────────────────
/**
 * Write `text` into `el` (textarea / input / contenteditable) with correct
 * line-break handling for each browser/framework combination.
 * Used by both sendToLLM (full overlay) and sendMasked (integrated overlay)
 * so the same insertion strategy is shared in one place.
 */
function writeToNativeEl(el, text) {
    if (!el) return;

    // ── Plain textarea / input ────────────────────────────────────────────────
    if (typeof el.value === 'string') {
        // Use native prototype setter to bypass React / framework value tracking.
        // Simply assigning el.value doesn't update React's internal state, so the
        // framework won't "see" the new text and pressing Send would send nothing.
        // NOTE: do NOT call el.focus() here — that triggers React's onFocus which
        // may reset the controlled-input state to '' before our value lands.
        // The caller is responsible for focusing in a prior animation frame.
        const proto = el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) {
            nativeSetter.call(el, text);
        } else {
            el.value = text;              // fallback
        }
        el.dispatchEvent(new InputEvent('input', {
            inputType: 'insertText', data: text, bubbles: true, cancelable: true,
        }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return;
    }

    // ── contenteditable ──────────────────────────────────────────────────────
    if (!el.isContentEditable) return;

    const isGemini = /google\.com|gemini/i.test(window.location.hostname);
    const isClaude = /claude\.ai/i.test(window.location.hostname);
    const isFirefox = /firefox/i.test(navigator.userAgent);

    // Focus FIRST so the browser knows where to put the cursor.
    el.focus();
    // Select all existing content via the editor's own mechanism.
    // This is ProseMirror/React-friendly: we never touch the DOM children directly.
    document.execCommand('selectAll', false, null);

    let success = false;

    if (isClaude) {
        // Claude ProseMirror: replace selection with per-line <p> tags
        const html = text.split('\n').map(l => `<p>${escapeHtml(l) || '<br>'}</p>`).join('');
        success = document.execCommand('insertHTML', false, html);
    } else if (isGemini) {
        const html = `<span style="white-space:pre-wrap">${escapeHtml(text)}</span>`;
        success = document.execCommand('insertHTML', false, html);
        console.log('[ChatWall writeToNativeEl] Gemini — execCommand result:', success);
    } else if (isFirefox) {
        const html = escapeHtml(text).replace(/\n/g, '<br>');
        success = document.execCommand('insertHTML', false, html);
    } else {
        // Chrome / Edge: try insertText first (preserves line breaks in most editors)
        success = document.execCommand('insertText', false, text);

        if (!success) {
            // Fallback: Range API with text nodes + <br>
            try {
                const sel = window.getSelection();
                if (sel && sel.rangeCount > 0) {
                    const range = sel.getRangeAt(0);
                    const lines = text.split('\n');
                    const frag = document.createDocumentFragment();
                    let lastNode = null;
                    lines.forEach((line, i) => {
                        if (line) { const t = document.createTextNode(line); frag.appendChild(t); lastNode = t; }
                        if (i < lines.length - 1) { const br = document.createElement('br'); frag.appendChild(br); lastNode = br; }
                    });
                    if (!lastNode) { lastNode = document.createTextNode(''); frag.appendChild(lastNode); }
                    range.deleteContents();
                    range.insertNode(frag);
                    range.setStartAfter(lastNode);
                    range.setEndAfter(lastNode);
                    sel.removeAllRanges();
                    sel.addRange(range);
                    success = true;
                }
            } catch (_) { /* fall through */ }
        }

        if (!success) {
            // Last resort: innerHTML (loses some editor state but content gets in)
            el.innerHTML = `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
            success = true;
        }
    }

    if (!success) {
        console.log('[ChatWall writeToNativeEl] ALL METHODS FAILED — falling back to innerText');
        el.innerText = text;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('[ChatWall writeToNativeEl] DONE — final innerText len:', el.innerText?.length);
}

