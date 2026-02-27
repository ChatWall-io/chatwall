/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */


// --- CONFIGURATION ---
try { if (typeof importScripts === 'function') importScripts('config.js'); } catch (e) { console.warn("config.js not found (OK in tests)"); }

const API_BASE_URL = (typeof ChatWallConfig !== 'undefined') ? ChatWallConfig.API_URL : "http://localhost:3000";
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 Hours

// Safari Detection (background/service worker context)
const IS_SAFARI_BG = (typeof browser !== 'undefined' && typeof browser.runtime !== 'undefined'
    && typeof browser.runtime.getURL === 'function' && browser.runtime.getURL('').startsWith('safari'));
const SAFARI_APP_ID = (typeof ChatWallConfig !== 'undefined' && ChatWallConfig.SAFARI_APP_ID)
    ? ChatWallConfig.SAFARI_APP_ID : 'io.chatwall.ChatWall.Extension';

// --- MEMORY STORE ---
let BG_TOKEN_MAP = {};
let BG_COUNTERS = {
    NAME: 0, LOC: 0, ORG: 0, EMAIL: 0, PHONE: 0, URL: 0,
    IBAN: 0, CB: 0, CRYPTO: 0, IP: 0, ID: 0, PASSPORT: 0,
    SSN: 0, DATE: 0, TIME: 0, SECRET: 0, MONEY: 0, PIN: 0,
    UUID: 0, MAC: 0, KEY: 0, VAT: 0, POSTAL: 0, BIC: 0,
    EAN: 0, VCS: 0, VIN: 0, CUSTOM: 0, FAVORITE: 0
};
let BG_COUNTERS_LOADED = false;

// Initialize Counters from Persistent Storage (to prevent collisions)
chrome.storage.local.get(['chatwall_global_counters'], (result) => {
    if (result.chatwall_global_counters) {
        BG_COUNTERS = { ...BG_COUNTERS, ...result.chatwall_global_counters };
    }
    BG_COUNTERS_LOADED = true;
});

let BG_TOKENS_LOADED = false;
// Initialize Tokens from Session Storage (Ephemeral but survives SW restart)
if (chrome.storage && chrome.storage.session) {
    chrome.storage.session.get(['chatwall_token_map'], (result) => {
        if (result.chatwall_token_map) {
            BG_TOKEN_MAP = { ...BG_TOKEN_MAP, ...result.chatwall_token_map };
        }
        BG_TOKENS_LOADED = true;
    });
} else {
    // Fallback if session storage not available
    BG_TOKENS_LOADED = true;
}

// Enable Session Storage access for Content Scripts
if (chrome.storage && chrome.storage.session && chrome.storage.session.setAccessLevel) {
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
}

// --- 1. NLP ENGINE IMPORTS ---
if (typeof importScripts === 'function') {
    importScripts(

        'detectors/_data/first_names_data.js',
        'detectors/_data/last_names_data.js',
        'detectors/_data/common_names_data.js',
        'detectors/_data/common_cities_data.js',
        'detectors/_data/cities_data.js',
        'detectors/_data/country.js',

        // Core
        'detectors/detector.js',

        // Granular Detectors
        'detectors/email.js',
        'detectors/net/url.js',
        'detectors/net/ip.js',
        'detectors/net/mac.js',
        'detectors/net/path.js',

        'detectors/bank/amount.js',
        'detectors/bank/iban.js',
        'detectors/bank/cb.js',
        'detectors/bank/crypto.js',
        'detectors/secret/jwt.js',

        'detectors/secret/pin.js',
        'detectors/secret/pass.js',
        'detectors/secret/key.js',
        'detectors/bank/cvv.js',
        'detectors/secret/secret.js',

        'detectors/net/uuid.js',
        'detectors/id/passport.js',
        'detectors/id/plate.js',
        'detectors/id/ssn.js',
        'detectors/id/vat.js',
        'detectors/bank/bic.js',
        'detectors/bank/vcs.js',
        'detectors/id/id.js',
        'detectors/id/vin.js',

        'detectors/geo/city.js',
        'detectors/geo/country.js',
        'detectors/geo/gps.js',
        'detectors/geo/postal.js',

        'detectors/datetime/date.js',
        'detectors/datetime/time.js',

        'detectors/name.js',
        'detectors/phone.js'
    );
}

// Instantiate All Detectors
const DETECTORS = [
    new EmailDetector(),
    new UrlDetector(),
    new IpDetector(),
    new MacDetector(),
    new PathDetector(),

    new AmountDetector(),
    new IbanDetector(),
    new CbDetector(),
    new CryptoDetector(),

    new JwtDetector(),
    new PinDetector(),
    new PassDetector(),
    new KeyDetector(),
    new CvvDetector(),
    new SecretDetector(),

    new UuidDetector(),
    new PassportDetector(),
    new PlateDetector(),
    new SsnDetector(),
    new VatDetector(),
    new BicDetector(),
    new VcsDetector(),
    new IdDetector(),
    new VinDetector(),

    new CountryDetector(),
    new CityDetector(),
    new GpsDetector(),
    new PostalDetector(),

    new DateDetector(),
    new TimeDetector(),

    new NameDetector(),
    new PhoneDetector()
];

// ====================================
// 2. DEVICE ID & LICENSE 
// ====================================

async function getDeviceId() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['chatwall_device_id'], (result) => {
            if (result.chatwall_device_id) {
                resolve(result.chatwall_device_id);
            } else {
                const newId = `DEV-${crypto.randomUUID().toUpperCase()}`;
                chrome.storage.local.set({ chatwall_device_id: newId }, () => {
                    resolve(newId);
                });
            }
        });
    });
}

let _isValidating = false;
let _validationPromise = null;

async function validateLicense(explicitDeviceId = null) {
    // Guard: prevent re-entrant/concurrent calls
    if (_isValidating) {
        console.warn("ChatWall: validateLicense already running, waiting...");
        if (_validationPromise) return _validationPromise;
        return { plan: 'FREE', status: 'BUSY' };
    }
    _isValidating = true;

    // Safety timeout: auto-release lock after 10 seconds
    const safetyTimer = setTimeout(() => {
        console.warn("ChatWall: validateLicense safety timeout reached");
        _isValidating = false;
        _validationPromise = null;
    }, 10000);

    _validationPromise = _validateLicenseInner(explicitDeviceId).finally(() => {
        clearTimeout(safetyTimer);
        _isValidating = false;
        _validationPromise = null;
    });

    return _validationPromise;
}

async function _validateLicenseInner(explicitDeviceId = null) {
    // Safari: Skip API license validation — premium status comes from native IAP
    if (IS_SAFARI_BG) {
        return new Promise((resolve) => {
            if (chrome.runtime.sendNativeMessage) {
                chrome.runtime.sendNativeMessage(SAFARI_APP_ID, { action: 'check_premium_status' }, (response) => {
                    if (chrome.runtime.lastError || !response || !response.isPremium) {
                        resolve({ plan: 'FREE', status: 'SAFARI_IAP_FREE' });
                    } else {
                        updatePlanStorage('PREMIUM', null);
                        resolve({ plan: 'PREMIUM', status: 'SAFARI_IAP_VALID' });
                    }
                });
            } else {
                resolve({ plan: 'FREE', status: 'SAFARI_NO_NATIVE' });
            }
        });
    }

    const deviceId = explicitDeviceId || await getDeviceId();
    let isDev = false;
    if (chrome.management && chrome.management.getSelf) {
        try {
            const selfInfo = await new Promise(r => chrome.management.getSelf(r));
            isDev = (selfInfo.installType === 'development');
        } catch (e) {
            console.warn("Skipping management check", e);
        }
    }

    if (isDev) {
        const isLicenseCheckEnabled = (typeof ChatWallConfig === 'undefined' || ChatWallConfig.ENABLE_DEV_LICENSE_CHECK !== false);
        if (!isLicenseCheckEnabled) {
            console.log("ChatWall: Dev Mode Detected - Granting Free Premium");
            await updatePlanStorage('PREMIUM', "DEV-FINGERPRINT");
            return { plan: 'PREMIUM', status: 'VALID_DEV' };
        }
    }

    return new Promise((resolve) => {
        chrome.storage.local.get(['chatwall_email', 'chatwall_license_key', 'chatwall_user_plan', 'chatwall_last_online_check'], async (data) => {
            const email = data.chatwall_email;
            const key = data.chatwall_license_key;
            const currentPlan = data.chatwall_user_plan || 'FREE';

            if (!explicitDeviceId && currentPlan === 'FREE') {
                resolve({ plan: 'FREE', status: 'SKIPPED_FREE' });
                return;
            }

            if (!email || !key) {
                if (currentPlan !== 'FREE') await updatePlanStorage('FREE', null);
                resolve({ plan: 'FREE', status: 'NO_AUTH' });
                return;
            }

            try {
                const response = await fetch(`${API_BASE_URL}/api/verify-license`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, licenseKey: key, deviceId })
                });

                const result = await response.json();

                if (result.status === 'VALID' || result.status === 'VIP') {
                    await chrome.storage.local.set({
                        chatwall_email: email,
                        chatwall_license_key: key,
                        chatwall_id: result.id,
                        chatwall_last_online_check: Date.now()
                    });
                    await updatePlanStorage(result.plan, deviceId);
                    resolve({ plan: result.plan, status: 'VALID' });
                } else {
                    await updatePlanStorage('FREE', null);
                    resolve({ plan: 'FREE', status: result.status, message: result.message });
                }

            } catch (error) {
                const lastCheck = data.chatwall_last_online_check || 0;
                const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
                const isExpired = (Date.now() - lastCheck) > GRACE_PERIOD_MS;

                if (isExpired && currentPlan !== 'FREE') {
                    console.warn("ChatWall: Offline Grace Period Expired. Downgrading to FREE.");
                    await updatePlanStorage('FREE', null);
                    resolve({ plan: 'FREE', status: 'GRACE_EXPIRED', message: "License validation required" });
                } else {
                    console.warn("ChatWall: Network error, using cached plan (In Grace Period)", error);
                    resolve({ plan: currentPlan, status: 'NETWORK_ERROR', message: error.message });
                }
            }
        });
    });
}

async function updatePlanStorage(newPlan, validatedFingerprint) {
    const data = await chrome.storage.local.get(['chatwall_user_plan']);
    const oldPlan = data.chatwall_user_plan || 'FREE';
    const updates = { 'chatwall_user_plan': newPlan };
    if (validatedFingerprint) updates['chatwall_device_id'] = validatedFingerprint;
    await chrome.storage.local.set(updates);
    if (oldPlan !== newPlan) updateTabsPlan(newPlan, newPlan === 'FREE' && oldPlan !== 'FREE');
}

function updateTabsPlan(plan, alertUser) {
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { action: 'UPDATE_PLAN', plan, alertUser }).catch(() => { });
        });
    });
}

// ============================================================
// 4. EVENTS
// ============================================================

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        chrome.tabs.create({ url: "https://chatwall.io/support.html" });
    }

    validateLicense().then(() => {
        chrome.storage.local.set({ 'chatwall_last_check': Date.now() });
    });

    chrome.alarms.create('check_license_daily', { periodInMinutes: 1440 });

    // Create Context Menus
    chrome.contextMenus.create({
        id: "cw_parent",
        title: "ChatWall",
        contexts: ["all"]
    });

    chrome.contextMenus.create({
        id: "cw_docs",
        parentId: "cw_parent",
        title: chrome.i18n.getMessage("ctx_read_docs"),
        contexts: ["all"]
    });

    chrome.contextMenus.create({
        id: "cw_separator_docs",
        parentId: "cw_parent",
        type: "separator",
        contexts: ["all"]
    });

    chrome.contextMenus.create({
        id: "cw_use_chatwall",
        parentId: "cw_parent",
        title: "Use ChatWall",
        contexts: ["all"]
    });

    chrome.contextMenus.create({
        id: "cw_configure_chatwall",
        parentId: "cw_parent",
        title: "Configure ChatWall",
        contexts: ["all"]
    });

    chrome.contextMenus.create({
        id: "cw_separator",
        parentId: "cw_parent",
        type: "separator",
        contexts: ["all"]
    });

    chrome.contextMenus.create({
        id: "cw_unmask_preview",
        parentId: "cw_parent",
        title: "Unmask",
        contexts: ["all"]
    });

    chrome.contextMenus.create({
        id: "cw_unmask_copy",
        parentId: "cw_parent",
        title: "Unmask and Copy",
        contexts: ["all"]
    });
});

chrome.runtime.onStartup.addListener(() => {
    validateLicense().then(() => {
        chrome.storage.local.set({ 'chatwall_last_check': Date.now() });
    });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'check_license_daily') {
        validateLicense().then(() => {
            chrome.storage.local.set({ 'chatwall_last_check': Date.now() });
        });
    }
});

chrome.action.onClicked.addListener((tab) => {
    chrome.tabs.create({ url: "https://chatwall.io/support.html#docs" });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "cw_docs") {
        chrome.tabs.create({ url: "https://chatwall.io/support.html#docs" });
    } else if (info.menuItemId === "cw_unmask_preview") {
        chrome.tabs.sendMessage(tab.id, { action: 'CTX_UNMASK_PREVIEW', selectionText: info.selectionText });
    } else if (info.menuItemId === "cw_unmask_copy") {
        chrome.tabs.sendMessage(tab.id, { action: 'CTX_UNMASK_COPY', selectionText: info.selectionText });
    } else if (info.menuItemId === "cw_use_chatwall") {
        chrome.tabs.create({ url: "https://chatwall.io/support.html#docs" });
    } else if (info.menuItemId === "cw_configure_chatwall") {
        chrome.tabs.sendMessage(tab.id, { action: 'SHOW_OVERLAY' }, (response) => {
            if (chrome.runtime.lastError) {
                chrome.tabs.create({ url: "https://chatwall.io/support.html#docs" });
            }
        });
    }
});


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'ANALYZE_TEXT') {
        const { text, offset } = request;
        let matches = [];

        try {
            // Honorific context regex for NAME > CITY boost (shared from name.js)

            // Priority function (context-aware for NAME)
            const getPriority = (matchObj) => {
                const PRIORITY = {
                    'IBAN': 115, 'CB': 110, 'EMAIL': 105, 'URL': 105,
                    'CVV': 100,
                    'VIN': 98, 'IP': 98, 'MAC': 98, 'PATH': 98,
                    'UUID': 95,
                    'VCS': 90, 'PASSPORT': 90, 'SSN': 90, 'VAT': 90, 'BIC': 90, 'PLATE': 90,
                    'COUNTRY': 89,
                    'GPS': 87,
                    'DATE': 86, 'TIME': 86, 'AMOUNT': 86,
                    'PHONE': 85,
                    'SECRET': 84, 'KEY': 84, 'PASSWORD': 84, 'PIN': 84, 'JWT': 84, 'AWS': 84, 'CRYPTO': 84,
                    'ID': 83,
                    'CITY': 82,
                    'NAME': 80,
                    'POSTAL': 60
                };
                const base = PRIORITY[matchObj.type] || 30;
                // Contextual NAME boost: 80 -> 85 (above CITY 84)
                if (matchObj.type === 'NAME' && matchObj.hasNameContext) return 85;
                return base;
            };

            // Run all detectors
            DETECTORS.forEach(detector => {
                const results = detector.scan(text);
                results.forEach(m => {
                    // Check Overlaps
                    const mStart = m.start + offset;
                    const mEnd = m.end + offset;

                    const overlapIndex = matches.findIndex(ex => (mStart < ex.end && mEnd > ex.start));
                    if (overlapIndex !== -1) {
                        // Conflict Resolution: Priority > Length
                        const existing = matches[overlapIndex];

                        // Check honorific prefix context for NAME matches
                        let hasContext = false;
                        if (m.type === 'NAME' && m.start > 0) {
                            const prefixWindow = text.substring(Math.max(0, m.start - 20), m.start);
                            if (HONORIFIC_RE.test(prefixWindow)) hasContext = true;
                        }

                        const newMatch = {
                            text: m.text, type: m.type,
                            start: mStart, end: mEnd, isNLP: true,
                            hasNameContext: hasContext
                        };

                        // Also check adjacent NAME for context
                        if (m.type === 'NAME' && !hasContext) {
                            for (const other of matches) {
                                if (other.type !== 'NAME') continue;
                                if (other.end >= mStart - 2 && other.end <= mStart) { newMatch.hasNameContext = true; break; }
                                if (other.start >= mEnd && other.start <= mEnd + 2) { newMatch.hasNameContext = true; break; }
                            }
                        }

                        const pNew = getPriority(newMatch);
                        const pOld = getPriority(existing);

                        if (pNew > pOld) {
                            // New is stronger type -> Replace
                            matches[overlapIndex] = newMatch;
                        } else if (pNew === pOld) {
                            // Same priority -> Longer Wins
                            if (m.text.length > existing.text.length) {
                                matches[overlapIndex] = newMatch;
                            }
                        }
                        // Else (pNew < pOld): Keep existing (e.g. Keep Country, reject Person)
                    } else {
                        // Check honorific prefix context for standalone NAME matches too
                        let hasContext = false;
                        if (m.type === 'NAME' && m.start > 0) {
                            const prefixWindow = text.substring(Math.max(0, m.start - 20), m.start);
                            if (HONORIFIC_RE.test(prefixWindow)) hasContext = true;
                        }
                        matches.push({
                            text: m.text, type: m.type,
                            start: mStart, end: mEnd, isNLP: true,
                            hasNameContext: hasContext
                        });
                    }
                });
            });

        } catch (err) { console.error("NLP Error", err); }
        sendResponse({ matches: matches });
        return true; // async
    }

    // --- SAFARI IAP ACTIONS ---
    else if (request.action === 'START_PURCHASE') {
        if (chrome.runtime.sendNativeMessage) {
            chrome.runtime.sendNativeMessage(SAFARI_APP_ID, { action: 'purchase_premium' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('ChatWall: Native purchase error:', chrome.runtime.lastError);
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    return;
                }
                sendResponse(response || { status: 'opening_app' });
            });
        } else {
            sendResponse({ success: false, error: 'Native messaging not available' });
        }
        return true;
    }

    else if (request.action === 'CHECK_PREMIUM_STATUS') {
        if (chrome.runtime.sendNativeMessage) {
            chrome.runtime.sendNativeMessage(SAFARI_APP_ID, { action: 'check_premium_status' }, (response) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ isPremium: false });
                    return;
                }
                if (response && response.isPremium) {
                    updatePlanStorage('PREMIUM', null);
                }
                sendResponse(response || { isPremium: false });
            });
        } else {
            sendResponse({ isPremium: false });
        }
        return true;
    }

    // --- SETTINGS ACTIONS ---
    else if (request.action === 'CHECK_LICENSE_API') {
        getDeviceId().then(originalId => {
            chrome.storage.local.set({
                'chatwall_email': request.email,
                'chatwall_license_key': request.licenseKey || request.key,
                'chatwall_device_id': originalId
            }, () => {
                validateLicense(originalId).then((result) => {
                    if (result.status === 'VALID') {
                        chrome.storage.local.set({ 'chatwall_last_check': Date.now() });
                    }
                    sendResponse(result);
                }).catch(err => {
                    console.error("License Check Error", err);
                    sendResponse({ status: 'ERROR', message: err.message || "Unknown error" });
                });
            });
        });
        return true;
    }

    else if (request.action === 'BG_GET_STATE') {
        const waitForStorage = new Promise(resolve => {
            if (BG_COUNTERS_LOADED && BG_TOKENS_LOADED) resolve();
            else {
                const check = setInterval(() => {
                    if (BG_COUNTERS_LOADED && BG_TOKENS_LOADED) { clearInterval(check); resolve(); }
                }, 50);
            }
        });

        waitForStorage.then(() => {
            sendResponse({
                tokens: BG_TOKEN_MAP,
                counters: BG_COUNTERS
            });
        });
        return true;
    }
    else if (request.action === 'BG_SYNC_STATE') {
        const { tokens, counters } = request;

        // SAFE MERGE: Tokens (RAM Only - Transient)
        if (tokens) {
            BG_TOKEN_MAP = { ...BG_TOKEN_MAP, ...tokens };
            if (chrome.storage && chrome.storage.session) {
                chrome.storage.session.set({ 'chatwall_token_map': BG_TOKEN_MAP });
            }
        }

        // SAFE MERGE: Counters (Persistent)
        if (counters) {
            let countersChanged = false;
            for (const key in counters) {
                const newVal = Math.max(BG_COUNTERS[key] || 0, counters[key] || 0);
                if (newVal !== BG_COUNTERS[key]) {
                    BG_COUNTERS[key] = newVal;
                    countersChanged = true;
                }
            }

            for (const key in counters) {
                if (BG_COUNTERS[key] === undefined) {
                    BG_COUNTERS[key] = counters[key];
                    countersChanged = true;
                }
            }

            if (countersChanged) {
                chrome.storage.local.set({ 'chatwall_global_counters': BG_COUNTERS });
            }
        }

        sendResponse({ success: true, tokens: BG_TOKEN_MAP, counters: BG_COUNTERS });
        return true;
    }

    return false;
});