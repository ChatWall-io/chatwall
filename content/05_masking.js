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
    let finalMessage = elOutputText.innerText;
    const targetElement = activeTarget;
    if (targetElement) {
        if (targetElement.value !== undefined) {
            targetElement.value = finalMessage;
            targetElement.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (targetElement.isContentEditable) {
            targetElement.focus();
            while (targetElement.firstChild) {
                targetElement.removeChild(targetElement.firstChild);
            }
            const isGemini = window.location.hostname.includes('google.com') || window.location.hostname.includes('gemini');
            const isClaude = window.location.hostname.includes('claude.ai');
            const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
            let success = false;

            if (isClaude && isFirefox) {
                // Claude Fix: Paragraph injection strategy.
                // We wrap each line in a <p> tag to ensure the editor respects structure.
                const lines = finalMessage.split('\n');
                const htmlLines = lines.map(line => {
                    const safe = escapeHtml(line);
                    return `<p>${safe || '<br>'}</p>`;
                });
                const html = htmlLines.join('');
                success = document.execCommand('insertHTML', false, html);
            } else if (isGemini) {
                const safeText = escapeHtml(finalMessage);
                const html = `<span style="white-space: pre-wrap;">${safeText}</span>`;
                success = document.execCommand('insertHTML', false, html);
            } else if (isFirefox) {
                // Firefox Fix for others (ChatGPT etc): insertText strips newlines. 
                // We force <br> injection.
                const safeText = escapeHtml(finalMessage).replace(/\n/g, '<br>');
                success = document.execCommand('insertHTML', false, safeText);
            } else {
                // Optimization: For large text, avoid execCommand('insertText') which freezes the browser
                // due to synchronous editor processing. Direct DOM manipulation is instant.
                if (finalMessage.length > 5000) {
                    const safeText = escapeHtml(finalMessage).replace(/\n/g, '<br>');
                    targetElement.innerHTML = `<p>${safeText}</p>`;
                    targetElement.dispatchEvent(new Event('input', { bubbles: true }));
                    success = true;
                } else {
                    // FIX: Use Range API instead of execCommand to avoid Clipboard interference
                    try {
                        const sel = window.getSelection();
                        if (sel.rangeCount > 0) {
                            // FIX: Handle newlines manually by inserting BR tags
                            const range = sel.getRangeAt(0);
                            const lines = finalMessage.split('\n');
                            const fragment = document.createDocumentFragment();
                            let lastNode = null;

                            lines.forEach((line, index) => {
                                if (line) {
                                    const tNode = document.createTextNode(line);
                                    fragment.appendChild(tNode);
                                    lastNode = tNode;
                                }
                                if (index < lines.length - 1) {
                                    const br = document.createElement('br');
                                    fragment.appendChild(br);
                                    lastNode = br;
                                }
                            });

                            if (!lastNode && lines.length > 0) {
                                // Empty content case?
                                const tNode = document.createTextNode("");
                                fragment.appendChild(tNode);
                                lastNode = tNode;
                            }

                            range.deleteContents();
                            range.insertNode(fragment);

                            // Move cursor after
                            if (lastNode) {
                                range.setStartAfter(lastNode);
                                range.setEndAfter(lastNode);
                            }
                            sel.removeAllRanges();
                            sel.addRange(range);

                            targetElement.dispatchEvent(new Event('input', { bubbles: true }));
                            success = true;
                        } else {
                            // Fallback if no selection
                            success = document.execCommand('insertText', false, finalMessage);
                        }
                    } catch (e) {
                        success = document.execCommand('insertText', false, finalMessage);
                    }
                }
            }

            if (!success) {
                targetElement.innerText = finalMessage;
                targetElement.dispatchEvent(new Event('input', { bubbles: true }));
            }
        } else {
            const child = targetElement.querySelector('input, textarea');
            if (child) {
                child.value = finalMessage;
                child.dispatchEvent(new Event('input', { bubbles: true }));
                lastMaskedContent = finalMessage;
            }
        }
    } else if (targetElement) {
        lastMaskedContent = finalMessage;
    }
    hideOverlay();
}

async function handleShowOverlay(overrideContent = null, preservedManualBlocks = []) {
    if (!isStorageLoaded) {
        // console.log("ChatWall: Logic wait for storage...");
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
