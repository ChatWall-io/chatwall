/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

const CONFIG_API_URL = (typeof ChatWallConfig !== 'undefined') ? ChatWallConfig.API_URL : "http://localhost:3000";

// --- GLOBALS & STATE ---
let USER_PLAN = 'FREE';
let CLIENT_ID = '';
let overlayContainer = null;
let shadowRoot = null;
let isStorageLoaded = false;

const NLP_CONTEXT_WINDOW = 50000;
const NLP_SCROLL_CONTEXT = 8000; // Smaller window for scroll-triggered scans (fast, matches accumulate)

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
let cachedLockedTokens = null; // Locked Tokens Cache (per overlay session)
let cachedTokenPairs = []; // For Scroll Sync Optimization

// Cached Overlay DOM Elements (populated once in initOverlayEvents)
let elInputText = null;
let elOutputText = null;
let elInputHighlights = null;
let lastRenderFingerprint = ""; // Skip re-render if matches unchanged
let cachedLocalMatches = null; // Cached local regex results (manualBlockList + favoritesList)
let cachedLocalMatchesTextKey = ""; // Text identity key for local match cache
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

// --- INPUT MODE & MINI-OVERLAY STATE ---
let cwInputMode = 'float';           // 'float' | 'integrated'  (loaded from storage)
let cwModeMenuEl = null;             // The top-right mode-switcher widget element
let inputOverlayContainer = null;    // The absolute host div placed over the native input
let inputOverlayShadowRoot = null;   // Its closed shadow root
let inputOverlayNativeEl = null;     // The original native input element being covered
let inputOverlayInputText = null;    // Cached #cwio-textarea ref
let inputOverlayHighlights = null;   // Cached #cwio-highlights ref
let inputOverlayMatches = [];        // Active matches for the mini-overlay session
let inputOverlayActiveTool = null;   // 'mask' | 'unmask' | null

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
