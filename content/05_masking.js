/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */
// --- MASKING (OUTBOUND FLOW) ---
// User text → PII detection → token replacement → send to AI

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Factory: creates an isolated masking state (customWords, ignoredWords) with shared
 * match-merge algorithm. Used by both overlays to eliminate duplicated merge logic.
 */
function makeMaskingContext(opts = {}) {
    const customWords = opts.customWords || new Set();
    const ignoredWords = opts.ignoredWords || new Set();

    return {
        get customWords() { return customWords; },
        get ignoredWords() { return ignoredWords; },

        mask(word) {
            word = (word || '').trim();
            if (!word) return;
            customWords.add(word);
            ignoredWords.delete(word);
        },

        unmask(word) {
            word = (word || '').trim();
            if (!word) return;
            customWords.delete(word);
            ignoredWords.add(word);
        },

        // Return Match[] for all custom-masked words in rawText
        getWordMatches(text) {
            const out = [];
            for (const w of customWords) {
                const re = new RegExp(escapeRegex(w), 'gi');
                let m;
                while ((m = re.exec(text)) !== null)
                    out.push({ text: m[0], type: 'CUSTOM', start: m.index, end: m.index + m[0].length });
            }
            return out;
        },

        // Merge favorites > custom > nlp, de-overlap by priority (left-to-right, long wins ties)
        buildHighlights(rawText, nlpMatches, optFavorites) {
            const favs = optFavorites ||
                (typeof favoritesList !== 'undefined' ? favoritesList : new Set());

            const favMatches = [];
            for (const w of favs) {
                const re = new RegExp(escapeRegex(w), 'gi');
                let m;
                while ((m = re.exec(rawText)) !== null)
                    favMatches.push({ text: m[0], type: 'FAVORITE', start: m.index, end: m.index + m[0].length });
            }

            const customMatches = this.getWordMatches(rawText);
            const nlpFiltered = (nlpMatches || []).filter(m => !ignoredWords.has(m.text));

            const all = [...favMatches, ...customMatches, ...nlpFiltered]
                .sort((a, b) => a.start !== b.start ? a.start - b.start : (b.end - b.start) - (a.end - a.start));

            const filtered = [];
            let lastEnd = 0;
            for (const m of all) {
                if (m.start >= lastEnd) { filtered.push(m); lastEnd = m.end; }
            }
            return filtered;
        }
    };
}


function handleMaskAction(text) {
    if (!text) return;
    text = text.trim();
    if (ignoredEntities.has(text)) ignoredEntities.delete(text);
    if (!manualBlockList.includes(text)) manualBlockList.push(text);
    cachedLocalMatches = null; // Invalidate local regex cache

    // OPTIMIZED: Local Partial Update instead of Full Background Scan
    const inputText = elInputText;
    if (inputText) {
        const fullText = inputText.value;
        const escaped = escapeRegex(text);
        // Word Boundary? Maybe not for custom mask. 
        // User selection usually implies exact match.
        const regex = new RegExp(escaped, 'g');

        let newMatches = [];
        let match;
        while ((match = regex.exec(fullText)) !== null) {
            // Check for overlap with existing
            const mStart = match.index;
            const mEnd = mStart + match[0].length;

            // Only add if not already covered by a higher priority match
            // Actually, Custom Mask usually OVERRIDES.
            // But for simplicity, we just add it to the pool and let overlap logic (in background) sort it out later.
            // For now, we manually ensure we don't duplicate exact same match
            const exists = cachedNlpMatches.some(m => m.start === mStart && m.end === mEnd);
            if (!exists) {
                newMatches.push({
                    text: match[0],
                    type: 'CUSTOM', // or 'SECRET'
                    start: mStart,
                    end: mEnd,
                    isNLP: false,
                    isIgnored: false
                });
            }
        }

        if (newMatches.length > 0) {
            cachedNlpMatches = cachedNlpMatches.concat(newMatches);
            cachedNlpMatches.sort((a, b) => a.start - b.start);
            // Re-render immediately
            finalizeProcessing(cachedNlpMatches, 0, 0, 0);
        }
    } else {
        processText(true); // Fallback if no inputText
    }
}

async function handleUnmaskAction(text, targetMatch, start = null, end = null) {
    let itemsToUnmask = new Set();
    if (targetMatch) {
        itemsToUnmask.add(targetMatch.text);
    } else if (start !== null && end !== null && start !== end) {
        const matchesInSelection = currentMatches.filter(m => {
            return (m.start >= start && m.start < end) ||
                (m.end > start && m.end <= end) ||
                (start >= m.start && end <= m.end);
        });
        if (matchesInSelection.length > 0) {
            matchesInSelection.forEach(m => itemsToUnmask.add(m.text));
        } else if (text) {
            itemsToUnmask.add(text.trim());
        }
    } else if (text) {
        itemsToUnmask.add(text.trim());
    }

    const tokenMap = await getTokenMap();

    let changeMade = false;
    itemsToUnmask.forEach(raw => {
        if (!raw) return;
        if (!ignoredEntities.has(raw)) {
            ignoredEntities.add(raw);
            changeMade = true;
        }
        const idx = manualBlockList.indexOf(raw);
        if (idx > -1) {
            manualBlockList.splice(idx, 1);
            changeMade = true;
        }
        if (favoritesList.has(raw)) {
            favoritesList.delete(raw);
            saveFavorites();
            changeMade = true;
        }
        if (/^\[[A-Z]+_\d+\]$/.test(raw)) {
            const originalVal = tokenMap[raw];
            if (originalVal && !ignoredEntities.has(originalVal)) {
                ignoredEntities.add(originalVal);
                changeMade = true;
            }
        }
    });

    if (changeMade) {
        cachedLocalMatches = null; // Invalidate local regex cache
        // OPTIMIZED: Remove from local cache and re-render
        // Filter out matches that are now ignored
        const countBefore = cachedNlpMatches.length;
        cachedNlpMatches = cachedNlpMatches.filter(m => !itemsToUnmask.has(m.text));

        // Also check against resolved tokens (if they unmasked a Token Key)
        // ... logic already handled by checking itemsToUnmask against m.text

        if (cachedNlpMatches.length !== countBefore) {
            finalizeProcessing(cachedNlpMatches, 0, 0, 0);
        } else {
            // Nothing visible changed (maybe it was just a manualBlockList entry that wasn't matched yet)
            processText(true); // Fallback to be safe
        }
    }
}

function sendToLLM() {
    const finalMessage = elOutputText.innerText;
    let targetElement = activeTarget;

    fullOverlaySending = true; // tell hideOverlay not to copy back to integrated
    hideOverlay();
    fullOverlaySending = false;

    // When both overlays are open, also dismiss the integrated overlay
    // using the dedicated function that does NOT overwrite the native element
    // (sendToLLM has already put the correct masked content there).
    if (typeof inputOverlayIsOpen !== 'undefined' && inputOverlayIsOpen &&
        typeof dismissInputOverlayAfterSend === 'function') {
        dismissInputOverlayAfterSend();
    }

    if (!targetElement) return;

    // Write the masked text in two animation frames so the overlay DOM is fully
    // removed before we attempt to focus and write (same pattern as sendMasked).
    requestAnimationFrame(() => {
        // Re-validate target is still live
        if (!document.body.contains(targetElement)) {
            const fresh = findMainInput();
            if (fresh) targetElement = fresh;
        }

        // Focus the target. On Claude.ai findMainInput() may return a hidden backing
        // TEXTAREA that cannot receive browser focus (the real editor is a
        // contenteditable ProseMirror div). If focus silently fails, fall back to the
        // first visible focusable contenteditable — same logic as sendMasked.
        targetElement.focus();
        if (document.activeElement !== targetElement && document.activeElement === document.body) {
            const candidates = Array.from(
                document.querySelectorAll('[contenteditable="true"], [contenteditable=""], [role="textbox"]')
            ).filter(el => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            });
            for (const c of candidates) {
                c.focus();
                if (document.activeElement === c) { targetElement = c; break; }
            }
        }

        const isClaude = /claude\.ai/i.test(window.location.hostname);
        const needsExtraSettle = isClaude && targetElement.isContentEditable;

        const doWrite = () => {
            writeToNativeEl(targetElement, finalMessage);
            targetElement.focus();
        };

        if (needsExtraSettle) {
            setTimeout(doWrite, 80);
        } else {
            requestAnimationFrame(doWrite);
        }
    });
}


async function handleShowOverlay(overrideContent = null, preservedManualBlocks = []) {
    if (!isStorageLoaded) {
        await loadCounters();
    }

    // Determine the target input element for "Send to AI"
    // Priority: right-clicked editable element → page's main chat input
    activeTarget = lastRightClickedElement;
    if (!activeTarget || !getEditableTarget(activeTarget)) {
        activeTarget = findMainInput();
    }

    let initialContent = overrideContent;
    if (initialContent === null && activeTarget) {
        initialContent = extractTextFromElement(activeTarget);
    }

    manualBlockList = preservedManualBlocks || [];
    knownEntities = new Map();
    ignoredEntities = new Set();
    currentMatches = [];
    cachedNlpMatches = []; // Reset NLP match cache for new overlay session
    cachedLockedTokens = null; // Reset locked tokens cache for new overlay session
    lastRenderFingerprint = ""; // Reset render fingerprint for new overlay session
    cachedLocalMatches = null; // Reset local regex cache
    cachedLocalMatchesTextKey = "";
    activeTool = null;
    isMouseDown = false;

    syncUserPlan();
    loadFavorites();

    // Snapshot counters to define "History" vs "Transient" boundary
    // Tokens with ID index > initialCounters[type] are considered transient/reusable.
    initialCounters = { ...counters };

    if (!overlayContainer) await createOverlay();

    const tMask = shadowRoot.getElementById('toolMask');
    const tUnmask = shadowRoot.getElementById('toolUnmask');
    if (tMask) tMask.classList.remove('active');
    if (tUnmask) tUnmask.classList.remove('active');

    showOverlay(initialContent, 'anonymize');
    updatePlanUI();

    setTimeout(() => {
        if (initialContent && initialContent.trim().length > 0) {
            if (elInputText) {
                elInputText.value = initialContent;
                lastInputText = initialContent;
                cachedNlpMatches = [];

                // Immediate plain-text render so user sees content while analysis runs
                finalizeProcessing([], 0, 0, 0);

                elInputText.scrollTop = 0;
                if (elInputHighlights) elInputHighlights.scrollTop = 0;

                processText(false, true);
            }
        } else {
            if (elInputText) {
                elInputText.value = "";
                elInputText.focus();
                processText(false, true);
            }
        }
    }, 50);
}
