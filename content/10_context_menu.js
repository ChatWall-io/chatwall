/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */
// --- CONTEXT MENU EVENTS ---
// Right-click context menu: 3 smart items whose label + action adapt to context.

/**
 * Returns the word boundaries around `pos` in `text` (whitespace-delimited).
 * Returns null if the cursor is on whitespace.
 */
function getWordAt(text, pos) {
    if (!text || pos < 0 || pos > text.length) return null;
    let start = pos, end = pos;
    while (start > 0 && !/\s/.test(text[start - 1])) start--;
    while (end < text.length && !/\s/.test(text[end])) end++;
    if (start >= end) return null;
    return { start, end, text: text.substring(start, end) };
}

function initContextMenuEvents(inputText, ctxMenu) {

    const ctxMask = shadowRoot.getElementById('ctxMask');
    const ctxUnmask = shadowRoot.getElementById('ctxUnmask');
    const ctxAddFav = shadowRoot.getElementById('ctxAddFav');
    const ctxRemFav = shadowRoot.getElementById('ctxRemFav');
    const ctxUnmaskCopy = shadowRoot.getElementById('ctxUnmaskCopy');
    const sep1 = shadowRoot.getElementById('ctxSep1');

    // Always hide the separate "Remove favorite" and "Unmask & Copy" items —
    // their logic is folded into ctxUnmask / ctxAddFav respectively.
    if (ctxRemFav) ctxRemFav.style.display = 'none';
    if (ctxUnmaskCopy) ctxUnmaskCopy.style.display = 'none';

    // Helper to read the SVG + set a text label on an <li>
    const setLabel = (li, text) => {
        if (!li) return;
        // Keep the first <span> child (icon), update/replace the text node after it
        const span = li.querySelector('span');
        // Remove old text nodes
        Array.from(li.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE || (n.nodeType === Node.ELEMENT_NODE && !n.classList.contains('premium-lock-icon') && n !== span))
            .forEach(n => n.remove());
        li.appendChild(document.createTextNode(' ' + text));
    };

    // ── Contextmenu event: resolve context, update labels and show/hide ───────
    inputText.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const selStart = inputText.selectionStart;
        const selEnd = inputText.selectionEnd;
        const hasSelection = selStart !== selEnd;
        const selText = hasSelection ? inputText.value.substring(selStart, selEnd).trim() : '';
        const cursorPos = selStart;

        // Token at / around cursor
        contextMenuTargetMatch = !hasSelection
            ? (currentMatches || []).find(m => cursorPos >= m.start && cursorPos <= m.end) || null
            : null;

        // Word at cursor (when no selection)
        const wordAt = hasSelection ? null : getWordAt(inputText.value, cursorPos);

        // What text are we targeting?
        const targetText = selText || (contextMenuTargetMatch ? contextMenuTargetMatch.text : null) || (wordAt ? wordAt.text : null) || '';

        const isPremium = (USER_PLAN !== 'FREE');
        const isFavorite = targetText ? favoritesList.has(targetText) : false;
        const isToken = !!(contextMenuTargetMatch || (hasSelection && (currentMatches || []).some(m => m.start >= selStart && m.end <= selEnd)));

        // ── 1. MASK item ──────────────────────────────────────────────────────
        let showMask = false, maskLabel = '';
        if (hasSelection && selText) {
            showMask = true;
            maskLabel = 'Mask selection';
        } else if (wordAt && !contextMenuTargetMatch) {
            showMask = true;
            maskLabel = `Mask "${wordAt.text}"`;
        }
        if (ctxMask) {
            ctxMask.style.display = showMask ? 'flex' : 'none';
            if (showMask) setLabel(ctxMask, maskLabel);
        }

        // ── 2. UNMASK / REMOVE FAVORITE item ─────────────────────────────────
        let showUnmask = false, unmaskLabel = '';
        if (isFavorite) {
            showUnmask = true;
            unmaskLabel = 'Remove from favorites';
        } else if (isToken || contextMenuTargetMatch) {
            showUnmask = true;
            unmaskLabel = hasSelection ? 'Unmask selection' : 'Unmask token';
        }
        if (ctxUnmask) {
            ctxUnmask.style.display = showUnmask ? 'flex' : 'none';
            if (showUnmask) setLabel(ctxUnmask, unmaskLabel);
        }

        // ── 3. ADD TO FAVORITES item ──────────────────────────────────────────
        let showFav = false, favLabel = '';
        if (!isFavorite && targetText) {
            showFav = true;
            favLabel = hasSelection ? 'Add selection to favorites' : `Add "${targetText}" to favorites`;
        }
        if (ctxAddFav) {
            ctxAddFav.style.display = showFav ? 'flex' : 'none';
            if (showFav) {
                setLabel(ctxAddFav, favLabel);
                if (isPremium) {
                    ctxAddFav.classList.remove('menu-disabled');
                    const lock = ctxAddFav.querySelector('.premium-lock-icon');
                    if (lock) lock.style.display = 'none';
                } else {
                    ctxAddFav.classList.add('menu-disabled');
                    const lock = ctxAddFav.querySelector('.premium-lock-icon');
                    if (lock) lock.style.display = 'inline';
                }
            }
        }

        if (sep1) sep1.style.display = (showMask || showUnmask || showFav) ? 'block' : 'none';

        ctxMenu.style.display = 'block';
        ctxMenu.style.left = `${e.clientX}px`;
        ctxMenu.style.top = `${e.clientY}px`;
    });

    // ── Cut / Copy / Paste / Select all (unchanged) ───────────────────────────
    const ctxCut = shadowRoot.getElementById('ctxCut');
    if (ctxCut) ctxCut.addEventListener('click', () => {
        const s = inputText.selectionStart, e2 = inputText.selectionEnd;
        if (s !== e2) {
            navigator.clipboard.writeText(inputText.value.substring(s, e2));
            inputText.value = inputText.value.substring(0, s) + inputText.value.substring(e2);
            inputText.selectionStart = inputText.selectionEnd = s;
            processText(true);
        }
        ctxMenu.style.display = 'none';
    });

    const ctxCopy = shadowRoot.getElementById('ctxCopy');
    if (ctxCopy) ctxCopy.addEventListener('click', () => {
        const t = inputText.value.substring(inputText.selectionStart, inputText.selectionEnd);
        if (t) navigator.clipboard.writeText(t);
        ctxMenu.style.display = 'none';
    });

    const ctxPaste = shadowRoot.getElementById('ctxPaste');
    if (ctxPaste) ctxPaste.addEventListener('click', async () => {
        try {
            const t = await navigator.clipboard.readText();
            const s = inputText.selectionStart, e2 = inputText.selectionEnd;
            inputText.value = inputText.value.substring(0, s) + t + inputText.value.substring(e2);
            inputText.selectionStart = inputText.selectionEnd = s + t.length;
            processText(false, true);
        } catch (e) { }
        ctxMenu.style.display = 'none';
    });

    const ctxSelectAll = shadowRoot.getElementById('ctxSelectAll');
    if (ctxSelectAll) ctxSelectAll.addEventListener('click', () => {
        inputText.select();
        ctxMenu.style.display = 'none';
    });

    // ── MASK action ───────────────────────────────────────────────────────────
    if (ctxMask) ctxMask.addEventListener('click', () => {
        const s = inputText.selectionStart, e2 = inputText.selectionEnd;
        if (s !== e2) {
            // Mask selected text
            handleMaskAction(inputText.value.substring(s, e2));
        } else {
            // Mask word at cursor
            const w = getWordAt(inputText.value, s);
            if (w) handleMaskAction(w.text);
        }
        ctxMenu.style.display = 'none';
    });

    // ── UNMASK / REMOVE FAVORITE action ───────────────────────────────────────
    if (ctxUnmask) ctxUnmask.addEventListener('click', async () => {
        const s = inputText.selectionStart, e2 = inputText.selectionEnd;
        const hasSelection = s !== e2;
        const selText = hasSelection ? inputText.value.substring(s, e2).trim() : '';
        const wordAt = hasSelection ? null : getWordAt(inputText.value, s);
        const targetText = selText || (contextMenuTargetMatch ? contextMenuTargetMatch.text : null) || (wordAt ? wordAt.text : null) || '';

        const isFavorite = targetText ? favoritesList.has(targetText) : false;

        if (isFavorite) {
            // Remove from favorites
            if (USER_PLAN !== 'FREE') {
                favoritesList.delete(targetText);
                saveFavorites();
                cachedLocalMatches = null;
                finalizeProcessing(cachedNlpMatches, 0, 0, 0);
            }
        } else {
            // Unmask: add to ignoredEntities / apply handleUnmaskAction
            handleUnmaskAction(selText, contextMenuTargetMatch);
        }
        ctxMenu.style.display = 'none';
    });

    // ── ADD TO FAVORITES action ───────────────────────────────────────────────
    if (ctxAddFav) ctxAddFav.addEventListener('click', () => {
        if (USER_PLAN === 'FREE') return;
        const s = inputText.selectionStart, e2 = inputText.selectionEnd;
        const hasSelection = s !== e2;
        let text = hasSelection ? inputText.value.substring(s, e2).trim() : '';
        if (!text) {
            const w = getWordAt(inputText.value, s);
            text = w ? w.text : '';
        }
        if (!text && contextMenuTargetMatch) text = contextMenuTargetMatch.text;
        if (text) {
            ignoredEntities.delete(text);
            favoritesList.add(text);
            saveFavorites();
            cachedLocalMatches = null;
            finalizeProcessing(cachedNlpMatches, 0, 0, 0);
        }
        ctxMenu.style.display = 'none';
    });
}
