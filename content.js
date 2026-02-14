/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

const CONFIG_API_URL = (typeof ChatWallConfig !== 'undefined') ? ChatWallConfig.API_URL : "http://localhost:3000";

// Safari Detection (content script context)
const IS_SAFARI = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    || (navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome') && !navigator.userAgent.includes('Chromium'));

// --- GLOBALS & STATE ---
let USER_PLAN = 'FREE';
let CLIENT_ID = '';
let overlayContainer = null;
let shadowRoot = null;
let isStorageLoaded = false;

const NLP_CONTEXT_WINDOW = 50000;

const ENTITY_TIERS = {
    FREE: new Set([
        'NAME', 'EMAIL', 'PHONE',
        'LOC', 'POSTAL', 'GPS',
        'DATE', 'TIME', 'URL', 'CUSTOM',
        'CITY', 'COUNTRY'
    ])
};

let counters = {
    NAME: 0, LOC: 0, ORG: 0,
    EMAIL: 0, PHONE: 0, URL: 0,
    IBAN: 0, CB: 0, CRYPTO: 0,
    IP: 0, ID: 0, PASSPORT: 0, SSN: 0,
    DATE: 0, TIME: 0,
    SECRET: 0, MONEY: 0, PIN: 0,
    UUID: 0, MAC: 0, KEY: 0,
    VAT: 0, POSTAL: 0, BIC: 0, EAN: 0,
    VCS: 0, VIN: 0, CUSTOM: 0, FAVORITE: 0
};

// Application State
let knownEntities = new Map();
let ignoredEntities = new Set();
let manualBlockList = [];
let favoritesList = new Set();
let initialCounters = {}; // Tracks counter state when overlay opened

// Interaction State
let lastRightClickedElement = null;
let activeTarget = null;
let currentMatches = [];
let cachedTokenPairs = []; // For Scroll Sync Optimization
let scrollTimer = null;
let contextMenuTargetMatch = null;
let activeTool = null;
let responseContextMenuTarget = null;
let currentSelectionText = "";
let lastMaskedContent = null;
let lastSelectionText = "";

// Performance State
let lastScanId = 0;
let cachedNlpMatches = [];
let lastInputText = "";


// Float Button State
let floatBtn = null;
let unmaskBtn = null;
let currentFloatTarget = null;
let currentUnmaskTarget = null;
let currentFloatAnchor = null;
let currentUnmaskAnchor = null;
let activeResizeObserver = null;
let floatHideTimer = null;
let unmaskHideTimer = null;
let floatTooltip = null;
let floatBadge = null;
let unmaskBadge = null;
let lastRiskAnalysis = false;
let decisionPopup = null;

// Constants / Assets
const RED_SHIELD_SVG = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10.29 3.86L1.82 18C1.64538 18.3024 1.55297 18.6453 1.55199 18.9945C1.55101 19.3437 1.64149 19.6871 1.81442 19.9905C1.98736 20.2939 2.23672 20.5467 2.53771 20.7239C2.83869 20.901 3.1808 20.9962 3.53 21H20.47C20.8192 20.9962 21.1613 20.901 21.4623 20.7239C21.7633 20.5467 22.0126 20.2939 22.1856 19.9905C22.3585 19.6871 22.449 19.3437 22.448 18.9945C22.447 18.6453 22.3546 18.3024 22.18 18L13.71 3.86C13.5317 3.56613 13.2807 3.32314 12.9812 3.15449C12.6817 2.98585 12.3437 2.89722 12 2.89722C11.6563 2.89722 11.3183 2.98585 11.0188 3.15449C10.7193 3.32314 10.4683 3.56613 10.29 3.86Z" fill="#EF4444" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M12 9V13" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M12 17H12.01" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
`;

const GREEN_EYE_SVG = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" fill="#22c55e" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="12" cy="12" r="3" fill="white"/>
    </svg>
`;

const COPY_SIGNATURES = [
    "M12.5 3C13.3284",
    "M14 12.5C14 13.3284",
    "M5 15H4a2 2",
    "rect x=\"9\" y=\"9\"",
    "M6.14923 4.02032"
];



// --- STORAGE HELPERS ---
let globalTokenMap = null;

async function getTokenMap() {
    if (globalTokenMap) return globalTokenMap;
    // Check for invalid context (e.g. extension reloaded)
    if (!chrome.runtime?.id) return {};

    // 1. Try Session Storage (Chromium)
    if (chrome.storage?.session) {
        try {
            const res = await chrome.storage.session.get(['chatwall_token_map']);
            globalTokenMap = res.chatwall_token_map || {};
            return globalTokenMap;
        } catch (e) { /* Fallback */ }
    }

    // 2. Fallback: Background Memory (Firefox / Safari)
    try {
        const response = await chrome.runtime.sendMessage({ action: 'BG_GET_STATE' });
        if (response && response.tokens) {
            globalTokenMap = response.tokens;
            return globalTokenMap;
        }
    } catch (e) {
        // Suppress "Extension context invalidated" noise
        if (e.message.includes('Extension context invalidated')) return {};
        console.warn("ChatWall: State Sync Failed", e);
    }

    return {};
}

async function saveTokens(newTokens) {
    if (!chrome.runtime?.id) return newTokens; // Stop if invalid

    globalTokenMap = newTokens; // Immediate memory update

    // 1. Try Session Storage (Chromium)
    if (chrome.storage?.session) {
        await chrome.storage.session.set({ 'chatwall_token_map': newTokens });
    } else {
        // 2. Fallback: Background Sync (Firefox / Safari)
        chrome.runtime.sendMessage({
            action: 'BG_SYNC_STATE',
            tokens: newTokens
        }).catch(() => { });
    }
    return newTokens;
}

// Counter Persistence (Load-Once, Write-Async)
function saveCounters() {
    if (chrome.storage?.local) {
        chrome.storage.local.set({ 'chatwall_counters': counters });
    }
}

async function loadCounters() {
    // Sync counters across tabs to prevent immutable token overwrite
    if (chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'local' && changes.chatwall_counters?.newValue) {
                // console.debug("ChatWall: Syncing counters from storage", changes.chatwall_counters.newValue);
                counters = { ...counters, ...changes.chatwall_counters.newValue };
            }
        });
    }

    if (!chrome.storage?.local) return;
    const res = await chrome.storage.local.get(['chatwall_counters']);
    if (res.chatwall_counters) {
        // Merge with defaults to ensure all keys exist
        counters = { ...counters, ...res.chatwall_counters };
    } else {
        // Fallback: If no counters stored, derive from existing tokens to prevent reset
        const tokenMap = await getTokenMap();
        Object.keys(tokenMap).forEach(key => {
            // Key format: [TYPE_ID] e.g. [NAME_1A]
            const match = key.match(/^\[([A-Z]+)_([A-Z0-9]+)\]$/);
            if (match) {
                const type = match[1];
                const idStr = match[2];
                try {
                    const idVal = parseInt(idStr, 36);
                    if (!isNaN(idVal)) {
                        if (!counters[type] || idVal > counters[type]) {
                            counters[type] = idVal;
                        }
                    }
                } catch (e) { /* ignore parse error */ }
            }
        });
        saveCounters(); // Save the derived baseline
    }
    isStorageLoaded = true;
}

function syncUserPlan() {
    if (!chrome.runtime?.id || !chrome.storage?.local) return;
    chrome.storage.local.get(['chatwall_user_plan', 'chatwall_email'], (data) => {
        if (chrome.runtime.lastError) return;
        USER_PLAN = data.chatwall_user_plan || 'FREE';
        if (shadowRoot) updatePlanUI();
    });

    // Safari: Also check native IAP status
    if (IS_SAFARI) {
        try {
            chrome.runtime.sendMessage({ action: 'CHECK_PREMIUM_STATUS' }, (response) => {
                if (chrome.runtime.lastError) return;
                if (response && response.isPremium) {
                    USER_PLAN = 'PREMIUM';
                    if (shadowRoot) updatePlanUI();
                }
            });
        } catch (e) { /* Extension context may be invalidated */ }
    }
}

function saveFavorites() {
    const arr = Array.from(favoritesList);
    const hashed = arr.map(s => btoa(unescape(encodeURIComponent(s))));
    chrome.storage.local.set({ 'chatwall_favorites': hashed });
}

function loadFavorites() {
    chrome.storage.local.get(['chatwall_favorites'], (result) => {
        if (result.chatwall_favorites && Array.isArray(result.chatwall_favorites)) {
            favoritesList.clear();
            result.chatwall_favorites.forEach(hash => {
                try {
                    const str = decodeURIComponent(escape(atob(hash)));
                    favoritesList.add(str);
                } catch (e) { console.error("ChatWall: Failed to load a favorite", e); }
            });
        }
    });
}

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
    const bodyText = document.body.innerText;
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
        substractTokens(activeTarget.innerText || activeTarget.textContent || "", "ActiveTarget.Content");

        // AGGRESSIVE SUBTRACTION:
        // Modern editors often duplicate content in a 'preview' div or 'hidden' div within the same wrapper.
        // We walk up 2 levels and subtract EVERYTHING found in that near vicinity to ensure we don't count
        // the "Ghost" draft copies as "History".
        let parent = activeTarget.parentElement;
        for (let i = 0; i < 3; i++) {
            if (parent && parent !== document.body && parent !== document.documentElement) {
                substractTokens(parent.innerText || parent.textContent || "", `Parent_L${i}`);
                parent = parent.parentElement;
            }
        }
    }

    // 2. Subtract occurrences in Overlay (Shadow DOM)
    if (shadowRoot) {
        const inp = shadowRoot.getElementById('inputText');
        if (inp) substractTokens(inp.value, "Overlay.Input");

        const out = shadowRoot.getElementById('outputText');
        if (out) substractTokens(out.innerText, "Overlay.Output");
    }

    // Any token with count > 0 is present OUTSIDE of the active draft logic -> Locked
    const locked = new Set();
    Object.keys(counts).forEach(k => {
        if (counts[k] > 0) locked.add(k);
    });
    return locked;
};


// --- PROCESSING LOGIC ---


async function processText(forceFullScan = false, fromScroll = false, customContextSize = null) {
    if (!shadowRoot) return;

    const inputText = shadowRoot.getElementById('inputText');
    if (!inputText) return;

    const currentScanId = ++lastScanId; // Race Condition Guard
    const rawText = inputText.value;
    let textToScan = rawText;
    let offset = 0;

    const contextSize = customContextSize || NLP_CONTEXT_WINDOW;

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

async function finalizeProcessing(nlpMatches, scanOffset = 0, scanLength = 0, scanId = 0) {
    if (!shadowRoot) return;

    // Race Condition Guard: If a newer scan has already started, discard this stale result.
    if (scanId !== 0 && scanId !== lastScanId) {
        return;
    }

    try {
        const inputText = shadowRoot.getElementById('inputText');
        const outputText = shadowRoot.getElementById('outputText');
        const inputHighlights = shadowRoot.getElementById('inputHighlights');
        if (!inputText || !outputText) return;

        // Fetch tokens for finalization phase
        const tokenMap = await getTokenMap();
        let mapModified = false;

        const lockedTokens = getLockedTokens();

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


        manualBlockList.forEach(word => {
            if (ignoredEntities.has(word)) return;
            const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            allMatches = allMatches.concat(findAllMatches(rawText, regex, 'CUSTOM'));
        });

        // Favorites List Matches
        favoritesList.forEach(fav => {
            if (ignoredEntities.has(fav)) return;
            const regex = new RegExp(fav.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            allMatches = allMatches.concat(findAllMatches(rawText, regex, 'FAVORITE'));
        });

        allMatches.forEach(m => {
            if (m.type === 'UUID') m.type = 'ID';
        });

        // Unified Scoring Logic
        // Unified Scoring Logic (Synced with background.js)
        const getScore = (t) => {
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
            if (t === 'NAME') return 80; // Name < City
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
            const scoreA = getScore(a.type);
            const scoreB = getScore(b.type);
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
                if (getScore(m.type) > getScore(prev.type)) {
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

        let safeHtml = "";
        let highlightHtml = "";
        let usedTokenKeys = new Set(); // Garbage Collection
        const currentTexts = new Set(filteredMatches.map(m => m.text));
        let currentIndex = 0;

        filteredMatches.forEach(m => {
            const rawSegment = rawText.substring(currentIndex, m.start);
            safeHtml += escapeHtml(rawSegment);
            highlightHtml += escapeHtml(rawSegment);

            if (m.isIgnored) {
                safeHtml += escapeHtml(m.text);
                highlightHtml += escapeHtml(m.text);
            }
            else if (m.isLocked) {
                safeHtml += escapeHtml(m.text);
                const hidePayment = (typeof ChatWallConfig !== 'undefined' && ChatWallConfig.HIDE_PAYMENT_LINKS);
                const tooltipText = hidePayment
                    ? chrome.i18n.getMessage('tooltip_premium_reserved_safe')
                    : chrome.i18n.getMessage('tooltip_premium_reserved');
                highlightHtml += `<span class="token token-locked" data-tooltip-text="${escapeHtml(tooltipText)}"><span class="warning-icon">⚠️</span>${escapeHtml(m.text)}</span>`;
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

                safeHtml += `<span class="token token-${m.type}" data-start="${m.start}" title="${escapeHtml(m.text)}">${tokenKey}</span>`;
                const nlpFlag = m.isNLP ? "true" : "false";
                highlightHtml += `<span class="token token-${m.type}" data-start="${m.start}" data-is-nlp="${nlpFlag}" data-type="${m.type}" data-text="${escapeHtml(m.text)}">${escapeHtml(m.text)}</span>`;
            }
            currentIndex = m.end;
        });

        safeHtml += escapeHtml(rawText.substring(currentIndex));
        highlightHtml += escapeHtml(rawText.substring(currentIndex));

        if (rawText.endsWith('\n')) highlightHtml += '<br>&nbsp;';
        else if (rawText.endsWith('\n\n')) highlightHtml += '<br><br>&nbsp;';

        outputText.innerHTML = safeHtml;
        if (inputHighlights) inputHighlights.innerHTML = highlightHtml;

        // FIX: Force Re-Sync Scroll (fixes paste/replace desync)
        if (inputText && inputHighlights) {
            inputHighlights.scrollTop = inputText.scrollTop;
            inputHighlights.scrollLeft = inputText.scrollLeft;
        }

        // --- POPULATE SCROLL SYNC CACHE ---
        cachedTokenPairs = [];
        if (inputHighlights && outputText) {
            const inTokens = Array.from(inputHighlights.querySelectorAll('.token[data-start]'));
            const outTokens = Array.from(outputText.querySelectorAll('.token[data-start]'));

            // Map by start index for O(1) matching
            const outMap = new Map();
            outTokens.forEach(t => outMap.set(t.getAttribute('data-start'), t));

            inTokens.forEach(inT => {
                const s = inT.getAttribute('data-start');
                const outT = outMap.get(s);
                if (outT) {
                    cachedTokenPairs.push({
                        start: parseInt(s, 10),
                        input: inT,
                        output: outT
                    });
                }
            });
            // Sort by start index (usually correlates with offsetTop)
            cachedTokenPairs.sort((a, b) => a.start - b.start);
        } // -------------------------------


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

    // Synchronous Render (Optimistic)
    // Pass 0 as scanId to bypass race condition guard (we want to force this sync update)
    finalizeProcessing(shiftedMatches, 0, 0, 0);
}



const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function handleMaskAction(text) {
    if (!text) return;
    text = text.trim();
    if (ignoredEntities.has(text)) ignoredEntities.delete(text);
    if (!manualBlockList.includes(text)) manualBlockList.push(text);

    // OPTIMIZED: Local Partial Update instead of Full Background Scan
    const inputText = shadowRoot ? shadowRoot.getElementById('inputText') : null;
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
        if (/^\[[A-Z]+_\d+\]$/.test(raw)) {
            const originalVal = tokenMap[raw];
            if (originalVal && !ignoredEntities.has(originalVal)) {
                ignoredEntities.add(originalVal);
                changeMade = true;
            }
        }
    });

    if (changeMade) {
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
    let finalMessage = shadowRoot.getElementById('outputText').innerText;
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
        const input = shadowRoot.getElementById('inputText');
        if (initialContent && initialContent.trim().length > 0) {
            if (input) {
                input.value = initialContent;
                // Immediate Render (Plain Text) so user sees content while analysis runs
                finalizeProcessing([], 0, 0, 0);
                // Optimized: Partial Scan of Visible Area (First 5k chars) - 10x faster than default 50k
                processText(false, true, 5000);
                const hl = shadowRoot.getElementById('inputHighlights');
                input.scrollTop = 0;
                if (hl) hl.scrollTop = 0;
            }
        } else {
            if (input) {
                input.value = "";
                input.focus();
                processText(false, true);
            }
        }
    }, 50);
}

// --- OVERLAY UI ---

function createOverlay() {
    return new Promise((resolve, reject) => {
        overlayContainer = document.createElement('div');
        overlayContainer.id = 'chatwall-overlay-container';
        Object.assign(overlayContainer.style, {
            position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
            zIndex: '2147483647', pointerEvents: 'none', display: 'none'
        });
        ['keydown', 'keyup', 'keypress', 'input'].forEach(evt => {
            overlayContainer.addEventListener(evt, (e) => e.stopPropagation());
        });

        overlayContainer.addEventListener('click', (e) => {
            if (shadowRoot) {
                const menu = shadowRoot.getElementById('responseContextMenu');
                if (menu && menu.style.display === 'block') {
                    hideResponseMenu();
                }
            }
        });

        shadowRoot = overlayContainer.attachShadow({ mode: 'open' });
        const link = document.createElement('link');
        link.setAttribute('rel', 'stylesheet');
        link.setAttribute('href', chrome.runtime.getURL('overlay.css'));
        shadowRoot.appendChild(link);

        fetch(chrome.runtime.getURL('overlay.html') + '?t=' + Date.now()).then(res => res.text()).then(html => {
            html = localizeHtml(html);

            // OPTIMIZATION: Perform string replacements BEFORE creating DOM to avoid layout reflows and Safari security blocks
            const logoUrl = chrome.runtime.getURL('logo_t.png');
            html = html.replace('src="logo_t.png"', `src="${logoUrl}"`);
            html = html.replace(/http:\/\/localhost:3000/g, CONFIG_API_URL);

            const wrapper = document.createElement('div');
            wrapper.innerHTML = html;
            // const doc = wrapper; // No longer needed
            // doc.querySelectorAll('img[src="logo.png"]').forEach(img => img.src = logoUrl); // Handled by string replace above
            // wrapper.innerHTML = wrapper.innerHTML.replace(/http:\/\/localhost:3000/g, CONFIG_API_URL); // Handled by string replace above

            shadowRoot.appendChild(wrapper);

            initOverlayEvents();
            resolve();
        });
        document.body.appendChild(overlayContainer);
    });
}

function showOverlay(content, mode = 'anonymize', isHTML = false) {
    currentOverlayMode = mode;

    overlayContainer.style.display = 'block';
    overlayContainer.style.pointerEvents = 'auto';

    // Lock Body Scroll
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    const backdrop = shadowRoot.querySelector('.overlay-backdrop');
    if (backdrop) backdrop.style.display = 'flex';

    const responseMenu = shadowRoot.getElementById('responseContextMenu');
    if (responseMenu) responseMenu.style.display = 'none';

    const wrapper = shadowRoot.getElementById('mainWrapper');
    const appTitle = shadowRoot.getElementById('appTitle');
    const outputHeaderTitle = shadowRoot.getElementById('outputHeaderTitle');
    const outputText = shadowRoot.getElementById('outputText');
    const inputText = shadowRoot.getElementById('inputText');
    const inputPanel = shadowRoot.getElementById('inputPanel');
    const footer = shadowRoot.getElementById('footerSection');
    const sendBtn = shadowRoot.getElementById('sendBtn');

    const btnOverlayCopy = shadowRoot.getElementById('btnOverlayCopy');
    const btnOverlayClose = shadowRoot.getElementById('btnOverlayClose');
    const copyBtnHeader = shadowRoot.getElementById('copyBtn');

    wrapper.classList.remove('mode-deanonymize');

    if (inputPanel) inputPanel.style.display = 'flex';
    if (footer) footer.style.display = 'flex';
    if (sendBtn) sendBtn.style.display = 'inline-flex';
    if (btnOverlayCopy) btnOverlayCopy.style.display = 'none';
    if (btnOverlayClose) btnOverlayClose.style.display = 'none';
    if (copyBtnHeader) copyBtnHeader.style.display = 'flex';

    if (outputText) {
        outputText.classList.remove('html-content');
        outputText.innerText = "";
        outputText.innerHTML = "";
        outputText.contentEditable = "false";
    }

    if (mode === 'deanonymize') {
        wrapper.classList.add('mode-deanonymize');
        if (inputPanel) inputPanel.style.display = 'none';
        if (footer) footer.style.display = 'flex';
        if (sendBtn) sendBtn.style.display = 'none';
        if (copyBtnHeader) copyBtnHeader.style.display = 'none';
        if (btnOverlayCopy) btnOverlayCopy.style.display = 'inline-flex';
        if (btnOverlayClose) btnOverlayClose.style.display = 'inline-flex';

        appTitle.innerText = chrome.i18n.getMessage("title_deanonymize_mode");
        if (outputHeaderTitle) outputHeaderTitle.innerText = chrome.i18n.getMessage("panel_original_preview");
        if (outputText) {
            outputText.classList.add('html-content');
            outputText.innerHTML = content;
        }
    } else {
        appTitle.innerText = chrome.i18n.getMessage("title_anonymize_mode");
        if (outputHeaderTitle) outputHeaderTitle.innerText = chrome.i18n.getMessage("panel_anonymized");
        if (inputText) {
            inputText.value = content;
            lastInputText = content || "";
        }
    }
}

function hideOverlay() {
    overlayContainer.style.display = 'none';
    overlayContainer.style.pointerEvents = 'none';

    // Unlock Body Scroll
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';

    const ctx = shadowRoot.getElementById('customContextMenu');
    if (ctx) ctx.style.display = 'none';
    const menu = shadowRoot.getElementById('settingsDropdown');
    if (menu) menu.style.display = 'none';
    const modalDeanonymize = shadowRoot.getElementById('modalDeanonymizeInfo');
    if (modalDeanonymize) modalDeanonymize.style.display = 'none';
    const modalLicense = shadowRoot.getElementById('modalLicense');
    if (modalLicense) modalLicense.style.display = 'none';

    const responseMenu = shadowRoot.getElementById('responseContextMenu');
    if (responseMenu) responseMenu.style.display = 'none';
}

function showToast(message, type = 'info') {
    if (!shadowRoot) return;

    let toastContainer = shadowRoot.getElementById('chatwall-toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'chatwall-toast-container';
        shadowRoot.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.className = `chatwall-toast toast-${type}`;
    toast.innerText = message;

    toastContainer.appendChild(toast);

    toast.offsetHeight;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }, 3000);
}

function showResponseToast(message, x, y) {
    if (!shadowRoot) return;
    const toast = shadowRoot.getElementById('responseToast');
    if (toast) {
        toast.innerText = message;
        toast.style.left = `${x}px`;
        toast.style.top = `${y}px`;
        toast.style.display = 'flex';
        toast.style.opacity = '1';

        if (overlayContainer) overlayContainer.style.display = 'block';

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                toast.style.display = 'none';
                hideResponseMenu();
            }, 300);
        }, 2000);
    }
}

function updatePlanUI() {
    if (!shadowRoot) return;

    const label = shadowRoot.getElementById('currentPlanLabel');
    const btnUpgrade = shadowRoot.getElementById('btnUpgrade');
    const isPremium = USER_PLAN !== 'FREE';
    const hidePayment = (typeof ChatWallConfig !== 'undefined' && ChatWallConfig.HIDE_PAYMENT_LINKS);

    if (label) {
        label.innerText = `Plan: ${isPremium ? USER_PLAN + ' 🌟' : 'Free'}`;
        label.style.color = isPremium ? '#16a34a' : '#64748b';
    }
    if (btnUpgrade) {
        if (hidePayment) {
            btnUpgrade.style.display = 'none';
        } else if (IS_SAFARI) {
            // Safari: Show upgrade (or manage) button always
            if (isPremium) {
                btnUpgrade.innerHTML = '<span style="font-size: 15px; line-height: 1;">⚙️</span> Manage Subscription';
                btnUpgrade.style.display = 'flex';
            } else {
                btnUpgrade.innerHTML = '<span style="font-size: 15px; line-height: 1;">👑</span> ' + (chrome.i18n.getMessage('btn_upgrade') || 'Upgrade to Premium');
                btnUpgrade.style.display = 'flex';
            }
        } else {
            btnUpgrade.style.display = isPremium ? 'none' : 'flex';
        }
    }

    const linkGetLicense = shadowRoot.getElementById('linkGetLicense');
    if (linkGetLicense) {
        if (hidePayment || isPremium || IS_SAFARI) {
            linkGetLicense.style.display = 'none';
        } else {
            linkGetLicense.style.display = '';
        }
    }
}

async function showResponseMenu(x, y, hasToken = false) {
    if (!shadowRoot) {
        await createOverlay();
    }

    if (overlayContainer) {
        overlayContainer.style.display = 'block';
        overlayContainer.style.pointerEvents = 'auto';
    }

    const backdrop = shadowRoot.querySelector('.overlay-backdrop');
    if (backdrop) {
        backdrop.style.display = 'none';
    }

    const menu = shadowRoot.getElementById('responseContextMenu');
    const toast = shadowRoot.getElementById('responseToast');

    if (menu) {
        if (toast) toast.style.display = 'none';

        menu.style.display = 'block';

        const rcUnmask = shadowRoot.getElementById('rcUnmask');
        if (rcUnmask) {
            rcUnmask.style.display = 'flex';
        }

        const winW = window.innerWidth;
        const winH = window.innerHeight;
        let finalX = x;
        let finalY = y;

        if (x + 220 > winW) finalX = winW - 230;
        if (y + 160 > winH) finalY = winH - 170;

        menu.style.left = `${finalX}px`;
        menu.style.top = `${finalY}px`;
    }
}

function hideResponseMenu() {
    if (!shadowRoot) return;

    const menu = shadowRoot.getElementById('responseContextMenu');
    if (menu) menu.style.display = 'none';

    const backdrop = shadowRoot.querySelector('.overlay-backdrop');
    if (backdrop && backdrop.style.display === 'none') {
        if (overlayContainer) overlayContainer.style.display = 'none';
    }
}

// --- FLOAT BUTTON UI ---

function injectFloatStyles() {
    if (document.getElementById('chatwall-float-style')) return;
    const style = document.createElement('style');
    style.id = 'chatwall-float-style';
    style.textContent = `
        .cw-float-base {
            position: absolute;
            z-index: 2147483647; 
            width: 44px;
            height: 44px;
            border-radius: 50%;
            background: white;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            cursor: pointer;
            display: none;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s, background 0.2s, box-shadow 0.2s;
            border: 2px solid #fff;
        }
        .cw-float-base:hover {
            transform: scale(1.1);
        }
        #chatwall-float-btn.cw-warning {
            border-color: #ef4444; 
            background: #fff;
            box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.2);
        }
        #chatwall-unmask-btn {
            border-color: #22c55e; 
            background: #fff;
            box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.2);
        }
        .cw-badge {
            position: absolute;
            top: -8px;
            right: -8px;
            width: 20px;
            height: 20px;
            display: none;
            z-index: 10;
            filter: drop-shadow(0 2px 2px rgba(0,0,0,0.2));
            animation: cw-bounce 2s infinite;
        }
        .cw-tooltip {
            position: absolute;
            bottom: 60px;
            right: -20px;
            background: #1e293b;
            color: white;
            padding: 10px 14px;
            border-radius: 6px;
            font-size: 13px;
            line-height: 1.4;
            width: 260px;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.2);
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s, background 0.2s, border 0.2s;
            z-index: 2147483648;
            font-family: sans-serif;
            text-align: center;
            border: 1px solid transparent; 
        }
        .cw-float-base:hover .cw-tooltip,
        #chatwall-float-btn.cw-warning:hover .cw-tooltip,
        .cw-tooltip.visible {
            opacity: 1;
        }
        .cw-tooltip.visible {
            background: #fff;
            color: #334155;
            border: 2px solid #22c55e;
            box-shadow: 0 4px 12px rgba(34, 197, 94, 0.25);
            font-weight: 600;
        }
        @keyframes cw-bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-3px); }
        }
    `;
    document.head.appendChild(style);
}

function analyzeContentRisk(target) {
    if (!chrome.runtime?.id) return; // Stop if context invalidated
    if (!target) return;

    let text = extractTextFromElement(target);

    if (!text || text.trim().length < 4) {
        updateButtonState(false);
        return;
    }

    for (let fav of favoritesList) {
        if (text.includes(fav)) {
            updateButtonState(true);
            return;
        }
    }

    for (let block of manualBlockList) {
        if (text.includes(block) && !ignoredEntities.has(block)) {
            updateButtonState(true);
            return;
        }
    }

    try {
        chrome.runtime.sendMessage({
            action: 'ANALYZE_TEXT',
            text: text,
            offset: 0
        }, (response) => {
            if (response && response.matches && response.matches.length > 0) {
                const hasRiskyMatch = response.matches.some(m => !ignoredEntities.has(m.text));
                updateButtonState(hasRiskyMatch);
            } else {
                updateButtonState(false);
            }
        });
    } catch (e) {
        updateButtonState(false);
    }
}

function createFloatingButton() {
    injectFloatStyles();

    if (!document.getElementById('chatwall-float-btn')) {
        floatBtn = document.createElement('div');
        floatBtn.id = 'chatwall-float-btn';
        floatBtn.className = 'cw-float-base';

        const img = document.createElement('img');
        img.src = chrome.runtime.getURL('logo.png');
        img.style.width = '28px'; img.style.height = '28px'; img.style.objectFit = 'contain'; img.style.pointerEvents = 'none';
        floatBtn.appendChild(img);

        floatBadge = document.createElement('div');
        floatBadge.className = 'cw-badge';
        floatBadge.innerHTML = RED_SHIELD_SVG;
        floatBtn.appendChild(floatBadge);

        floatTooltip = document.createElement('div');
        floatTooltip.className = 'cw-tooltip';
        floatTooltip.innerHTML = `<strong>${chrome.i18n.getMessage('appName')}</strong><br>${chrome.i18n.getMessage('tooltip_mask_action')}`;
        floatBtn.appendChild(floatTooltip);

        floatBtn.addEventListener('mousedown', (e) => e.preventDefault());
        floatBtn.addEventListener('click', async (e) => {
            e.preventDefault(); e.stopPropagation();
            if (currentFloatTarget) {
                let currentText = extractTextFromElement(currentFloatTarget);

                const tokenMap = await getTokenMap();
                const hasKnownTokens = (currentText.match(/\[[A-Z]+_[A-Z0-9]+\]/g) || []).some(token => tokenMap.hasOwnProperty(token));

                if (hasKnownTokens) {
                    showDecisionPopup(floatBtn);
                    return;
                }

                lastRightClickedElement = currentFloatTarget;
                handleShowOverlay();
            }
        });
        document.body.appendChild(floatBtn);
    }

    if (!document.getElementById('chatwall-unmask-btn')) {
        unmaskBtn = document.createElement('div');
        unmaskBtn.id = 'chatwall-unmask-btn';
        unmaskBtn.className = 'cw-float-base';

        const imgUn = document.createElement('img');
        imgUn.src = chrome.runtime.getURL('logo.png');
        imgUn.style.width = '28px'; imgUn.style.height = '28px'; imgUn.style.objectFit = 'contain'; imgUn.style.pointerEvents = 'none';
        unmaskBtn.appendChild(imgUn);

        unmaskBadge = document.createElement('div');
        unmaskBadge.className = 'cw-badge';
        unmaskBadge.style.display = 'block';
        unmaskBadge.innerHTML = GREEN_EYE_SVG;
        unmaskBtn.appendChild(unmaskBadge);

        const unmaskTooltip = document.createElement('div');
        unmaskTooltip.className = 'cw-tooltip';
        unmaskTooltip.innerHTML = `<b>${chrome.i18n.getMessage('tooltip_response_done')}</b><br>${chrome.i18n.getMessage('tooltip_click_unmask')}`;
        unmaskBtn.appendChild(unmaskTooltip);

        unmaskBtn.addEventListener('mousedown', (e) => e.preventDefault());
        unmaskBtn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            handleDeanonymizeElement(currentUnmaskTarget);
        });
        document.body.appendChild(unmaskBtn);
    }
}

function showFloatButton(target) {
    if (floatHideTimer) clearTimeout(floatHideTimer);

    createFloatingButton();
    currentFloatTarget = target;
    activeTarget = target;
    currentFloatAnchor = getVisualAnchor(target);

    const rect = currentFloatAnchor.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const top = rect.top + window.scrollY - 50;
    const left = rect.right + window.scrollX - 50;

    floatBtn.style.top = `${top}px`;
    floatBtn.style.left = `${left}px`;
    floatBtn.style.display = 'flex';

    analyzeContentRisk(target);
}

function hideFloatButton() {
    floatHideTimer = setTimeout(() => {
        if (floatBtn) floatBtn.style.display = 'none';
        currentFloatTarget = null;
    }, 200);
}

function showUnmaskButton(target) {
    createFloatingButton();
    currentUnmaskTarget = target;
    currentUnmaskAnchor = getVisualAnchor(target);

    if (!document.body.contains(target)) return;
    updateUnmaskPosition(target);
}

function updateUnmaskPosition(targetBtn) {
    let anchor = currentFloatAnchor;
    if (!anchor) {
        const input = findMainInput();
        if (input) anchor = getVisualAnchor(input);
    }

    if (!unmaskBtn || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const top = rect.top + window.scrollY - 50;
    const left = rect.right + window.scrollX - 90;

    unmaskBtn.style.top = `${top}px`;
    unmaskBtn.style.left = `${left}px`;
    unmaskBtn.style.display = 'flex';
}

function updateButtonState(hasRisk) {
    if (!chrome.runtime?.id) return; // Context Invalidated
    if (!floatBtn) return;
    if (hasRisk === lastRiskAnalysis) return;
    lastRiskAnalysis = hasRisk;

    if (hasRisk) {
        floatBtn.classList.add('cw-warning');
        if (floatBadge) floatBadge.style.display = 'block';
        if (floatTooltip) floatTooltip.innerHTML = `<b>${chrome.i18n.getMessage('tooltip_sensitive_data')}</b><br>${chrome.i18n.getMessage('tooltip_use_chatwall')}`;
    } else {
        floatBtn.classList.remove('cw-warning');
        if (floatBadge) floatBadge.style.display = 'none';
        if (floatTooltip) floatTooltip.innerHTML = `<strong>${chrome.i18n.getMessage('appName')}</strong><br>${chrome.i18n.getMessage('tooltip_mask_action')}`;
    }
}

function showDecisionPopup(anchorBtn) {
    if (decisionPopup) {
        decisionPopup.remove();
        decisionPopup = null;
    }

    decisionPopup = document.createElement('div');
    decisionPopup.className = 'cw-decision-popup';
    Object.assign(decisionPopup.style, {
        position: 'absolute',
        zIndex: '2147483650',
        background: 'white',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        padding: '12px',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        width: '280px',
        fontFamily: 'sans-serif',
        fontSize: '13px',
        color: '#334155',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
    });

    const rect = anchorBtn.getBoundingClientRect();
    const top = rect.bottom + window.scrollY + 8;
    const left = rect.left + window.scrollX - 120;
    decisionPopup.style.top = `${top}px`;
    decisionPopup.style.left = `${left}px`;

    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.style.color = '#0f172a';
    title.style.marginBottom = '4px';
    title.innerText = chrome.i18n.getMessage('popup_masked_warn_title');

    const msg = document.createElement('div');
    msg.style.lineHeight = '1.4';
    let warnMsg = chrome.i18n.getMessage('popup_masked_warn_msg');
    msg.innerHTML = warnMsg;

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, {
        display: 'flex',
        gap: '8px',
        marginTop: '8px',
        justifyContent: 'flex-end'
    });

    const btnCancel = document.createElement('button');
    btnCancel.innerText = chrome.i18n.getMessage('btn_popup_send_action') || "Send";
    Object.assign(btnCancel.style, {
        padding: '6px 12px',
        borderRadius: '4px',
        border: '1px solid #cbd5e1',
        background: 'white',
        cursor: 'pointer',
        fontSize: '12px',
        color: '#475569'
    });
    btnCancel.onclick = () => {
        decisionPopup.remove();
        decisionPopup = null;
    };

    const btnEdit = document.createElement('button');
    btnEdit.innerText = chrome.i18n.getMessage('btn_edit_prompt');
    Object.assign(btnEdit.style, {
        padding: '6px 12px',
        borderRadius: '4px',
        border: 'none',
        background: '#2563eb',
        color: 'white',
        cursor: 'pointer',
        fontSize: '12px',
        fontWeight: '500'
    });
    btnEdit.onclick = async () => {
        decisionPopup.remove();
        decisionPopup = null;

        lastRightClickedElement = currentFloatTarget;

        let rawText = "";
        if (currentFloatTarget) {
            // FIX: Pass true to preserve paragraphs during re-edit
            rawText = extractTextFromElement(currentFloatTarget, true);
        }

        const currentBlocks = [...manualBlockList];
        const tokenMap = await getTokenMap();
        let restored = rawText.replace(/\[[A-Z]+_[A-Z0-9]+\]/g, (match) => tokenMap[match] || match);

        handleShowOverlay(restored, currentBlocks);
    };

    btnRow.appendChild(btnCancel);
    btnRow.appendChild(btnEdit);

    decisionPopup.appendChild(title);
    decisionPopup.appendChild(msg);
    decisionPopup.appendChild(btnRow);

    document.body.appendChild(decisionPopup);

    const closeListener = (e) => {
        if (decisionPopup && !decisionPopup.contains(e.target) && e.target !== anchorBtn) {
            decisionPopup.remove();
            decisionPopup = null;
            document.removeEventListener('click', closeListener);
        }
    };
    setTimeout(() => document.addEventListener('click', closeListener), 100);
}


// --- UNMASKING LOGIC ---

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

// --- INITIALIZATION & EVENTS ---

function initOverlayEvents() {
    const inputText = shadowRoot.getElementById('inputText');
    const inputHighlights = shadowRoot.getElementById('inputHighlights');
    const outputText = shadowRoot.getElementById('outputText');

    if (inputText) {
        lastInputText = inputText.value || "";
        let overlayTypingTimer;
        inputText.addEventListener('input', () => {
            // Optimistic Rendering: Sync Shift
            handleOptimisticInput(inputText);

            // Safari Cursor Bug Fix: Force Repaint on Layout Change
            // FIX: Use Width Wiggle to brutally force the text layout engine to re-calculate line breaks.
            if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) {
                try {
                    const originalHeight = inputText.style.height;
                    inputText.style.height = (inputText.scrollHeight) + 'px';
                    inputText.offsetHeight; // Force reflow
                    inputText.style.height = originalHeight;
                } catch (e) { }
            }

            clearTimeout(overlayTypingTimer);
            overlayTypingTimer = setTimeout(() => {
                processText();
            }, 300);
        });

        inputText.addEventListener('paste', () => {
            setTimeout(() => {
                // Optimized Paste: Immediate Partial Scan of Visible Area
                // forceFullScan=false, fromScroll=true (To center on viewport)
                processText(false, true);

                // Fallback: If pasted content is huge and partial scan missed something deep,
                // the scroll handler or eventual typing will catch it.
                // Or we could schedule a full background scan later if idle?
                // For now, partial is enough for immediate feedback.
            }, 50);
        });
    }
    const closeBtn = shadowRoot.getElementById('closeBtn');
    if (closeBtn) closeBtn.addEventListener('click', hideOverlay);

    const sendBtn = shadowRoot.getElementById('sendBtn');
    if (sendBtn) sendBtn.addEventListener('click', sendToLLM);

    const rcUnmask = shadowRoot.getElementById('rcUnmask');
    const rcUnmaskCopy = shadowRoot.getElementById('rcUnmaskCopy');

    if (rcUnmask) rcUnmask.addEventListener('click', () => handleResponseAction('UNMASK'));
    if (rcUnmaskCopy) rcUnmaskCopy.addEventListener('click', () => handleResponseAction('UNMASK_COPY'));

    shadowRoot.addEventListener('click', (e) => {
        const menu = shadowRoot.getElementById('responseContextMenu');
        if (menu && menu.style.display === 'block') {
            if (!menu.contains(e.target)) {
                hideResponseMenu();
            } else {
                e.stopPropagation();
            }
        }
    });

    const showOverlayToast = (message) => {
        let toast = shadowRoot.getElementById('cw-overlay-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'cw-overlay-toast';
            Object.assign(toast.style, {
                position: 'fixed',
                bottom: '150px',
                right: '220px',
                left: 'auto',
                transform: 'none',
                background: '#334155',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '600',
                textAlign: 'center',
                lineHeight: '1.5',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                zIndex: '2147483647',
                opacity: '0',
                transition: 'opacity 0.3s ease'
            });
            shadowRoot.appendChild(toast);
        }
        toast.innerHTML = message;
        toast.style.display = 'block';
        requestAnimationFrame(() => toast.style.opacity = '1');

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.style.display = 'none', 300);
        }, 2000);
    };

    const handleCopy = async () => {
        const wrapper = shadowRoot.getElementById('mainWrapper');
        const isUnmask = wrapper && wrapper.classList.contains('mode-deanonymize');

        const plainText = outputText.innerText;
        let richHtml;

        if (isUnmask) {
            // Unmask mode: preserve original formatting (bold, headings, lists, etc.)
            richHtml = outputText.innerHTML;
        } else {
            // Masked mode: build clean HTML from plain text
            richHtml = '<div>' + plainText
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/\n/g, '<br>') + '</div>';
        }

        const msg = isUnmask ? chrome.i18n.getMessage('toast_unmasked_copied') : chrome.i18n.getMessage('toast_masked_copied');

        try {
            const blobText = new Blob([plainText], { type: 'text/plain' });
            const blobHtml = new Blob([richHtml], { type: 'text/html' });
            await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blobText, 'text/html': blobHtml })]);
            showOverlayToast(`✅ ${msg}`);
        } catch (err) {
            console.error("Clipboard write failed", err);
            navigator.clipboard.writeText(plainText);
            showOverlayToast(`✅ ${msg}`);
        }
    };

    const copyBtn = shadowRoot.getElementById('copyBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            await handleCopy();
            const originalIcon = copyBtn.innerHTML;
            copyBtn.innerHTML = '✅';
            setTimeout(() => copyBtn.innerHTML = originalIcon, 1500);
        });
    }

    const btnOverlayClose = shadowRoot.getElementById('btnOverlayClose');
    if (btnOverlayClose) {
        btnOverlayClose.addEventListener('click', hideOverlay);
    }

    const btnOverlayCopy = shadowRoot.getElementById('btnOverlayCopy');
    if (btnOverlayCopy) {
        btnOverlayCopy.addEventListener('click', async () => {

            const rect = btnOverlayCopy.getBoundingClientRect();
            btnOverlayCopy.style.width = `${rect.width}px`;
            btnOverlayCopy.style.height = `${rect.height}px`;
            btnOverlayCopy.style.justifyContent = 'center';

            const originalHTML = btnOverlayCopy.innerHTML;
            const svgRegex = /<svg[\s\S]*?<\/svg>/i;
            if (svgRegex.test(originalHTML)) {
                btnOverlayCopy.innerHTML = originalHTML.replace(svgRegex, '<div class="cw-spinner"></div>');
            } else {
                btnOverlayCopy.innerHTML = '<div class="cw-spinner"></div>';
            }

            await handleCopy();

            btnOverlayCopy.innerHTML = originalHTML;
            btnOverlayCopy.style.width = '';
            btnOverlayCopy.style.height = '';
        });
    }

    const btnSettings = shadowRoot.getElementById('btnSettings');
    const settingsDropdown = shadowRoot.getElementById('settingsDropdown');
    const btnAccount = shadowRoot.getElementById('btnAccount');
    const accountDropdown = shadowRoot.getElementById('accountDropdown');

    if (btnSettings && settingsDropdown) {
        btnSettings.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = (settingsDropdown.style.display === 'block');
            settingsDropdown.style.display = isVisible ? 'none' : 'block';
            if (accountDropdown) accountDropdown.style.display = 'none';
        });
    }

    // Safari: Hide the account button entirely (no license key / account management)
    if (IS_SAFARI && btnAccount) {
        btnAccount.style.display = 'none';
    }

    if (btnAccount && !IS_SAFARI) {
        btnAccount.addEventListener('click', (e) => {
            e.stopPropagation();
            if (settingsDropdown) settingsDropdown.style.display = 'none';

            // Toggle Account Dropdown
            if (accountDropdown) {
                const isVisible = (accountDropdown.style.display === 'block');
                accountDropdown.style.display = isVisible ? 'none' : 'block';
            }
        });
    }

    const menuAccountLink = shadowRoot.getElementById('menuAccountLink');
    if (menuAccountLink && !IS_SAFARI) {
        menuAccountLink.addEventListener('click', () => {
            chrome.storage.local.get(['chatwall_email', 'chatwall_id'], (data) => {
                if (data.chatwall_id) {
                    const qs = `?id=${encodeURIComponent(data.chatwall_id)}`;
                    window.open(`${CONFIG_API_URL}/login.html${qs}`, '_blank');
                } else {
                    window.open(`${CONFIG_API_URL}/dashboard.html`, '_blank');
                }
            });
        });
    }

    shadowRoot.addEventListener('click', (e) => {
        if (settingsDropdown && settingsDropdown.style.display === 'block') settingsDropdown.style.display = 'none';
        if (accountDropdown && accountDropdown.style.display === 'block') accountDropdown.style.display = 'none';
    });

    const btnUpgrade = shadowRoot.getElementById('btnUpgrade');
    if (btnUpgrade) {
        btnUpgrade.addEventListener('click', () => {
            if (IS_SAFARI) {
                // Safari: Premium users → manage subscription; Free users → trigger native IAP
                if (USER_PLAN !== 'FREE') {
                    window.open('https://apps.apple.com/account/subscriptions', '_blank');
                } else {
                    const originalHTML = btnUpgrade.innerHTML;
                    btnUpgrade.innerHTML = '<span style="font-size: 15px; line-height: 1;">⏳</span> Opening App Store...';
                    btnUpgrade.disabled = true;
                    chrome.runtime.sendMessage({ action: 'START_PURCHASE' }, (response) => {
                        setTimeout(() => {
                            btnUpgrade.innerHTML = originalHTML;
                            btnUpgrade.disabled = false;
                            // Re-check premium status after a short delay
                            setTimeout(() => syncUserPlan(), 2000);
                        }, 3000);
                    });
                }
            } else {
                window.open(CONFIG_API_URL + '/#pricing', '_blank');
                const modal = shadowRoot.getElementById('modalLicense');
                if (modal) modal.style.display = 'flex';
            }
        });
    }

    // Safari: Skip all license/account modal bindings — IAP handles everything
    if (IS_SAFARI) {
        const modalLicense = shadowRoot.getElementById('modalLicense');
        if (modalLicense) modalLicense.style.display = 'none';
        return; // Exit initOverlayEvents early for Safari — no more license UI needed
    }

    const menuLicense = shadowRoot.getElementById('menuLicense');
    const modalLicense = shadowRoot.getElementById('modalLicense');
    const btnCloseLicense = shadowRoot.getElementById('btnCloseLicense');
    const btnSaveLicense = shadowRoot.getElementById('btnSaveLicense');
    const inpLicenseEmail = shadowRoot.getElementById('inpLicenseEmail');
    const inpLicenseKey = shadowRoot.getElementById('inpLicenseKey');
    const licenseErrorArea = shadowRoot.getElementById('licenseErrorArea');
    const licenseStatusMsg = shadowRoot.getElementById('licenseStatusMsg');
    const btnResetDevices = shadowRoot.getElementById('btnResetDevices');
    const linkForgotKey = shadowRoot.getElementById('linkForgotKey');
    const linkManageSubscription = shadowRoot.getElementById('linkManageSubscription');
    const linkGetLicense = shadowRoot.getElementById('linkGetLicense');

    if (menuLicense) {
        menuLicense.addEventListener('click', () => {
            chrome.storage.local.get(['chatwall_email', 'chatwall_license_key', 'chatwall_id'], (data) => {
                const email = data.chatwall_email || "";
                if (inpLicenseEmail) inpLicenseEmail.value = email;
                if (inpLicenseKey) inpLicenseKey.value = data.chatwall_license_key || "";

                const hasId = !!data.chatwall_id;
                const accountPage = hasId
                    ? `${CONFIG_API_URL}/login.html?id=${encodeURIComponent(data.chatwall_id)}`
                    : `${CONFIG_API_URL}/dashboard.html`;

                if (linkForgotKey) {
                    linkForgotKey.href = accountPage;
                    linkForgotKey.target = '_blank';
                }
                if (linkManageSubscription) {
                    linkManageSubscription.href = accountPage;
                    linkManageSubscription.target = '_blank';
                }
                if (linkGetLicense) {
                    linkGetLicense.href = `${CONFIG_API_URL}/#pricing`;
                    linkGetLicense.target = '_blank';
                }
            });
            licenseErrorArea.style.display = 'none';
            btnResetDevices.style.display = 'none';
            modalLicense.style.display = 'flex';
        });
    }

    if (btnCloseLicense) btnCloseLicense.addEventListener('click', () => modalLicense.style.display = 'none');

    if (btnSaveLicense) {
        btnSaveLicense.addEventListener('click', () => {
            const email = inpLicenseEmail.value.trim();
            const key = inpLicenseKey.value.trim();

            if (!email || !key) {
                licenseStatusMsg.innerText = chrome.i18n.getMessage("license_msg_fill_required");
                licenseErrorArea.style.display = 'block';
                return;
            }

            licenseStatusMsg.innerText = chrome.i18n.getMessage("license_msg_verifying");
            licenseStatusMsg.style.color = "blue";
            licenseErrorArea.style.display = 'block';
            licenseErrorArea.style.background = '#e0f2fe';
            btnResetDevices.style.display = 'none';

            chrome.runtime.sendMessage({
                action: 'CHECK_LICENSE_API',
                email: email,
                key: key
            }, (response) => {
                if (response.status === 'VALID' || response.status === 'VIP') {
                    licenseStatusMsg.innerText = chrome.i18n.getMessage("license_msg_success", [response.plan]);
                    licenseStatusMsg.style.color = "green";
                    licenseErrorArea.style.background = '#dcfce7';
                    setTimeout(() => {
                        modalLicense.style.display = 'none';
                        USER_PLAN = response.plan;
                        updatePlanUI();
                        processText(true);
                    }, 1500);
                }
                else if (response.status === 'LIMIT_REACHED') {
                    // Update: Remove Reset Button, point to Dashboard
                    licenseStatusMsg.innerHTML = chrome.i18n.getMessage("license_msg_limit_reached", [
                        response.message,
                        `${CONFIG_API_URL}/#pricing`,
                        `${CONFIG_API_URL}/dashboard.html`
                    ]);
                    licenseStatusMsg.style.color = "#b91c1c";
                    licenseErrorArea.style.background = '#fee2e2';
                    if (btnResetDevices) btnResetDevices.style.display = 'none';
                }
                else if (response.status === 'NETWORK_ERROR') {
                    licenseStatusMsg.innerHTML = chrome.i18n.getMessage("license_msg_network_error");
                    licenseStatusMsg.style.color = "#b91c1c";
                    licenseErrorArea.style.background = '#fee2e2';
                }
                else {
                    console.error("License Error:", response);
                    licenseStatusMsg.innerText = `Error: ${response.message || response.status || 'Invalid credentials'}`;
                    licenseStatusMsg.style.color = "red";
                    licenseErrorArea.style.background = '#fee2e2';
                }
            });
        });
    }

    if (btnResetDevices) {
        btnResetDevices.addEventListener('click', () => {
            const email = inpLicenseEmail.value.trim();
            const key = inpLicenseKey.value.trim();

            if (!confirm(chrome.i18n.getMessage("license_button_reset_warning"))) return;

            btnResetDevices.innerText = chrome.i18n.getMessage("license_button_resetting");
            btnResetDevices.disabled = true;

            chrome.runtime.sendMessage({ action: 'RESET_DEVICES', email, key }, (response) => {
                btnResetDevices.innerText = chrome.i18n.getMessage("license_button_reset_default");
                btnResetDevices.disabled = false;

                if (response.success) {
                    alert("Devices reset successfully. Please click Activate again.");
                    btnResetDevices.style.display = 'none';
                    licenseStatusMsg.innerText = "Reset done. Retry activation.";
                } else {
                    alert("Error: " + (response.error || "Unknown error"));
                }
            });
        });
    }

    // Static href assignment removed, handled dynamically in modal open logic

    const btnToggleLicenseVisibility = shadowRoot.getElementById('btnToggleLicenseVisibility');
    if (btnToggleLicenseVisibility && inpLicenseKey) {
        btnToggleLicenseVisibility.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (inpLicenseKey.type === 'password') {
                inpLicenseKey.type = 'text';
                btnToggleLicenseVisibility.style.color = '#2563eb';
            } else {
                inpLicenseKey.type = 'password';
                btnToggleLicenseVisibility.style.color = '#64748b';
            }
        });
    }

    const menuHelp = shadowRoot.getElementById('menuHelp');
    const menuAbout = shadowRoot.getElementById('menuAbout');
    const menuLegal = shadowRoot.getElementById('menuLegal');
    const menuTerms = shadowRoot.getElementById('menuTerms');
    const menuPrivacy = shadowRoot.getElementById('menuPrivacy');
    const modalInfo = shadowRoot.getElementById('modalInfo');
    const infoTitle = shadowRoot.getElementById('infoTitle');
    const infoBody = shadowRoot.getElementById('infoBody');
    const btnCloseInfo = shadowRoot.getElementById('btnCloseInfo');

    const openInfo = (title, html) => {
        infoTitle.innerText = title;
        infoBody.innerHTML = html;
        modalInfo.style.display = 'flex';
    };

    // menuManageSub removed from settings menu, kept only in account dropdown

    if (menuHelp) {
        menuHelp.addEventListener('click', () => {
            window.open('https://chatwall.io/support.html#docs', '_blank');
        });
    }
    if (menuLegal) {
        menuLegal.addEventListener('click', async () => {
            try {
                const url = chrome.runtime.getURL('License.txt');
                const resp = await fetch(url);
                const text = await resp.text();
                const formatted = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
                openInfo('License', `<div style="text-align:left; font-size:12px; height:300px; overflow-y:auto; padding-right:5px; font-family:monospace;">${formatted}</div>`);
            } catch (e) {
                openInfo('Error', 'Could not load License.txt');
            }
        });
    }

    if (menuTerms) {
        menuTerms.addEventListener('click', () => {
            window.open('https://chatwall.io/terms.html', '_blank');
        });
    }

    if (menuPrivacy) {
        menuPrivacy.addEventListener('click', () => {
            window.open('https://chatwall.io/privacy.html', '_blank');
        });
    }
    if (menuAbout) {
        menuAbout.addEventListener('click', () => {
            const ver = (typeof ChatWallConfig !== 'undefined' && ChatWallConfig.VERSION) ? ChatWallConfig.VERSION : 'Dev';
            openInfo(chrome.i18n.getMessage('menu_about'), `ChatWall v${ver}<br>The AI Privacy Firewall<br><br>Copyright © 2025 StarObject S.A. <br><a href="https://chatwall.io" target="_blank" style="color:#6366f1">chatwall.io</a><br><a href="mailto:info@chatwall.io" style="color:#6366f1">info@chatwall.io</a>`);
        });
    }

    if (btnCloseInfo) btnCloseInfo.addEventListener('click', () => modalInfo.style.display = 'none');

    const toolMask = shadowRoot.getElementById('toolMask');
    const toolUnmask = shadowRoot.getElementById('toolUnmask');

    // SAFARI FIX: Save selection state before button click steals focus.
    // Safari doesn't fully honor mousedown preventDefault() in Shadow DOM,
    // so we persist the last known selection for the mask/unmask handlers.
    let _lastSelection = { start: 0, end: 0 };
    if (inputText) {
        const saveSelection = () => {
            _lastSelection = {
                start: inputText.selectionStart || 0,
                end: inputText.selectionEnd || 0
            };
        };
        inputText.addEventListener('mouseup', saveSelection);
        inputText.addEventListener('keyup', saveSelection);
        inputText.addEventListener('select', saveSelection);
        // Also save on focus so we have a baseline
        inputText.addEventListener('focus', saveSelection);
    }

    [toolMask, toolUnmask].forEach(btn => {
        if (btn) btn.addEventListener('mousedown', (e) => e.preventDefault());
    });

    const toggleTool = (tool) => {
        if (activeTool === tool) {
            activeTool = null;
            toolMask.classList.remove('active');
            toolUnmask.classList.remove('active');
            inputText.style.cursor = 'auto';

            if (inputText) {
                const scrollPos = inputText.scrollTop;
                inputText.selectionEnd = inputText.selectionStart;
                inputText.scrollTop = scrollPos;
            }
        } else {
            activeTool = tool;

            if (tool === 'mask') {
                toolMask.classList.add('active');
                toolUnmask.classList.remove('active');
            } else {
                toolUnmask.classList.add('active');
                toolMask.classList.remove('active');
            }
            inputText.style.cursor = 'text';

            inputText.focus();
        }
    };

    if (toolMask) toolMask.addEventListener('click', (e) => {
        e.preventDefault();

        let hasSelection = false;
        let start = 0;
        let end = 0;

        // SAFARI FIX: Use saved selection if activeElement check fails (focus shifted to button)
        if (inputText && (shadowRoot.activeElement === inputText || IS_SAFARI)) {
            start = inputText.selectionStart || 0;
            end = inputText.selectionEnd || 0;
            // In Safari, selection may have been cleared — fall back to saved
            if (IS_SAFARI && start === end && _lastSelection.start !== _lastSelection.end) {
                start = _lastSelection.start;
                end = _lastSelection.end;
            }
            hasSelection = (start !== end);
        }

        if (hasSelection) {

            const selectedText = inputText.value.substring(start, end);
            handleMaskAction(selectedText);

            inputText.setSelectionRange(start, start);
            return;
        }

        if (activeTool === 'mask') {
            toggleTool('mask');
        } else {
            toggleTool('mask');
        }
    });

    if (toolUnmask) toolUnmask.addEventListener('click', (e) => {
        e.preventDefault();

        let hasSelection = false;
        let start = 0;
        let end = 0;

        // SAFARI FIX: Use saved selection if activeElement check fails
        if (inputText && (shadowRoot.activeElement === inputText || IS_SAFARI)) {
            start = inputText.selectionStart || 0;
            end = inputText.selectionEnd || 0;
            if (IS_SAFARI && start === end && _lastSelection.start !== _lastSelection.end) {
                start = _lastSelection.start;
                end = _lastSelection.end;
            }
            hasSelection = (start !== end);
        }

        if (hasSelection) {
            const selectedText = inputText.value.substring(start, end);
            handleUnmaskAction(selectedText, null, start, end);
            inputText.setSelectionRange(start, start);
            return;
        }

        if (inputText && (shadowRoot.activeElement === inputText || IS_SAFARI)) {
            const cursor = inputText.selectionStart || _lastSelection.start;
            const tokenUnderCursor = currentMatches.find(m => cursor > m.start && cursor < m.end);

            if (tokenUnderCursor) {
                handleUnmaskAction(null, tokenUnderCursor);
                return;
            }
        }

        if (activeTool === 'unmask') {
            toggleTool('unmask');
        } else {
            toggleTool('unmask');
        }
    });


    const ctxMenu = shadowRoot.getElementById('customContextMenu');
    shadowRoot.addEventListener('click', () => { if (ctxMenu) ctxMenu.style.display = 'none'; });

    if (inputText) {
        let isSyncing = false;
        // SAFARI FIX: Simple One-Way Scroll Sync (Input -> Highlights)
        // Bidirectional Input <-> Output sync removed to prevent infinite scroll loops.
        let scrollTimer;
        const syncScroll = () => {
            // ... existing sync logic ...
            if (inputHighlights && inputText) {
                // 1. Sync Highlights (Pixel-perfect)
                if (Math.abs(inputHighlights.scrollTop - inputText.scrollTop) > 1) {
                    inputHighlights.scrollTop = inputText.scrollTop;
                }
                if (Math.abs(inputHighlights.scrollLeft - inputText.scrollLeft) > 1) {
                    inputHighlights.scrollLeft = inputText.scrollLeft;
                }

                // 2. Sync Output (Linked-List Dual-Anchor Sync)
                if (outputText && outputText.scrollHeight > outputText.clientHeight) {
                    const perc = inputText.scrollTop / (inputText.scrollHeight - inputText.clientHeight);

                    // Fallback default
                    let targetScrollTop = perc * (outputText.scrollHeight - outputText.clientHeight);

                    try {
                        const inputTop = inputText.scrollTop;

                        if (cachedTokenPairs.length > 0) {
                            let prev = null;
                            let next = null;

                            // Linear search is fast enough for <1000 items, and items are sorted by file position
                            // We need to find items sorted by VISUAL position (offsetTop)

                            for (const pair of cachedTokenPairs) {
                                // Note: offsetTop is relative to scroll container top (assuming Position: Relative on container)
                                // We need to account for padding if necessary, but relative delta is what matters
                                if (pair.input.offsetTop <= inputTop) {
                                    prev = pair;
                                } else {
                                    next = pair;
                                    break;
                                }
                            }

                            if (prev && next) {
                                // Interpolate
                                const pIn = prev.input.offsetTop;
                                const nIn = next.input.offsetTop;
                                const rangeIn = nIn - pIn;
                                const progress = (rangeIn > 0) ? (inputTop - pIn) / rangeIn : 0;

                                const pOut = prev.output.offsetTop;
                                const nOut = next.output.offsetTop;
                                targetScrollTop = pOut + (nOut - pOut) * progress;
                            }
                            else if (prev) {
                                // After last token
                                // Estimate remaining distance
                                const remainingInput = inputText.scrollHeight - prev.input.offsetTop;
                                const ratio = (inputText.scrollTop - prev.input.offsetTop) / (remainingInput || 1);

                                const remainingOutput = outputText.scrollHeight - prev.output.offsetTop;
                                targetScrollTop = prev.output.offsetTop + (remainingOutput * ratio);
                            }
                            else if (next) {
                                // Before first token
                                const ratio = inputTop / (next.input.offsetTop || 1);
                                targetScrollTop = next.output.offsetTop * ratio;
                            }
                        }
                    } catch (e) { /* ignore */ }

                    if (Math.abs(outputText.scrollTop - targetScrollTop) > 5) {
                        outputText.scrollTop = targetScrollTop;
                    }
                }
            }

            // Trigger Analysis on Scroll (Debounced)
            clearTimeout(scrollTimer);
            scrollTimer = setTimeout(() => {
                processText(false, true); // forceFullScan=false, fromScroll=true
            }, 300);
        };
        inputText.addEventListener('scroll', syncScroll, { passive: true });

        // SAFARI FIX: scroll events on textareas in Shadow DOM may not fire reliably.
        // Use a polling fallback to keep highlights in sync.
        if (IS_SAFARI) {
            let lastScrollTop = -1;
            setInterval(() => {
                if (inputText.scrollTop !== lastScrollTop) {
                    lastScrollTop = inputText.scrollTop;
                    syncScroll();
                }
            }, 100);
        }
        // NOTE: No listener on outputText. Input drives Output. Output is passive.
        // if (outputText) outputText.addEventListener('scroll', function () { syncScroll(this, [inputText, inputHighlights]); });



        inputText.addEventListener('mousedown', () => {
            isMouseDown = true;
            const wrapper = shadowRoot.getElementById('mainWrapper');
            if (wrapper) wrapper.classList.add('is-selecting');
        });

        window.addEventListener('mouseup', () => {
            isMouseDown = false;
            const wrapper = shadowRoot.getElementById('mainWrapper');
            if (wrapper) wrapper.classList.remove('is-selecting');

            if (!activeTool) return;
            if (shadowRoot.activeElement !== inputText) return;

            const start = inputText.selectionStart;
            const end = inputText.selectionEnd;
            if (start === end) return;

            const selectedText = inputText.value.substring(start, end);
            if (!selectedText) return;

            if (activeTool === 'mask') {
                handleMaskAction(selectedText);
                inputText.setSelectionRange(start, start);
            } else if (activeTool === 'unmask') {
                handleUnmaskAction(selectedText, null, start, end);
                inputText.setSelectionRange(start, start);
            }
        });

        inputText.addEventListener('click', (e) => {
            inputText.style.pointerEvents = 'none';
            const elem = shadowRoot.elementFromPoint(e.clientX, e.clientY);
            inputText.style.pointerEvents = 'auto';
            if (elem && elem.classList.contains('token-locked')) {
                window.open(CONFIG_API_URL + '/#pricing', '_blank');
            } else if (elem && elem.classList.contains('token')) {
                if (activeTool === 'unmask') {
                    const originalText = elem.getAttribute('data-text');
                    if (originalText) {
                        ignoredEntities.add(originalText);
                        processText(true);
                    }
                }
            }
        });

        const premiumTooltip = shadowRoot.getElementById('premiumTooltip');
        inputText.addEventListener('mousemove', (e) => {
            const elements = shadowRoot.elementsFromPoint(e.clientX, e.clientY);
            const lockedToken = elements.find(el => el.classList.contains('token-locked'));

            if (lockedToken) {
                const text = lockedToken.getAttribute('data-tooltip-text');
                if (text && premiumTooltip) {
                    premiumTooltip.style.display = 'block';
                    premiumTooltip.innerText = text;
                    premiumTooltip.style.left = (e.clientX + 10) + 'px';
                    premiumTooltip.style.top = (e.clientY + 10) + 'px';
                }
            } else {
                if (premiumTooltip) premiumTooltip.style.display = 'none';
            }
        });

        inputText.addEventListener('mouseleave', () => {
            if (premiumTooltip) premiumTooltip.style.display = 'none';
        });

        inputText.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
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
                // SAFARI FIX: Use overlay-relative coordinates instead of viewport coordinates.
                // In Safari Shadow DOM, e.clientX/Y may be offset from the expected position.
                const overlayRect = shadowRoot.host.getBoundingClientRect();
                const menuX = e.clientX - overlayRect.left;
                const menuY = e.clientY - overlayRect.top;
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
    }

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
            favoritesList.add(text);
            saveFavorites();
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
            finalizeProcessing(cachedNlpMatches, 0, 0, 0);
        }
        ctxMenu.style.display = 'none';
    });
}

// --- GLOBAL EVENT LISTENERS ---

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



