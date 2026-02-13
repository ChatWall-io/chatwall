/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */
// --- CONTEXT MENU EVENTS ---
// Right-click context menu actions inside the overlay: cut, copy, paste, mask/unmask selection, favorites

function initContextMenuEvents(inputText, ctxMenu) {

    inputText.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const start = inputText.selectionStart;
        const end = inputText.selectionEnd;
        let text = inputText.value.substring(start, end).trim();
        contextMenuTargetMatch = null;

        if (!text) {
            const clickIdx = start;
            contextMenuTargetMatch = currentMatches.find(m => clickIdx >= m.start && clickIdx <= m.end);
            if (contextMenuTargetMatch) text = contextMenuTargetMatch.text;
        }

        if (ctxMenu) {
            ctxMenu.style.display = 'block';
            ctxMenu.style.left = `${e.clientX}px`;
            ctxMenu.style.top = `${e.clientY}px`;

            const maskBtn = shadowRoot.getElementById('ctxMask');
            const unmaskBtn = shadowRoot.getElementById('ctxUnmask');
            const unmaskCopyBtn = shadowRoot.getElementById('ctxUnmaskCopy');
            const addFavBtn = shadowRoot.getElementById('ctxAddFav');
            const remFavBtn = shadowRoot.getElementById('ctxRemFav');
            const sep1 = shadowRoot.getElementById('ctxSep1');

            const showMask = (text && !contextMenuTargetMatch);
            const showUnmask = (text || contextMenuTargetMatch);

            const isPremium = (USER_PLAN !== 'FREE');
            const isFavorite = favoritesList.has(text);

            const showAddFav = !!(addFavBtn && text && !isFavorite);
            const showRemFav = !!(remFavBtn && text && isFavorite);

            if (maskBtn) maskBtn.style.display = showMask ? 'flex' : 'none';
            if (unmaskBtn) unmaskBtn.style.display = showUnmask ? 'flex' : 'none';
            if (unmaskCopyBtn) unmaskCopyBtn.style.display = showUnmask ? 'flex' : 'none';

            if (addFavBtn) {
                addFavBtn.style.display = showAddFav ? 'flex' : 'none';
                if (showAddFav) {
                    if (isPremium) {
                        addFavBtn.classList.remove('menu-disabled');
                        addFavBtn.querySelector('.premium-lock-icon').style.display = 'none';
                    } else {
                        addFavBtn.classList.add('menu-disabled');
                        addFavBtn.querySelector('.premium-lock-icon').style.display = 'inline';
                    }
                }
            }

            if (remFavBtn) {
                remFavBtn.style.display = showRemFav ? 'flex' : 'none';
                if (showRemFav) {
                    if (isPremium) {
                        remFavBtn.classList.remove('menu-disabled');
                        remFavBtn.querySelector('.premium-lock-icon').style.display = 'none';
                    } else {
                        remFavBtn.classList.add('menu-disabled');
                        remFavBtn.querySelector('.premium-lock-icon').style.display = 'inline';
                    }
                }
            }

            const showTopSection = showMask || showUnmask || showAddFav || showRemFav;
            if (sep1) sep1.style.display = showTopSection ? 'block' : 'none';
        }
    });

    const ctxCut = shadowRoot.getElementById('ctxCut');
    if (ctxCut) ctxCut.addEventListener('click', () => {
        const start = inputText.selectionStart;
        const end = inputText.selectionEnd;
        if (start !== end) {
            const text = inputText.value.substring(start, end);
            navigator.clipboard.writeText(text);
            const val = inputText.value;
            inputText.value = val.substring(0, start) + val.substring(end);
            inputText.selectionStart = inputText.selectionEnd = start;
            processText(true);
        }
        ctxMenu.style.display = 'none';
    });

    const ctxSelectAll = shadowRoot.getElementById('ctxSelectAll');
    if (ctxSelectAll) ctxSelectAll.addEventListener('click', () => {
        inputText.select();
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
            const start = inputText.selectionStart;
            const end = inputText.selectionEnd;
            const val = inputText.value;
            inputText.value = val.substring(0, start) + t + val.substring(end);
            inputText.selectionStart = inputText.selectionEnd = start + t.length;
            processText(false, true);
        } catch (e) { }
        ctxMenu.style.display = 'none';
    });

    const ctxMask = shadowRoot.getElementById('ctxMask');
    if (ctxMask) ctxMask.addEventListener('click', () => {
        const text = inputText.value.substring(inputText.selectionStart, inputText.selectionEnd);
        handleMaskAction(text);
        ctxMenu.style.display = 'none';
    });

    const ctxUnmask = shadowRoot.getElementById('ctxUnmask');
    if (ctxUnmask) ctxUnmask.addEventListener('click', async () => {
        let textToUnmask = "";
        const start = inputText.selectionStart;
        const end = inputText.selectionEnd;
        textToUnmask = inputText.value.substring(start, end);

        if (contextMenuTargetMatch) {
            const tokenMap = await getTokenMap();
            const mapped = tokenMap[contextMenuTargetMatch.text];
            if (mapped) navigator.clipboard.writeText(mapped);
            else navigator.clipboard.writeText(contextMenuTargetMatch.text);
        } else if (textToUnmask) {
            const tokenMap = await getTokenMap();
            const mapped = tokenMap[textToUnmask.trim()];
            if (mapped) navigator.clipboard.writeText(mapped);
            else navigator.clipboard.writeText(textToUnmask);
        }

        handleUnmaskAction(textToUnmask, contextMenuTargetMatch);
        ctxMenu.style.display = 'none';
    });

    const ctxUnmaskCopy = shadowRoot.getElementById('ctxUnmaskCopy');
    if (ctxUnmaskCopy) ctxUnmaskCopy.addEventListener('click', async () => {
        let textToUnmask = "";
        const start = inputText.selectionStart;
        const end = inputText.selectionEnd;
        textToUnmask = inputText.value.substring(start, end);

        if (contextMenuTargetMatch) {
            const tokenMap = await getTokenMap();
            const mapped = tokenMap[contextMenuTargetMatch.text];
            if (mapped) navigator.clipboard.writeText(mapped);
            else navigator.clipboard.writeText(contextMenuTargetMatch.text);
        } else if (textToUnmask) {
            const tokenMap = await getTokenMap();
            const mapped = tokenMap[textToUnmask.trim()];
            if (mapped) navigator.clipboard.writeText(mapped);
            else navigator.clipboard.writeText(textToUnmask);
        }

        handleUnmaskAction(textToUnmask, contextMenuTargetMatch);
        ctxMenu.style.display = 'none';
    });

    const ctxAddFav = shadowRoot.getElementById('ctxAddFav');
    if (ctxAddFav) ctxAddFav.addEventListener('click', () => {
        if (USER_PLAN === 'FREE') return;

        let text = inputText.value.substring(inputText.selectionStart, inputText.selectionEnd).trim();
        if (!text && contextMenuTargetMatch) text = contextMenuTargetMatch.text;

        if (text) {
            ignoredEntities.delete(text); // Clear any prior unmask
            favoritesList.add(text);
            saveFavorites();
            cachedLocalMatches = null; // Invalidate local regex cache
            finalizeProcessing(cachedNlpMatches, 0, 0, 0);
        }
        ctxMenu.style.display = 'none';
    });

    const ctxRemFav = shadowRoot.getElementById('ctxRemFav');
    if (ctxRemFav) ctxRemFav.addEventListener('click', () => {
        if (USER_PLAN === 'FREE') return;

        let text = inputText.value.substring(inputText.selectionStart, inputText.selectionEnd).trim();
        if (!text && contextMenuTargetMatch) text = contextMenuTargetMatch.text;

        if (text && favoritesList.has(text)) {
            favoritesList.delete(text);
            saveFavorites();
            cachedLocalMatches = null; // Invalidate local regex cache
            finalizeProcessing(cachedNlpMatches, 0, 0, 0);
        }
        ctxMenu.style.display = 'none';
    });
}
