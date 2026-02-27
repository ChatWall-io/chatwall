/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */
// --- UNMASKING LOGIC (INBOUND FLOW) ---
// AI response → token detection → original text restoration → display/copy

async function getUnmaskedContentFromElement(elementOrBtn, directElement) {
    let copyBtn = elementOrBtn;

    const tokenMap = await getTokenMap();

    // 1. If no specific copy button provided, try text extraction from direct element
    if (!copyBtn && directElement) {
        let content = extractTextFromElement(directElement);
        // If content is empty, try finding the closest container
        if (!content) {
            const container = directElement.closest('div, p, article, li, pre, code, span');
            if (container) content = container.innerText || container.textContent || "";
        }

        if (content && content.trim().length > 0) {
            // Simulate a "success" response with the direct text
            content = content.replace(/\[[A-Z]+_[A-Z0-9]+\]/g, (match) => {
                const updated = tokenMap[match] || tokenMap[match.trim()] || match;
                return updated;
            });
            return { success: true, text: content, isHtml: false };
        }
    }

    // Fallback: Use Global Last Button only if we were NOT given a specific direct element
    if (!directElement && !copyBtn) {
        copyBtn = findLastCopyButton();
    }

    if (!copyBtn) return { success: false, error: "No Copy Button Found" };

    if (copyBtn) {
        try {
            const prevFocus = document.activeElement;

            // Force focus before click 
            copyBtn.focus();

            const clickEvent = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true
            });
            copyBtn.dispatchEvent(clickEvent);

            // Wait longer for site to write to clipboard
            await new Promise(r => setTimeout(r, 600));

            // Try reading standard Clipboard API first
            const items = await navigator.clipboard.read();
            let htmlContent = null;
            let plainContent = null;

            for (const item of items) {
                if (item.types.includes('text/html')) {
                    const blob = await item.getType('text/html');
                    htmlContent = await blob.text();
                }
                if (item.types.includes('text/plain')) {
                    const blob = await item.getType('text/plain');
                    plainContent = await blob.text();
                }
            }

            if (prevFocus) prevFocus.focus();

            if (htmlContent) {
                const raw = htmlContent.replace(/\[[A-Z]+_[A-Z0-9]+\]/g, (match) => tokenMap[match] || match);
                let rawPlain = null;
                if (plainContent) {
                    rawPlain = plainContent.replace(/\[[A-Z]+_[A-Z0-9]+\]/g, (match) => tokenMap[match] || match);
                }
                return { success: true, text: raw, raw: rawPlain, isHtml: true };
            }
            // Fallback for Read Text
            if (!htmlContent && !plainContent) {
                const text = await navigator.clipboard.readText();
                if (text) plainContent = text;
            }

            if (plainContent) {
                const raw = plainContent.replace(/\[[A-Z]+_[A-Z0-9]+\]/g, (match) => tokenMap[match] || match);
                const converted = simpleMarkdownToHtml(raw);
                return { success: true, text: converted, raw: raw, isHtml: true };
            }

        } catch (e) {
            console.log("Clipboard Copy Failed, falling back to DOM extraction.", e);
        }
    }

    // --- FALLBACK: DIRECT DOM EXTRACTION ---
    let targetEl = directElement;
    if (!targetEl && copyBtn) {
        targetEl = copyBtn.closest('.markdown, .message-content, .text-base, .prose');
        if (!targetEl) targetEl = copyBtn.parentElement?.parentElement;
    }

    if (targetEl) {
        let content = extractTextFromElement(targetEl);
        if (!content) {
            const container = targetEl.closest('div, p, article, li, pre, code, span');
            if (container) content = container.innerText || container.textContent || "";
        }

        if (content && content.trim().length > 0) {
            const raw = content.replace(/\[[A-Z]+_[A-Z0-9]+\]/g, (match) => tokenMap[match] || match);
            const converted = simpleMarkdownToHtml(raw);
            return { success: true, text: converted, raw: raw, isHtml: true };
        }
    }

    return { success: false, error: "Clipboard Empty & DOM Extraction Failed" };
}



async function handleUnmaskAndCopy(copyBtn, toastX, toastY, directElement, selectionText) {

    const tokenMap = await getTokenMap();

    // 1. Get Unmasked Content (via Button or Direct Element or Selection)
    const res = await getUnmaskedContentFromElement(copyBtn, directElement);

    if (res.success) {
        try {
            let htmlContent = "";
            let plainText = "";

            if (res.isHtml) {
                htmlContent = res.text;
                if (res.raw) {
                    plainText = res.raw;
                } else {
                    const tmp = document.createElement('div');
                    tmp.innerHTML = res.text;
                    plainText = tmp.innerText || tmp.textContent;
                }
            } else {
                plainText = res.text.replace(/\[[A-Z]+_[A-Z0-9]+\]/g, (match) => tokenMap[match] || match);
                htmlContent = simpleMarkdownToHtml(plainText);
                htmlContent = `<div>${htmlContent}</div>`;
            }

            const blobHtml = new Blob([htmlContent], { type: 'text/html' });
            const blobText = new Blob([plainText], { type: 'text/plain' });
            const data = [new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })];

            await navigator.clipboard.write(data);
            showResponseToast(`✅ ${chrome.i18n.getMessage('toast_unmasked_copied')}`, toastX, toastY);
        } catch (err) {
            console.error(err);
            try {
                let txt = res.text.replace(/\[[A-Z]+_[A-Z0-9]+\]/g, (match) => tokenMap[match] || match);
                await navigator.clipboard.writeText(txt);
                showResponseToast(`✅ ${chrome.i18n.getMessage('toast_unmasked_copied')}`, toastX, toastY);
            } catch (e2) {
                showResponseToast("❌ Copy Failed", toastX, toastY);
            }
        }
    } else {
        const element = lastRightClickedElement;
        if (element) {
            let target = element.closest('div, article, p') || element;
            let content = target.innerText || target.textContent || "";
            content = content.replace(/\[[A-Z]+_[A-Z0-9]+\]/g, (match) => tokenMap[match] || match);

            try {
                await navigator.clipboard.writeText(content);
                showResponseToast(`✅ ${chrome.i18n.getMessage('toast_unmasked_copied')}`, toastX, toastY);
            } catch (e) {
                showResponseToast("❌ Copy Failed", toastX, toastY);
            }
        } else {
            showResponseToast("⚠️ No content found", toastX, toastY);
        }
    }
}

async function handleDeanonymize(content, isHTMLSource = false) {
    if (!content) return;

    const tokenMap = await getTokenMap();

    const tokenRegex = /\[[A-Z]+_[A-Z0-9]+\]/g;


    let restoredContent = content.replace(tokenRegex, (match) => tokenMap[match] || match);
    let displayHtml = isHTMLSource ? restoredContent : simpleMarkdownToHtml(restoredContent);

    if (isHTMLSource && displayHtml) {
        displayHtml = displayHtml.replace(/style="[^"]*"/gi, '');
    }

    if (!overlayContainer) await createOverlay();

    showOverlay(displayHtml, 'deanonymize', true);
}

async function handleDeanonymizeElement(copyBtn, directElement, selectionText) {
    if (!overlayContainer) {
        await createOverlay();
    }
    const res = await getUnmaskedContentFromElement(copyBtn, directElement);
    if (res.success) {
        showOverlay(res.text, 'deanonymize', res.isHtml);
    } else {
        showToast(res.error || "Failed to unmask content", "error");
    }
}

/**
 * Canonical implementation of "Unmask & Copy" for a known container.
 * Used by BOTH the float-button popup AND the right-click context menu so they
 * share the exact same business logic.
 *
 * Steps:
 *  1. forceRedactContainer  – convert raw [TOKEN] text nodes → pills
 *  2. unmaskInResponseDOM   – reveal pills in green preview mode
 *  3. Dual clipboard write  – text/plain (line-break-preserving) + text/html (rich)
 *  4. showToastNear         – toast near anchorEl (or top-right fallback)
 */
async function unmaskAndCopyContainer(container, anchorEl = null) {
    if (!container) {
        showToastNear('⚠️ No response found to unmask', anchorEl, 'error');
        return;
    }
    // 1. Convert raw [TOKEN] text nodes to pills
    if (typeof forceRedactContainer === 'function') await forceRedactContainer(container);
    // 2. Reveal pills as green preview
    await unmaskInResponseDOM(container, true);
    // 3. Build dual-format clipboard content
    const [plainText, richHtml] = await Promise.all([
        getContainerTextUnmasked(container),
        getContainerHtmlUnmasked(container)
    ]);
    // 4. Write to clipboard with fallback
    try {
        await navigator.clipboard.write([new ClipboardItem({
            'text/plain': new Blob([plainText], { type: 'text/plain' }),
            'text/html': new Blob([richHtml], { type: 'text/html' })
        })]);
        showToastNear('✅ Unmasked & Copied', anchorEl);
    } catch (_) {
        try {
            await navigator.clipboard.writeText(plainText);
            showToastNear('✅ Unmasked & Copied', anchorEl);
        } catch (e) {
            showToastNear('❌ Copy failed', anchorEl, 'error');
        }
    }
}

/**
 * "Unmask & Copy last response" — called by the green float button popup.
 * Finds the last AI response on the page then delegates to unmaskAndCopyContainer.
 */
async function handleDeanonymizeAndCopy(anchorEl = null) {
    const RESPONSE_SELECTORS = [
        // ChatGPT
        '[data-message-author-role="assistant"]',
        '[data-testid*="conversation-turn"]:not([data-testid*="user"])',
        // Gemini
        '[data-message-author-role="model"]',
        '.response-container-content',
        '.model-response-text',
        '.formatted-text',
        // Claude
        '.model-response', '.agent-turn', '.is-assistant',
        // Generic / others
        '.bot-message', '.prose', '.markdown', '.message-content',
        '[class*="assistant"]', '[class*="bot-message"]', '[class*="model-message"]'
    ].join(',');

    const allResponses = Array.from(document.querySelectorAll(RESPONSE_SELECTORS))
        .filter(el => (el.innerText || '').trim().length > 20);
    const container = allResponses.length ? allResponses[allResponses.length - 1] : null;

    await unmaskAndCopyContainer(container, anchorEl);
}

/**
 * Permanently unmask all tokens inside a response DOM container.
 *
 * @param {Element} container - the AI response wrapper
 * @param {boolean} previewMode - if true, keep text inside closed shadow DOM
 *   (adds .cw-revealed host class); if false, replace with plain text nodes.
 */
async function unmaskInResponseDOM(container, previewMode = false) {
    if (!container) return;

    // 1. Handle [data-cw-redact] pill elements (created by 14_response_redact.js)
    const pills = Array.from(container.querySelectorAll('[data-cw-redact]'));

    if (previewMode) {
        // SECURE PREVIEW: add .cw-revealed class to the host element.
        // • The pill's shadow CSS (:host(.cw-revealed)) switches to green revealed style.
        // • The original value lives entirely inside the closed shadow DOM.
        // • Host page JS cannot access it via textContent, innerText, or shadowRoot.
        for (const pill of pills) {
            pill.classList.add('cw-revealed');
            pill.title = 'ChatWall — content revealed (protected)';
        }
        // Raw [TYPE_N] text nodes: wrap them as revealed pills too
        const tokenMap = await getTokenMap();
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let n;
        while ((n = walker.nextNode())) nodes.push(n);
        const re = /\[[A-Z_]+_[A-Z0-9]+\]/g;
        for (const node of nodes) {
            if (!node.isConnected) continue;
            const t = node.textContent;
            re.lastIndex = 0;
            if (!re.test(t)) continue;
            re.lastIndex = 0;
            // Split the text node around tokens − replace each token with a revealed pill
            const frag = document.createDocumentFragment();
            let last = 0;
            let m;
            re.lastIndex = 0;
            while ((m = re.exec(t)) !== null) {
                if (m.index > last) frag.appendChild(document.createTextNode(t.slice(last, m.index)));
                const token = m[0];
                const orig = tokenMap[token] || token;
                const typeMatch = token.match(/^\[([A-Z_]+)_/);
                const type = typeMatch ? typeMatch[1] : 'TOKEN';
                if (typeof makePill === 'function') {
                    const p = makePill(type, orig);
                    p.classList.add('cw-revealed');
                    p.title = 'ChatWall — content revealed (protected)';
                    frag.appendChild(p);
                } else {
                    frag.appendChild(document.createTextNode(orig));
                }
                last = re.lastIndex;
            }
            if (last < t.length) frag.appendChild(document.createTextNode(t.slice(last)));
            node.parentNode.replaceChild(frag, node);
        }
        return;
    }

    // PLAIN-TEXT REPLACEMENT (used only for clipboard copy reconstruction)
    const tokenMap = await getTokenMap();
    for (const pill of pills) {
        const orig = pill.getAttribute('data-cw-orig') || '';
        try { pill.replaceWith(document.createTextNode(orig)); } catch (_) { }
    }
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    const re = /\[[A-Z_]+_[A-Z0-9]+\]/g;
    for (const node of nodes) {
        if (!node.isConnected) continue;
        const t = node.textContent;
        re.lastIndex = 0;
        if (!re.test(t)) continue;
        re.lastIndex = 0;
        node.textContent = t.replace(re, (m) => tokenMap[m] || m);
    }
}

/**
 * Extracts plain text from a DOM element (can be detached) while preserving
 * line breaks from block elements and <br> — unlike innerText which requires
 * the element to be in a rendered layout to produce correct line breaks.
 */
function domToPlainText(el) {
    const BLOCK = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'BLOCKQUOTE', 'PRE', 'BR', 'HR']);
    let out = '';
    function walk(node) {
        if (node.nodeType === Node.TEXT_NODE) { out += node.nodeValue; return; }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const tag = node.tagName;
        if (tag === 'BR') { out += '\n'; return; }
        if (tag === 'HR') { out += '\n---\n'; return; }
        if (tag === 'SCRIPT' || tag === 'STYLE') return;
        const isBlock = BLOCK.has(tag);
        if (isBlock && out.length > 0 && out[out.length - 1] !== '\n') out += '\n';
        if (tag === 'LI') out += '\u2022 ';
        for (const child of node.childNodes) walk(child);
        if (isBlock && out.length > 0 && out[out.length - 1] !== '\n') out += '\n';
    }
    walk(el);
    return out.trim().replace(/\n{3,}/g, '\n\n');
}

/**
 * Reveal ONLY the pills that intersect the given selection Range.
 * Used for selection-scoped "Unmask" to avoid revealing the whole container.
 */
function unmaskPillsInRange(range, container) {
    const pills = container.querySelectorAll('[data-cw-redact]');
    for (const pill of pills) {
        try {
            if (range.intersectsNode(pill)) pill.classList.add('cw-revealed');
        } catch (_) { }
    }
}

/**
 * Build the unmasked text of a container WITHOUT mutating it.
 * Reads data-cw-orig attributes (extension context) and raw tokenMap.
 */
async function getContainerTextUnmasked(container) {
    const tokenMap = await getTokenMap();
    // Clone the container to avoid mutating the live DOM
    const clone = container.cloneNode(true);
    // In the clone, pill hosts have no shadow — replace each with its orig text
    for (const pill of clone.querySelectorAll('[data-cw-redact]')) {
        const orig = pill.getAttribute('data-cw-orig') || '';
        try { pill.replaceWith(document.createTextNode(orig)); } catch (_) { }
    }
    // Use domToPlainText (not innerText) so detached clones preserve line breaks
    const re = /\[[A-Z_]+_[A-Z0-9]+\]/g;
    const text = domToPlainText(clone);
    return text.replace(re, (m) => tokenMap[m] || m);
}

/**
 * Extracts unmasked plain text from a selection Range.
 * MUST be called AFTER forceRedactContainer so [TOKEN] text nodes have been
 * converted to <cw-pill data-cw-orig="..."> elements (no shadow DOM in clone).
 */
async function getRangeTextUnmasked(range) {
    const tokenMap = await getTokenMap();
    const fragment = range.cloneContents();
    const wrapper = document.createElement('div');
    wrapper.appendChild(fragment);
    // Replace pill elements with their stored original values
    for (const pill of wrapper.querySelectorAll('[data-cw-redact]')) {
        const orig = pill.getAttribute('data-cw-orig') || '';
        try { pill.replaceWith(document.createTextNode(orig)); } catch (_) { }
    }
    // Replace any leftover raw tokens
    const re = /\[[A-Z_]+_[A-Z0-9]+\]/g;
    return domToPlainText(wrapper).replace(re, m => tokenMap[m] || m);
}


/**
 * Returns the container's HTML with all masked tokens replaced by their
 * original values — suitable for rich-text clipboard (Gmail, Notion, etc.).
 * Pill elements are replaced by a plain <span> so formatting is preserved.
 */
async function getContainerHtmlUnmasked(container) {
    const tokenMap = await getTokenMap();
    const clone = container.cloneNode(true);
    // Replace pill elements with plain text spans (preserves surrounding HTML)
    for (const pill of clone.querySelectorAll('[data-cw-redact]')) {
        const orig = pill.getAttribute('data-cw-orig') || '';
        const span = document.createElement('span');
        span.textContent = orig;
        try { pill.replaceWith(span); } catch (_) { }
    }
    // Replace any leftover raw [TOKEN] text nodes
    const re = /\[[A-Z_]+_[A-Z0-9]+\]/g;
    // Walk text nodes in clone
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const node of textNodes) {
        if (re.test(node.nodeValue)) {
            re.lastIndex = 0;
            node.nodeValue = node.nodeValue.replace(re, m => tokenMap[m] || m);
        }
    }
    return clone.innerHTML;
}


async function handleResponseAction(action) {
    if (!responseContextMenuTarget) return;

    hideResponseMenu();

    // Find the AI response container from the right-clicked copy button
    let container = responseContextMenuTarget.closest('.markdown,.message-content,.text-base,.prose,.model-response');
    if (!container) {
        let el = responseContextMenuTarget;
        for (let i = 0; i < 12; i++) {
            el = el.parentElement;
            if (!el) break;
            if ((el.innerText || '').length > 40) { container = el; break; }
        }
    }

    if (!container) {
        showToast('⚠️ No response content found', 'error');
        return;
    }

    if (action === 'UNMASK') {
        // Ensure raw [TOKEN] text is first converted to pills, then revealed
        if (typeof forceRedactContainer === 'function') await forceRedactContainer(container);
        await unmaskInResponseDOM(container, true);
        // No toast for unmask-only action

    } else if (action === 'UNMASK_COPY') {
        // 1. Force-create pills then reveal green preview
        if (typeof forceRedactContainer === 'function') await forceRedactContainer(container);
        await unmaskInResponseDOM(container, true);
        // 2. Copy unmasked content — dual format: plain text + rich HTML
        const [plainText, richHtml] = await Promise.all([
            getContainerTextUnmasked(container),
            getContainerHtmlUnmasked(container)
        ]);
        try {
            await navigator.clipboard.write([new ClipboardItem({
                'text/plain': new Blob([plainText], { type: 'text/plain' }),
                'text/html': new Blob([richHtml], { type: 'text/html' })
            })]);
            showToast('✅ Unmasked & Copied', 'success');
        } catch (_) {
            try { await navigator.clipboard.writeText(plainText); showToast('✅ Unmasked & Copied', 'success'); }
            catch (e) { showToast('❌ Copy failed', 'error'); }
        }
    }
}

