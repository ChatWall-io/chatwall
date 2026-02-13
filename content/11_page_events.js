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
        const selectedHtml = getSelectionHtml();
        if (selectedHtml && selectedHtml.trim().length > 0) {
            handleDeanonymize(selectedHtml, true);
        } else {
            const btn = findCopyButtonRelative(lastRightClickedElement);
            handleDeanonymizeElement(btn, lastRightClickedElement);
        }
    } else if (msg.action === "CTX_UNMASK_COPY") {
        const selectedHtml = getSelectionHtml();
        const selectedContent = (selectedHtml && selectedHtml.trim().length > 0) ? selectedHtml : msg.selectionText;
        if (selectedContent && selectedContent.trim().length > 0) {
            (async () => {
                try {
                    const tokenMap = await getTokenMap();
                    const regex = /\[[A-Z]+_[A-Z0-9]+\]/g;
                    const unmaskedHtml = selectedContent.replace(regex, (match) => tokenMap[match] || match);
                    const tmp = document.createElement('div');
                    tmp.innerHTML = unmaskedHtml;
                    const unmaskedText = tmp.innerText || tmp.textContent;

                    const blobHtml = new Blob([unmaskedHtml], { type: 'text/html' });
                    const blobText = new Blob([unmaskedText], { type: 'text/plain' });
                    const data = [new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })];

                    navigator.clipboard.write(data).then(() => {
                        showToast("✅ Copied Selection (Unmasked)", "success");
                    });
                } catch (e) {
                    console.error("Selection Copy Failed", e);
                    showToast("❌ Copy Failed", "error");
                }
            })();
        } else {
            const btn = findCopyButtonRelative(lastRightClickedElement);
            if (btn) {
                handleUnmaskAndCopy(btn, 0, 0, lastRightClickedElement);
            } else {
                const element = lastRightClickedElement;
                if (element) {
                    let target = element.closest('div, article, p') || element;
                    let content = target.innerText || target.textContent || "";
                    (async () => {
                        const tokenMap = await getTokenMap();
                        content = content.replace(/\[[A-Z]+_[A-Z0-9]+\]/g, (match) => tokenMap[match] || match);
                        navigator.clipboard.writeText(content).then(() => {
                            showToast("✅ Copied (Unmasked)", "success");
                        }).catch(() => {
                            showToast("❌ Copy Failed", "error");
                        });
                    })();
                } else {
                    showToast("⚠️ No content found", "error");
                }
            }
        }
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
    const editable = getEditableTarget(e.target);
    if (editable) showFloatButton(editable);
}, true);

document.addEventListener('click', (e) => {
    const editable = getEditableTarget(e.target);
    if (editable) showFloatButton(editable);
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
