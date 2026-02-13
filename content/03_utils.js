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
        text = target.innerText || target.textContent || "";
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
