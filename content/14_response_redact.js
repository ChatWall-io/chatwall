/**
 * ChatWall - AI Firewall Extension
 *
 * @description Replace [TYPE_N] token placeholders in AI response text with
 *              interactive redacted pills. Hold (mousedown/touchstart) to reveal.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */
// --- RESPONSE TOKEN REDACTION ---

// ─── Per-type icon + colour ───────────────────────────────────────────────────
// Icons are small inline SVGs matching the full overlay's visual language.

const REDACT_TYPES = {
    // [bg, fg, border, icon-svg-inner, label]
    NAME: ['rgba(14,165,233,0.14)', '#7dd3fc', 'rgba(14,165,233,0.35)', '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', 'NAME'],
    ORG: ['rgba(14,165,233,0.14)', '#7dd3fc', 'rgba(14,165,233,0.35)', '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>', 'ORG'],
    EMAIL: ['rgba(249,115,22,0.14)', '#fdba74', 'rgba(249,115,22,0.35)', '<rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,4 12,13 2,4"/>', 'EMAIL'],
    PHONE: ['rgba(234,88,12,0.14)', '#fb923c', 'rgba(234,88,12,0.35)', '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.15 12 19.79 19.79 0 0 1 1.08 3.41 2 2 0 0 1 3.06 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21 16.92z"/>', 'PHONE'],
    CITY: ['rgba(239,68,68,0.14)', '#fca5a5', 'rgba(239,68,68,0.35)', '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>', 'CITY'],
    COUNTRY: ['rgba(239,68,68,0.14)', '#fca5a5', 'rgba(239,68,68,0.35)', '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>', 'COUNTRY'],
    LOC: ['rgba(239,68,68,0.14)', '#fca5a5', 'rgba(239,68,68,0.35)', '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>', 'LOC'],
    GPS: ['rgba(239,68,68,0.14)', '#fca5a5', 'rgba(239,68,68,0.35)', '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>', 'GPS'],
    POSTAL: ['rgba(239,68,68,0.14)', '#fca5a5', 'rgba(239,68,68,0.35)', '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>', 'POSTAL'],
    URL: ['rgba(6,182,212,0.14)', '#67e8f9', 'rgba(6,182,212,0.35)', '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>', 'URL'],
    PATH: ['rgba(6,182,212,0.14)', '#67e8f9', 'rgba(6,182,212,0.35)', '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>', 'PATH'],
    DATE: ['rgba(168,85,247,0.14)', '#d8b4fe', 'rgba(168,85,247,0.35)', '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>', 'DATE'],
    TIME: ['rgba(168,85,247,0.14)', '#d8b4fe', 'rgba(168,85,247,0.35)', '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', 'TIME'],
    MONEY: ['rgba(16,185,129,0.14)', '#6ee7b7', 'rgba(16,185,129,0.35)', '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>', 'MONEY'],
    AMOUNT: ['rgba(16,185,129,0.14)', '#6ee7b7', 'rgba(16,185,129,0.35)', '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>', 'AMOUNT'],
    SECRET: ['rgba(220,38,38,0.18)', '#fca5a5', 'rgba(220,38,38,0.40)', '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 'SECRET'],
    PIN: ['rgba(220,38,38,0.18)', '#fca5a5', 'rgba(220,38,38,0.40)', '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 'PIN'],
    KEY: ['rgba(220,38,38,0.18)', '#fca5a5', 'rgba(220,38,38,0.40)', '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>', 'KEY'],
    JWT: ['rgba(220,38,38,0.18)', '#fca5a5', 'rgba(220,38,38,0.40)', '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 'JWT'],
    AWS: ['rgba(220,38,38,0.18)', '#fca5a5', 'rgba(220,38,38,0.40)', '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 'AWS'],
    PASS: ['rgba(220,38,38,0.18)', '#fca5a5', 'rgba(220,38,38,0.40)', '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 'PASS'],
    PASSPORT: ['rgba(220,38,38,0.18)', '#fca5a5', 'rgba(220,38,38,0.40)', '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 'PASSPORT'],
    SSN: ['rgba(220,38,38,0.18)', '#fca5a5', 'rgba(220,38,38,0.40)', '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 'SSN'],
    IBAN: ['rgba(234,179,8,0.14)', '#fde68a', 'rgba(234,179,8,0.35)', '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>', 'IBAN'],
    CB: ['rgba(234,179,8,0.14)', '#fde68a', 'rgba(234,179,8,0.35)', '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>', 'CB'],
    CRYPTO: ['rgba(234,179,8,0.14)', '#fde68a', 'rgba(234,179,8,0.35)', '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>', 'CRYPTO'],
    VAT: ['rgba(234,179,8,0.14)', '#fde68a', 'rgba(234,179,8,0.35)', '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>', 'VAT'],
    EAN: ['rgba(234,179,8,0.14)', '#fde68a', 'rgba(234,179,8,0.35)', '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>', 'EAN'],
    BIC: ['rgba(234,179,8,0.14)', '#fde68a', 'rgba(234,179,8,0.35)', '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>', 'BIC'],
    VCS: ['rgba(234,179,8,0.14)', '#fde68a', 'rgba(234,179,8,0.35)', '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>', 'VCS'],
    UUID: ['rgba(99,102,241,0.14)', '#a5b4fc', 'rgba(99,102,241,0.35)', '<rect x="2" y="2" width="20" height="20" rx="2"/><path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01"/>', 'UUID'],
    ID: ['rgba(99,102,241,0.14)', '#a5b4fc', 'rgba(99,102,241,0.35)', '<rect x="2" y="2" width="20" height="20" rx="2"/><path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01"/>', 'ID'],
    VIN: ['rgba(99,102,241,0.14)', '#a5b4fc', 'rgba(99,102,241,0.35)', '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>', 'VIN'],
    IP: ['rgba(14,165,233,0.12)', '#7dd3fc', 'rgba(14,165,233,0.28)', '<rect x="2" y="2" width="20" height="20" rx="2"/><path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01"/>', 'IP'],
    MAC: ['rgba(14,165,233,0.12)', '#7dd3fc', 'rgba(14,165,233,0.28)', '<rect x="2" y="2" width="20" height="20" rx="2"/><path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01"/>', 'MAC'],
    CUSTOM: ['rgba(148,163,184,0.14)', '#e2e8f0', 'rgba(148,163,184,0.35)', '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>', 'CUSTOM'],
    FAVORITE: ['rgba(250,204,21,0.14)', '#fde68a', 'rgba(250,204,21,0.35)', '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>', 'FAV'],
};
const REDACT_DEFAULT_COLORS = ['rgba(99,102,241,0.12)', '#a5b4fc', 'rgba(99,102,241,0.28)',
    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>', 'TOKEN'];

const REDACT_ATTR = 'data-cw-redact';
const REDACT_TOKEN_RE = () => /\[([A-Z_]+)_([A-Z0-9]+)\]/g;

// ─── Pill factory (each pill = closed shadow DOM) ────────────────────────────

function makePill(type, original, tokenKey) {
    const def = REDACT_TYPES[type] || REDACT_DEFAULT_COLORS;
    const [bg, fg, border, svgInner, label] = def;

    const host = document.createElement('span');
    host.setAttribute(REDACT_ATTR, '1');
    host.setAttribute('data-cw-orig', original);   // readable outside the closed shadow
    // Force inline regardless of any page CSS
    host.style.setProperty('display', 'inline', 'important');
    host.style.setProperty('white-space', 'normal', 'important');
    host.title = `ChatWall — hold to reveal (${type})`;

    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
        :host { display: inline; }
        #pill {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            border-radius: 5px;
            padding: 1px 6px 1px 4px;
            font-size: 0.78em;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-weight: 700;
            letter-spacing: 0.2px;
            cursor: pointer;
            user-select: none;
            vertical-align: middle;
            position: relative;
            top: -0.5px;
            white-space: nowrap;
            background: ${bg};
            color: ${fg};
            border: 1px solid ${border};
            transition: filter 0.12s;
        }
        #pill:hover { filter: brightness(1.18); }
        svg { flex-shrink:0; }
        /* Hold-to-peek: temporarily revealed while mouse is held */
        #pill.revealed {
            background: rgba(34,197,94,0.12);
            color: #86efac;
            border-color: rgba(34,197,94,0.35);
            font-family: inherit;
            font-size: 0.88em;
            font-weight: 600;
            letter-spacing: 0.01em;
        }
        #pill.revealed svg { display: none; }
        #pill.revealed #lbl { display: none; }
        #orig { display: none; }
        #pill.revealed #orig { display: inline; }
        /* Permanent preview via .cw-revealed on the host element (set by extension).
           Host page JS cannot read shadow content since mode:'closed'. */
        :host(.cw-revealed) #pill {
            background: rgba(34,197,94,0.12);
            color: #86efac;
            border-color: rgba(34,197,94,0.35);
            font-family: inherit;
            font-size: 0.88em;
            font-weight: 600;
            letter-spacing: 0.01em;
            cursor: default;
        }
        :host(.cw-revealed) #pill:hover { filter: none; }
        :host(.cw-revealed) svg { display: none; }
        :host(.cw-revealed) #lbl { display: none; }
        :host(.cw-revealed) #orig { display: inline; }
    `;

    const pill = document.createElement('span');
    pill.id = 'pill';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '10');
    svg.setAttribute('height', '10');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML = svgInner;

    const lbl = document.createElement('span');
    lbl.id = 'lbl';
    lbl.textContent = tokenKey || label;

    const orig = document.createElement('span');
    orig.id = 'orig';
    orig.textContent = original;

    pill.appendChild(svg);
    pill.appendChild(lbl);
    pill.appendChild(orig);
    shadow.appendChild(style);
    shadow.appendChild(pill);

    // ── Hold-to-reveal: show while pressed, hide on release ──────────────────
    function reveal() {
        pill.classList.add('revealed');
        host.title = 'Release to hide';
    }
    function hide() {
        pill.classList.remove('revealed');
        host.title = `ChatWall — hold to reveal (${type})`;
    }

    host.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); reveal(); });
    host.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); reveal(); }, { passive: false });
    host.addEventListener('mouseup', (e) => { e.stopPropagation(); hide(); });
    host.addEventListener('mouseleave', () => hide());
    host.addEventListener('touchend', (e) => { e.stopPropagation(); hide(); });
    host.addEventListener('touchcancel', () => hide());
    // Prevent page text selection while holding
    host.addEventListener('dragstart', (e) => e.preventDefault());

    return host;
}

// ─── DOM processing ───────────────────────────────────────────────────────────

function shouldSkipNode(el) {
    if (!el) return true;
    const t = el.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SCRIPT' || t === 'STYLE') return true;
    if (el.isContentEditable) return true;
    if (el.hasAttribute && el.hasAttribute(REDACT_ATTR)) return true;
    if (el.id === 'cw-input-overlay-host') return true;
    // Never scan #cwio-out (hidden output sink for integrated overlay masking).
    // finalizeProcessing writes raw [TOKEN] text there; converting them to shadow
    // pills would make textContent empty, breaking sendMasked's text read.
    if (el.id === 'cwio-out') return true;
    return false;
}

/** Collect all matching text nodes under root — sync, no DOM mutations. */
function collectNodes(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return [];
    if (shouldSkipNode(root)) return [];

    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            let p = node.parentElement;
            while (p) {
                if (shouldSkipNode(p)) return NodeFilter.FILTER_REJECT;
                p = p.parentElement;
            }
            return REDACT_TOKEN_RE().test(node.textContent)
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_SKIP;
        }
    });
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
}

/**
 * Collect nodes sync → single await for tokenMap → flush DOM mutations sync.
 * This avoids the race condition where ChatGPT's streamer replaces the text
 * node between our await and the replaceChild call.
 */
async function processBatch(nodes) {
    if (!nodes.length) return;

    let tokenMap = {};
    try { tokenMap = await getTokenMap(); } catch (_) { }

    for (const textNode of nodes) {
        if (!textNode.isConnected) continue;          // streamer already replaced it
        const text = textNode.textContent;
        if (!REDACT_TOKEN_RE().test(text)) continue;   // no longer matches after await

        const parent = textNode.parentNode;
        if (!parent) continue;

        const frag = document.createDocumentFragment();
        const re = REDACT_TOKEN_RE();
        let lastIdx = 0, m;

        while ((m = re.exec(text)) !== null) {
            if (m.index > lastIdx)
                frag.appendChild(document.createTextNode(text.slice(lastIdx, m.index)));
            frag.appendChild(makePill(m[1], tokenMap[m[0]] || m[0], m[0]));
            lastIdx = m.index + m[0].length;
        }
        if (lastIdx < text.length)
            frag.appendChild(document.createTextNode(text.slice(lastIdx)));

        try { parent.replaceChild(frag, textNode); } catch (_) { /* already gone */ }
    }
}

// ─── Observer — debounced so we only fire after streaming stops ───────────────

const REDACT_DEBOUNCE_MS = 1000;          // wait 1 s after last DOM change
const pendingRoots = new Set();     // parent elements awaiting re-scan
let debounceTimer = null;
let redactObserver = null;

/** Queue a root element for delayed re-scan. Resets the debounce timer. */
function scheduleRedact(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    pendingRoots.add(el);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        const roots = [...pendingRoots];
        pendingRoots.clear();
        // Re-collect from roots now that streaming has settled
        const nodes = roots
            .filter(r => r.isConnected)
            .flatMap(r => collectNodes(r));
        if (nodes.length) processBatch(nodes);
    }, REDACT_DEBOUNCE_MS);
}

/**
 * Immediately (no debounce) convert any raw [TOKEN] text nodes in `container`
 * to pills. Called before Unmask & Preview so pills exist to be revealed.
 */
async function forceRedactContainer(container) {
    if (!container) return;
    const nodes = collectNodes(container);
    if (nodes.length) await processBatch(nodes);
}


function startObserver() {
    if (redactObserver) return;

    // Initial scan — also debounced so any page boot animations settle first
    scheduleRedact(document.body);

    redactObserver = new MutationObserver(mutations => {
        for (const mut of mutations) {
            if (mut.type === 'childList') {
                for (const node of mut.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Queue the new element itself
                        scheduleRedact(node);
                    } else if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
                        // Queue parent so we re-scan the full text run
                        scheduleRedact(node.parentElement);
                    }
                }
            } else if (mut.type === 'characterData' && mut.target.parentElement) {
                scheduleRedact(mut.target.parentElement);
            }
        }
    });

    redactObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
} else {
    setTimeout(startObserver, 300);
}
