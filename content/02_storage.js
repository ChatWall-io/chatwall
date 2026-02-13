/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */
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
