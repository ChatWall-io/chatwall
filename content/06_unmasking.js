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

async function handleDeanonymizeAndCopy() {
    const tokenMap = await getTokenMap();
    const res = await getUnmaskedContentFromElement();

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
            showToast("Unmasked content copied to clipboard!", "success");
        } catch (err) {
            console.error("Clipboard write failed", err);
            try {
                let txt = res.text.replace(/\[[A-Z]+_[A-Z0-9]+\]/g, (match) => tokenMap[match] || match);
                await navigator.clipboard.writeText(txt);
                showToast("Copied (Text Only)", "success");
            } catch (e2) {
                showToast("Failed to copy to clipboard", "error");
            }
        }
    } else {
        const element = lastRightClickedElement;
        if (element) {
            let target = element.closest('div, article, p') || element;
            let content = target.innerText || target.textContent || "";
            if (content.trim().length === 0) {
                showToast("No content found to unmask", "error");
                return;
            }
            // Fallback unmask and copy
            const tokenRegex = /\[[A-Z]+_[A-Z0-9]+\]/g;
            let restoredContent = content.replace(tokenRegex, (match) => tokenMap[match] || match);
            try {
                await navigator.clipboard.writeText(restoredContent);
                showToast("Unmasked content copied to clipboard!", "success");
            } catch (err) {
                showToast("Failed to copy to clipboard", "error");
            }
        } else {
            showToast("No content found to unmask", "error");
        }
    }
}

async function handleResponseAction(action) {
    if (!responseContextMenuTarget || !shadowRoot) return;

    const tokenMap = await getTokenMap();

    const menu = shadowRoot.getElementById('responseContextMenu');
    const rect = menu.getBoundingClientRect();
    const toastX = rect.left;
    const toastY = rect.top;

    hideResponseMenu();

    const selection = (currentSelectionText && currentSelectionText.trim().length > 0) ? currentSelectionText : null;

    if (action === 'UNMASK') {
        const targetIsBtn = isCopyButton(responseContextMenuTarget);
        const btn = targetIsBtn ? responseContextMenuTarget : findCopyButtonRelative(responseContextMenuTarget);

        handleDeanonymizeElement(btn, responseContextMenuTarget, selection);
    }
    else if (action === 'UNMASK_COPY') {
        const targetIsBtn = isCopyButton(responseContextMenuTarget);
        const btn = targetIsBtn ? responseContextMenuTarget : findCopyButtonRelative(responseContextMenuTarget);

        handleUnmaskAndCopy(btn, toastX, toastY, responseContextMenuTarget, selection);
    }
}
