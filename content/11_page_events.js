/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */
// --- PAGE-LEVEL EVENTS & INITIALIZATION ---
// Global event listeners: chrome messages, typing detection, MutationObserver, bootstrap

// --- CHROME MESSAGE LISTENER ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'UPDATE_PLAN') {
        USER_PLAN = msg.plan;

        if (shadowRoot) {
            updatePlanUI();
            processText(true);
        }
        // Also refresh integrated overlay if it's open
        if (typeof inputOverlayIsOpen !== 'undefined' && inputOverlayIsOpen &&
            typeof processText === 'function') {
            processText(true);
        }
    }

    if (msg.action === "SHOW_OVERLAY") {
        handleShowOverlay();
        sendResponse({ ok: true });
    } else if (msg.action === "DEANONYMIZE_SELECTION") {
        const selectedHtml = getSelectionHtml();
        const content = (selectedHtml && selectedHtml.trim().length > 0) ? selectedHtml : msg.selectionText;

        if (!content || content.trim().length === 0) {
            showToast("No text selected to unmask", "error");
        } else {
            handleDeanonymize(content, true);
        }

    } else if (msg.action === "DEANONYMIZE_ELEMENT") {
        handleDeanonymizeElement();
    } else if (msg.action === "DEANONYMIZE_AND_COPY") {
        handleDeanonymizeAndCopy();
    } else if (msg.action === "CTX_UNMASK_PREVIEW") {
        (async () => {
            // ── Selection-scoped path ────────────────────────────────────────
            const sel = window.getSelection();
            const hasSelection = sel && sel.rangeCount > 0 && sel.toString().trim().length > 0;

            if (hasSelection) {
                const range = sel.getRangeAt(0);
                let container = range.commonAncestorContainer;
                if (container.nodeType === Node.TEXT_NODE) container = container.parentElement;
                // Convert raw tokens to pills, then reveal ONLY pills in the selection range
                if (typeof forceRedactContainer === 'function') await forceRedactContainer(container);
                if (typeof unmaskPillsInRange === 'function') unmaskPillsInRange(range, container);
                else await unmaskInResponseDOM(container, true);
                return; // no toast for unmask-only
            }

            // ── Full-container path ──────────────────────────────────────────
            let container = lastRightClickedElement
                ? lastRightClickedElement.closest('.markdown,.message-content,.text-base,.prose,.model-response')
                : null;
            if (!container && lastRightClickedElement) {
                let el = lastRightClickedElement;
                for (let i = 0; i < 12; i++) {
                    el = el.parentElement;
                    if (!el) break;
                    if ((el.innerText || '').length > 40) { container = el; break; }
                }
            }
            if (container) {
                if (typeof forceRedactContainer === 'function') await forceRedactContainer(container);
                await unmaskInResponseDOM(container, true);
                // No toast for unmask-only action
            } else {
                const selectedHtml = getSelectionHtml();
                if (selectedHtml && selectedHtml.trim().length > 0) {
                    handleDeanonymize(selectedHtml, true);
                } else {
                    const btn = findCopyButtonRelative(lastRightClickedElement);
                    handleDeanonymizeElement(btn, lastRightClickedElement);
                }
            }
        })();
    } else if (msg.action === "CTX_UNMASK_COPY") {
        (async () => {
            // ── Selection-scoped path ────────────────────────────────────────
            const sel = window.getSelection();
            const hasSelection = sel && sel.rangeCount > 0 && sel.toString().trim().length > 0;

            if (hasSelection) {
                const range = sel.getRangeAt(0);
                let container = range.commonAncestorContainer;
                if (container.nodeType === Node.TEXT_NODE) container = container.parentElement;

                // 1. Convert all [TOKEN] text nodes in container to pills (adds data-cw-orig)
                if (typeof forceRedactContainer === 'function') await forceRedactContainer(container);

                // 2. Clone range AFTER forceRedactContainer so pills have data-cw-orig set,
                //    then read original values from those attributes (shadow DOM not an issue).
                //    msg.selectionText is NOT used here because it doesn't include shadow DOM
                //    content from already-revealed pills.
                const unmasked = (typeof getRangeTextUnmasked === 'function')
                    ? await getRangeTextUnmasked(range)
                    : (msg.selectionText || '').replace(/\[[A-Z_]+_[A-Z0-9]+\]/g, async m => {
                        const tm = await getTokenMap(); return tm[m] || m;
                    });

                // 3. Reveal ONLY pills within the selection range (visual preview)
                if (typeof unmaskPillsInRange === 'function') unmaskPillsInRange(range, container);
                else await unmaskInResponseDOM(container, true);

                // 4. Copy to clipboard
                try {
                    await navigator.clipboard.writeText(unmasked);
                    showToastNear('✅ Selection Unmasked & Copied', null);
                } catch (_) { showToastNear('❌ Copy failed', null, 'error'); }
                return;
            }

            // ── Full-container path ──────────────────────────────────────────
            let container = lastRightClickedElement
                ? lastRightClickedElement.closest('.markdown,.message-content,.text-base,.prose,.model-response')
                : null;
            if (!container && lastRightClickedElement) {
                let el = lastRightClickedElement;
                for (let i = 0; i < 12; i++) {
                    el = el.parentElement;
                    if (!el) break;
                    if ((el.innerText || '').length > 40) { container = el; break; }
                }
            }
            if (container) {
                // Delegate to the same function used by the float button popup
                await unmaskAndCopyContainer(container, null);
            } else {
                // Fallback: try selected text or direct element
                const selectedHtml = getSelectionHtml();
                const selectedContent = (selectedHtml && selectedHtml.trim().length > 0) ? selectedHtml : msg.selectionText;
                if (selectedContent && selectedContent.trim().length > 0) {
                    try {
                        const tokenMap = await getTokenMap();
                        const regex = /\[[A-Z]+_[A-Z0-9]+\]/g;
                        const unmaskedHtml = selectedContent.replace(regex, match => tokenMap[match] || match);
                        const tmp = document.createElement('div');
                        tmp.innerHTML = unmaskedHtml;
                        const unmaskedText = tmp.innerText || tmp.textContent;
                        await navigator.clipboard.write([new ClipboardItem({
                            'text/html': new Blob([unmaskedHtml], { type: 'text/html' }),
                            'text/plain': new Blob([unmaskedText], { type: 'text/plain' })
                        })]);
                        showToastNear('✅ Copied (Unmasked)', null);
                    } catch (e) {
                        showToastNear('❌ Copy Failed', null, 'error');
                    }
                } else {
                    const btn = findCopyButtonRelative(lastRightClickedElement);
                    if (btn) {
                        handleUnmaskAndCopy(btn, 0, 0, lastRightClickedElement);
                    } else {
                        showToastNear('⚠️ No content found', null, 'error');
                    }
                }
            }
        })();
    }
});



// --- PAGE-LEVEL CONTEXT MENU ---

document.addEventListener('contextmenu', (event) => {
    if (overlayContainer && overlayContainer.contains(event.target)) return;
    lastRightClickedElement = event.target;
}, true);

document.addEventListener('contextmenu', async (e) => {
    const target = e.target;
    if (overlayContainer && overlayContainer.contains(target)) return;

    if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
    }

    let clickedBtn = target.closest('button, [role="button"]');
    if (clickedBtn && isCopyButton(clickedBtn)) {
        e.preventDefault();
        e.stopPropagation();
        responseContextMenuTarget = clickedBtn;
        showResponseMenu(e.pageX, e.pageY);
        return;
    }

    return;
}, true);

// --- TYPING DETECTION ---

let typingTimer;
const doneTypingInterval = 500;

function handleTyping(e) {
    // Skip events from our own overlay shadow DOM
    if (typeof inputOverlayContainer !== 'undefined' && inputOverlayContainer && inputOverlayContainer.contains(e.target)) return;
    if (e.target && e.target.id === 'cw-input-overlay-host') return;
    // Skip events from the ChatWall mode menu (email / licence fields etc.)
    if (typeof cwModeMenuEl !== 'undefined' && cwModeMenuEl && cwModeMenuEl.contains(e.target)) return;

    const editable = getEditableTarget(e.target);
    if (editable) {
        if (unmaskBtn) unmaskBtn.style.display = 'none';

        showFloatButton(editable);
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            analyzeContentRisk(editable);
        }, doneTypingInterval);
    }
}

document.addEventListener('keyup', handleTyping, true);
document.addEventListener('input', handleTyping, true);
document.addEventListener('focusin', (e) => {
    // Skip events retargeted from inside our own overlay shadow DOM
    if (typeof inputOverlayContainer !== 'undefined' && inputOverlayContainer && inputOverlayContainer.contains(e.target)) return;
    if (e.target && e.target.id === 'cw-input-overlay-host') return;
    // Skip mode menu inputs (email, licence key, etc.)
    if (typeof cwModeMenuEl !== 'undefined' && cwModeMenuEl && cwModeMenuEl.contains(e.target)) return;
    const editable = getEditableTarget(e.target);
    if (!editable) return;
    const floatOn = cwInputMode === 'float';
    // Integrated overlay is intentionally NOT opened on focus (avoids auto-open on
    // page-load / new-chat auto-focus). It is opened exclusively on click (see below).
    if (floatOn) showFloatButton(editable);
}, true);

document.addEventListener('click', (e) => {
    // Skip events retargeted from inside our own overlay shadow DOM
    if (typeof inputOverlayContainer !== 'undefined' && inputOverlayContainer && inputOverlayContainer.contains(e.target)) return;
    if (e.target && e.target.id === 'cw-input-overlay-host') return;
    // Skip mode menu inputs (email, licence key, etc.)
    if (typeof cwModeMenuEl !== 'undefined' && cwModeMenuEl && cwModeMenuEl.contains(e.target)) return;
    const editable = getEditableTarget(e.target);
    if (!editable) return;
    const inteOn = cwInputMode === 'integrated' || cwInputMode === 'both';
    const floatOn = cwInputMode === 'float';
    if (inteOn && typeof showInputOverlay === 'function') showInputOverlay(editable);
    if (floatOn) showFloatButton(editable);
}, true);

// --- SCROLL TRACKING ---

window.addEventListener('scroll', () => {

    if (currentFloatTarget && floatBtn && floatBtn.style.display !== 'none') {
        const anchor = currentFloatAnchor || currentFloatTarget;
        const rect = anchor.getBoundingClientRect();
        if (rect.width > 0) {
            floatBtn.style.top = `${rect.top + window.scrollY - 50}px`;
            floatBtn.style.left = `${rect.right + window.scrollX - 50}px`;
        }
    }

    if (unmaskBtn && unmaskBtn.style.display !== 'none') {
        updateUnmaskPosition(null);
    }
}, true);

// --- MUTATION OBSERVER (AI Response Detection) ---

let isChecking = false;

async function scanForCopyButtons() {

    const btn = findLastCopyButton();
    if (!btn) return;

    if (btn.getAttribute('data-cw-tracked') === 'true') {
        if (currentUnmaskTarget === btn && unmaskBtn && unmaskBtn.style.display === 'flex') {
            updateUnmaskPosition(btn);
        }
        return;
    }

    const tokenMap = await getTokenMap();

    let validContainer = null;
    let currentNode = btn;

    for (let i = 0; i < 10; i++) {
        currentNode = currentNode.parentElement;
        if (!currentNode) break;

        if (currentNode.tagName === 'SVG' || currentNode.tagName === 'PATH') continue;

        const text = currentNode.innerText || "";

        if (/\[[A-Z]+_[A-Z0-9]+\]/.test(text)) {
            const matches = text.match(/\[[A-Z]+_[A-Z0-9]+\]/g);
            if (matches && matches.some(t => tokenMap.hasOwnProperty(t))) {
                validContainer = currentNode;
                break;
            }
        }
    }

    if (validContainer) {
        if (currentUnmaskTarget && currentUnmaskTarget !== btn) {
            currentUnmaskTarget.removeAttribute('data-cw-tracked');
            if (activeResizeObserver) {
                activeResizeObserver.disconnect();
                activeResizeObserver = null;
            }
        }
        btn.setAttribute('data-cw-tracked', 'true');
        showUnmaskButton(btn);

        const mainInput = findMainInput();
        if (mainInput) {
            showFloatButton(mainInput);
        }

        activeResizeObserver = new ResizeObserver(() => {
            updateUnmaskPosition(btn);
        });
        activeResizeObserver.observe(validContainer);
    }
}

const aiResponseObserver = new MutationObserver((mutations) => {
    if (isChecking) return;
    isChecking = true;
    setTimeout(() => {
        scanForCopyButtons();
        isChecking = false;
    }, 500);
});

function initObserver() {
    setTimeout(() => {
        scanForCopyButtons();
        if (typeof aiResponseObserver !== 'undefined') {
            aiResponseObserver.observe(document.body, { childList: true, subtree: true });
        }
    }, 500);
}

// --- BOOTSTRAP ---

initObserver();
loadCounters();


document.addEventListener('selectionchange', () => {
    const sel = window.getSelection().toString();
    if (sel && sel.trim().length > 0) {
        lastSelectionText = sel;
    }
});
document.addEventListener('chatwall-test-open', function (e) {
    handleShowOverlay();
});
