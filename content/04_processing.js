/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */
// --- PROCESSING LOGIC ---


async function processText(forceFullScan = false, fromScroll = false, customContextSize = null) {
    if (!shadowRoot) return;

    if (!elInputText) return;
    const inputText = elInputText;

    const currentScanId = ++lastScanId; // Race Condition Guard
    const rawText = inputText.value;
    let textToScan = rawText;
    let offset = 0;

    const contextSize = customContextSize || (fromScroll ? NLP_SCROLL_CONTEXT : NLP_CONTEXT_WINDOW);

    if (!forceFullScan && rawText.length > contextSize * 2) {
        let centerIndex = inputText.selectionEnd || 0;

        // Visual Scroll Estimation: If triggered by scroll, center window on Visible Viewport
        if (fromScroll && inputText.scrollHeight > inputText.clientHeight) {
            const scrollRatio = inputText.scrollTop / (inputText.scrollHeight - inputText.clientHeight);
            centerIndex = Math.floor(rawText.length * scrollRatio);
        }

        const start = Math.max(0, centerIndex - contextSize); // Window radius
        const end = Math.min(rawText.length, centerIndex + contextSize);
        textToScan = rawText.substring(start, end);
        offset = start;
    }

    const scanLength = textToScan.length;

    try {
        chrome.runtime.sendMessage({
            action: 'ANALYZE_TEXT',
            text: textToScan,
            offset: offset
        }, (response) => {
            if (response && response.matches) {
                finalizeProcessing(response.matches, offset, scanLength, currentScanId);
            } else {
                finalizeProcessing([], offset, scanLength, currentScanId);
            }
        });
    } catch (err) {
        console.error("ChatWall: Full Scan Failed", err);
        // Fallback: If full scan failed (e.g. too large), try partial scan immediately
        if (forceFullScan) {
            processText(false);
        } else {
            finalizeProcessing([], offset, scanLength, currentScanId);
        }
    }
}

async function finalizeProcessing(nlpMatches, scanOffset = 0, scanLength = 0, scanId = 0, skipLocalRegex = false) {
    if (!shadowRoot) return;

    // Race Condition Guard: If a newer scan has already started, discard this stale result.
    if (scanId !== 0 && scanId !== lastScanId) {
        return;
    }

    try {
        const inputText = elInputText;
        const outputText = elOutputText;
        const inputHighlights = elInputHighlights;
        if (!inputText || !outputText) return;

        // Fetch tokens for finalization phase
        const tokenMap = await getTokenMap();
        let mapModified = false;

        // Use cached locked tokens (computed once per overlay session) to avoid expensive document.body.innerText reflow
        if (!cachedLockedTokens) {
            cachedLockedTokens = getLockedTokens();
        }
        const lockedTokens = cachedLockedTokens;

        const rawText = inputText.value;
        let allMatches = [];

        // --- MATCH MERGING LOGIC ---
        // For partial scans (context window), we must merge new results with existing cached matches
        // to avoid "disappearing tokens" outside the scan window.

        let incomingMatches = [];
        if (nlpMatches && Array.isArray(nlpMatches)) {
            nlpMatches.forEach(m => {
                if (/^(La|Le|Les|Los|Las|El|Il|Der|Die|Das|The)$/i.test(m.text.trim())) return;
                m.isIgnored = ignoredEntities.has(m.text.trim());
                if (m.type === 'AMOUNT') m.type = 'MONEY';
                incomingMatches.push(m);
            });
        }

        if (scanLength > 0) {
            // Keep matches that are strictly outside OR crossing the boundary of the scanned window
            // (Partial scans cannot reliably detect/invalidate tokens that they only see half of)
            const scanEnd = scanOffset + scanLength;

            const keptMatches = cachedNlpMatches.filter(m => {
                const isFullyInside = (m.start >= scanOffset && m.end <= scanEnd);
                return !isFullyInside;
            });
            cachedNlpMatches = keptMatches.concat(incomingMatches);
        } else {
            // Full scan (or initial), replace all
            cachedNlpMatches = incomingMatches;
        }

        // Safety Net: Prune out-of-bounds matches (fixes Deletion Ghosting)
        cachedNlpMatches = cachedNlpMatches.filter(m => m.end <= rawText.length && m.start >= 0);

        // Use the merged cache for rendering
        allMatches = [...cachedNlpMatches];


        // --- LOCAL REGEX MATCHES (cached by text content to skip on scroll) ---
        // Key: text length + first/last 100 chars (fast identity check)
        const textKey = rawText.length + ':' + rawText.substring(0, 100) + ':' + rawText.substring(rawText.length - 100);
        let localMatches;

        if (skipLocalRegex && cachedLocalMatches) {
            // Optimistic render (per-keystroke) — reuse stale cache, debounced processText will refresh
            localMatches = cachedLocalMatches;
        } else if (textKey === cachedLocalMatchesTextKey && cachedLocalMatches) {
            // Text unchanged (scroll-only) — reuse cached local regex results
            localMatches = cachedLocalMatches;
        } else {
            // Text changed — recompute local regex matches
            localMatches = [];

            manualBlockList.forEach(word => {
                if (ignoredEntities.has(word)) return;
                const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                localMatches = localMatches.concat(findAllMatches(rawText, regex, 'CUSTOM'));
            });

            // Favorites List Matches
            favoritesList.forEach(fav => {
                if (ignoredEntities.has(fav)) return;
                const regex = new RegExp(fav.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                localMatches = localMatches.concat(findAllMatches(rawText, regex, 'FAVORITE'));
            });

            cachedLocalMatches = localMatches;
            cachedLocalMatchesTextKey = textKey;
        }

        allMatches = allMatches.concat(localMatches);

        allMatches.forEach(m => {
            if (m.type === 'UUID') m.type = 'ID';
        });

        // --- CONTEXTUAL NAME BOOST ---
        // If a NAME match has an honorific prefix or an adjacent NAME match,
        // boost its priority above CITY (85 > 84) so names are preferred over cities in context.
        // Uses shared HONORIFIC_RE from name.js

        allMatches.forEach(m => {
            if (m.type !== 'NAME') return;
            // Check 1: Honorific prefix in the text before this match
            const prefixWindow = rawText.substring(Math.max(0, m.start - 20), m.start);
            if (HONORIFIC_RE.test(prefixWindow)) {
                m.hasNameContext = true;
                return;
            }
            // Check 2: Adjacent NAME match (immediately before or after, allowing spaces)
            for (const other of allMatches) {
                if (other === m || other.type !== 'NAME') continue;
                // other ends near m.start (adjacent before)
                if (other.end >= m.start - 2 && other.end <= m.start) {
                    m.hasNameContext = true;
                    return;
                }
                // other starts near m.end (adjacent after)
                if (other.start >= m.end && other.start <= m.end + 2) {
                    m.hasNameContext = true;
                    return;
                }
            }
        });

        // Unified Scoring Logic (Synced with background.js)
        const getScore = (m) => {
            const t = (typeof m === 'string') ? m : m.type;
            if (t === 'FAVORITE') return 130;
            if (t === 'CUSTOM') return 129;

            if (t === 'IBAN') return 115;
            if (t === 'CB') return 110;
            if (t === 'EMAIL') return 105;
            if (t === 'URL') return 105;
            if (t === 'CVV') return 100;

            if (t === 'UUID') return 95;
            if (t === 'VIN') return 98;
            if (t === 'IP' || t === 'MAC' || t === 'PATH') return 98;

            if (t === 'VCS' || t === 'PASSPORT' || t === 'SSN' || t === 'VAT' || t === 'ID' || t === 'BIC' || t === 'PLATE') return 90;

            if (t === 'GPS') return 87; // GPS > Phone (85)
            if (t === 'DATE') return 86; // Date > Phone (85)
            if (t === 'PHONE') return 85;
            if (t === 'NAME') return (m && m.hasNameContext) ? 85 : 80;
            if (t === 'PERSON') return 80; // legacy fallback

            if (t === 'COUNTRY') return 89; // Country > City

            if (t === 'CITY') return 84; // City > Name
            if (t === 'POSTAL') return 60;

            if (t === 'SECRET' || t === 'KEY' || t === 'PASSWORD' || t === 'PIN' || t === 'JWT' || t === 'AWS' || t === 'CRYPTO' || t === 'PASS') return 55;

            if (t === 'TIME') return 40;
            if (t === 'AMOUNT') return 40;
            if (t === 'MONEY') return 40;

            return 30; // Default matches background "low-ish"
        };

        allMatches.sort((a, b) => {
            if (a.start !== b.start) return a.start - b.start;
            // Higher score first
            const scoreA = getScore(a);
            const scoreB = getScore(b);
            if (scoreA !== scoreB) return scoreB - scoreA;
            return b.end - a.end;
        });

        // Filter overlapping
        let filteredMatches = [];
        let lastEnd = 0;
        for (let m of allMatches) {
            if (m.start >= lastEnd) {
                filteredMatches.push(m);
                lastEnd = m.end;
            }
            else {
                let prev = filteredMatches[filteredMatches.length - 1];

                // Use scoring to decide whether to replace an existing overlapping match.
                if (getScore(m) > getScore(prev)) {
                    if (m.start < prev.end) {
                        filteredMatches.pop();
                        filteredMatches.push(m);
                        lastEnd = m.end;
                    }
                }
                else if (m.isNLP && !prev.isNLP && !(prev.type === 'CUSTOM' || prev.type === 'FAVORITE')) {
                    if (m.start <= prev.start && m.end >= prev.end) {
                        filteredMatches.pop();
                        filteredMatches.push(m);
                        lastEnd = m.end;
                    }
                }
            }
        }
        currentMatches = filteredMatches;

        filteredMatches.forEach(m => {
            // Enforce tiers...
            const isUserDef = (m.type === 'CUSTOM' || m.type === 'FAVORITE');
            if (USER_PLAN === 'FREE' && !ENTITY_TIERS.FREE.has(m.type) && !isUserDef) {
                m.isLocked = true;
            }
        });

        // --- FINGERPRINT: Skip expensive re-render if matches unchanged ---
        const fingerprint = filteredMatches.length + ':' + rawText.length + ':' +
            filteredMatches.map(m => m.start + ',' + m.end + ',' + m.type + ',' + (m.isIgnored ? 'i' : '')).join(';');

        if (fingerprint === lastRenderFingerprint) {
            // Matches unchanged — skip innerHTML rebuild and token pair cache rebuild
            return;
        }
        lastRenderFingerprint = fingerprint;

        // --- DOM RENDER: DocumentFragment (avoids innerHTML HTML parsing overhead) ---
        const safeFrag = document.createDocumentFragment();
        const hlFrag = document.createDocumentFragment();
        let usedTokenKeys = new Set(); // Garbage Collection
        const newTokenPairs = []; // Collect during build instead of querySelectorAll
        let currentIndex = 0;

        filteredMatches.forEach(m => {
            // Text before this match
            if (m.start > currentIndex) {
                const seg = rawText.substring(currentIndex, m.start);
                safeFrag.appendChild(document.createTextNode(seg));
                hlFrag.appendChild(document.createTextNode(seg));
            }

            if (m.isIgnored) {
                safeFrag.appendChild(document.createTextNode(m.text));
                hlFrag.appendChild(document.createTextNode(m.text));
            }
            else if (m.isLocked) {
                safeFrag.appendChild(document.createTextNode(m.text));
                const hidePayment = (typeof ChatWallConfig !== 'undefined' && ChatWallConfig.HIDE_PAYMENT_LINKS);
                const tooltipText = hidePayment
                    ? chrome.i18n.getMessage('tooltip_premium_reserved_safe')
                    : chrome.i18n.getMessage('tooltip_premium_reserved');
                const span = document.createElement('span');
                span.className = 'token token-locked';
                span.setAttribute('data-tooltip-text', tooltipText);
                const warn = document.createElement('span');
                warn.className = 'warning-icon';
                warn.textContent = '⚠️';
                span.appendChild(warn);
                span.appendChild(document.createTextNode(m.text));
                hlFrag.appendChild(span);
            }
            else {
                let tokenKey;

                let existingTokenKey = Object.keys(tokenMap).find(key => tokenMap[key] === m.text);

                if (existingTokenKey) {
                    tokenKey = existingTokenKey;
                } else {
                    // 2. Transient Token Reuse Strategy (Counter-Based)
                    const transientToken = Object.keys(tokenMap).find(key => {
                        if (!key.includes(m.type)) return false;
                        if (usedTokenKeys.has(key)) return false;

                        // Parse Index from Key: [NAME_1A] -> 1A (base36)
                        const parts = key.slice(1, -1).split('_'); // Remove [] and split
                        if (parts.length < 2) return false;

                        const idxStr = parts.pop(); // Last part is always the index
                        const idx = parseInt(idxStr, 36);

                        // Compare with initial counter state
                        const initialCount = initialCounters[m.type] || 0;
                        return idx > initialCount;
                    });

                    if (transientToken) {
                        tokenKey = transientToken;
                        tokenMap[tokenKey] = m.text; // Update text (Phil -> Philippe)
                        mapModified = true;
                    } else {
                        // 3. Create New Token (Safe Fallback)
                        if (!counters[m.type]) counters[m.type] = 0;
                        counters[m.type]++;
                        saveCounters();

                        tokenKey = `[${m.type}_${counters[m.type].toString(36).toUpperCase()}]`;
                        tokenMap[tokenKey] = m.text;
                        mapModified = true;
                    }
                }
                // Track usage for Garbage Collection
                usedTokenKeys.add(tokenKey);

                // Output token span
                const safeSpan = document.createElement('span');
                safeSpan.className = `token token-${m.type}`;
                safeSpan.setAttribute('data-start', m.start);
                safeSpan.title = m.text;
                safeSpan.textContent = tokenKey;
                safeFrag.appendChild(safeSpan);

                // Highlight token span
                const hlSpan = document.createElement('span');
                hlSpan.className = `token token-${m.type}`;
                hlSpan.setAttribute('data-start', m.start);
                hlSpan.setAttribute('data-is-nlp', m.isNLP ? 'true' : 'false');
                hlSpan.setAttribute('data-type', m.type);
                hlSpan.setAttribute('data-text', m.text);
                hlSpan.textContent = m.text;
                hlFrag.appendChild(hlSpan);

                // Collect token pair reference (replaces post-render querySelectorAll)
                newTokenPairs.push({ start: m.start, input: hlSpan, output: safeSpan });
            }
            currentIndex = m.end;
        });

        // Remaining text after last match
        if (currentIndex < rawText.length) {
            const remaining = rawText.substring(currentIndex);
            safeFrag.appendChild(document.createTextNode(remaining));
            hlFrag.appendChild(document.createTextNode(remaining));
        }

        // Handle trailing newlines for highlight layer
        if (rawText.endsWith('\n\n')) {
            hlFrag.appendChild(document.createElement('br'));
            hlFrag.appendChild(document.createElement('br'));
            hlFrag.appendChild(document.createTextNode('\u00a0'));
        } else if (rawText.endsWith('\n')) {
            hlFrag.appendChild(document.createElement('br'));
            hlFrag.appendChild(document.createTextNode('\u00a0'));
        }

        // Single DOM update: clear + append (one reflow each)
        outputText.textContent = '';
        outputText.appendChild(safeFrag);
        if (inputHighlights) {
            inputHighlights.textContent = '';
            inputHighlights.appendChild(hlFrag);
        }

        // FIX: Force Re-Sync Scroll (fixes paste/replace desync)
        if (inputText && inputHighlights) {
            inputHighlights.scrollTop = inputText.scrollTop;
            inputHighlights.scrollLeft = inputText.scrollLeft;
        }

        // --- SCROLL SYNC CACHE (collected during build, no querySelectorAll needed) ---
        cachedTokenPairs = newTokenPairs;
        // Already in document order (sorted by start) since we iterated filteredMatches in order


        // GC REMOVED: To ensure stability (e.g., pasting same text in new overlay returns same token),

        if (mapModified) {
            await saveTokens(tokenMap);
        }
    } catch (e) {
        console.error("Finalize Processing Error", e);
    }
}


function handleOptimisticInput(inputText) {
    if (!inputText) return;
    const newText = inputText.value;
    const oldText = lastInputText;

    // Calculate Diff
    let startDiff = 0;
    while (startDiff < oldText.length && startDiff < newText.length && oldText[startDiff] === newText[startDiff]) {
        startDiff++;
    }

    const delta = newText.length - oldText.length;
    lastInputText = newText;

    if (delta === 0) return; // No length change, maybe replacement? logic complex, fallback to debounce

    // Shift relevant matches
    const shiftedMatches = [];
    const deleteEnd = (delta < 0) ? (startDiff - delta) : startDiff;

    cachedNlpMatches.forEach(m => {
        if (m.end <= startDiff) {
            // Case 1: Strictly Before change -> Keep as is
            shiftedMatches.push(m);
        }
        else if (m.start >= deleteEnd) {
            // Case 2: Strictly After changed range -> Shift
            m.start += delta;
            m.end += delta;
            shiftedMatches.push(m);
        }
        else {
            // Case 3: Overlap with change
            if (delta > 0) {
                // Insertion inside token
                m.end += delta;
                m.text = newText.substring(m.start, m.end);
                shiftedMatches.push(m);
            } else {
                // Deletion inside token: Drop it
            }
        }
    });

    cachedNlpMatches = shiftedMatches;

    // PERF: For large texts, skip the expensive synchronous DOM rebuild.
    // Instead, surgically splice the delta into the highlight layer's DOM.
    // This preserves existing token spans and their colors.
    if (newText.length > 20000 && elInputHighlights) {
        // Splice the edit into the highlight layer DOM
        const insertText = delta > 0 ? newText.substring(startDiff, startDiff + delta) : '';
        const deleteCount = delta < 0 ? -delta : 0;
        let charPos = 0;
        let spliced = false;

        const spliceNode = (nodes) => {
            for (const node of nodes) {
                if (spliced) return;
                if (node.nodeType === Node.TEXT_NODE) {
                    const len = node.textContent.length;
                    if (charPos + len >= startDiff) {
                        const offset = startDiff - charPos;
                        const t = node.textContent;
                        node.textContent = t.substring(0, offset) + insertText + t.substring(offset + deleteCount);
                        spliced = true;
                        return;
                    }
                    charPos += len;
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    const len = node.textContent.length;
                    if (charPos + len > startDiff) {
                        // Edit is inside this element — recurse into its children
                        spliceNode(node.childNodes);
                        return;
                    }
                    charPos += len;
                }
            }
        };
        spliceNode(elInputHighlights.childNodes);

        if (!spliced) {
            // Edit at the very end — append to last text node or create one
            const last = elInputHighlights.lastChild;
            if (last && last.nodeType === Node.TEXT_NODE) {
                last.textContent += insertText;
            } else {
                elInputHighlights.appendChild(document.createTextNode(insertText));
            }
        }

        elInputHighlights.scrollTop = inputText.scrollTop;
        elInputHighlights.scrollLeft = inputText.scrollLeft;
        return;
    }

    // For small texts: full synchronous optimistic render (instant feedback)
    // Local regex re-runs fresh (fast for small texts, ensures correct positions)
    // Pass 0 as scanId to bypass race condition guard (we want to force this sync update)
    finalizeProcessing(shiftedMatches, 0, 0, 0);
}
