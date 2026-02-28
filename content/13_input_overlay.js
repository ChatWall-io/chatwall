/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */
// --- INPUT OVERLAY (Integrated Mode) ---
// Lightweight Shadow DOM editor that sits on top of the chat's native input.

// ─── Module State ────────────────────────────────────────────────────────────

let inputOverlayTargetObserver = null;
let inputOverlayScrollCleanup = null;
let inputOverlayIsOpen = false;
let inputOverlayBackdrop = null;  // full-screen modal backdrop
let inputOverlayTypingTimer = null;
let lockedMinHeight = 0;          // floor: original native textarea height at open
let nativeOriginalContent = ''; // native content before newline injection
let syncingNative = false;   // guard against ResizeObserver feedback loops
let nativeMaxHeight = 0;          // detected native ceiling via real CSS max (0 = still can grow)
let nativeResists = false;        // true when native element refuses growth (snap-back e.g. Claude)
let userResizedHeight = 0;        // >0 when user has manually dragged the resize handle
let userResizedWidth = 0;         // >0 when user has manually dragged the resize handle
let refreshFavBtnFn = null;       // set when overlay is built; called on plan change to undim ⭐ btn
let _pendingSeedText = null;      // seed text waiting for shadow DOM to be ready (first-open race)
// inputOverlayOutputText: hidden #cwio-out — finalizeProcessing writes masked tokens here
// (other overlay refs declared in 01_variables.js)
let inputOverlayOutputText = null;

// ─── Token → Original resolver ───────────────────────────────────────────────
/**
 * If the native input already contains masked tokens like [NAME_1], resolve
 * them back to the original text so the overlay shows the real content.
 */
async function unmaskTokens(text) {
    if (!text || !text.match(/\[[A-Z]+_[A-Z0-9]+\]/)) return text;
    try {
        const tokenMap = await getTokenMap();
        // Restore CUSTOM words so the overlay re-highlights them after unmask
        const tokenRe = /\[([A-Z_]+)_([A-Z0-9]+)\]/g;
        let m;
        while ((m = tokenRe.exec(text)) !== null) {
            const fullToken = m[0];
            const type = m[1];
            const original = tokenMap[fullToken];
            if (original && type === 'CUSTOM') {
                inputCustomWords.add(original);
            }
        }
        return text.replace(/\[[A-Z]+_[A-Z0-9]+\]/g, tok => tokenMap[tok] || tok);
    } catch (_) { return text; }
}
let overlayOpenTime = 0;

// ─── Re-open badge state ─────────────────────────────────────────────────────
// When the overlay closes while native has content, a small pill badge appears
// near the native input so the user can re-open the overlay on demand.
let reopenBadge = null;
let reopenBadgeNative = null;
let reopenBadgeScrollFn = null;  // passive scroll listener — repositions badge
let reopenBadgeInputFn = null;  // unused
let reopenBadgeResizeObs = null;  // ResizeObserver — repositions on input resize
let reopenBadgeRafId = null;  // unused (kept for cancelAnimationFrame safety)
let reopenBadgeMutObs = null;  // MutationObserver — detects framework-driven clears
let reopenBadgeScrollAncestors = [];  // scrollable ancestor elements also listened to
let reopenBadgeSyncInterval = null;   // interval that continuously syncs badge position
/** Set to true by the re-open badge click to bypass the "native has content" guard. */
let forceOverlayOpen = false;
/** Always-On mode: open the overlay automatically on input focus (no badge click needed). */
let intAlwaysOn = false;

// Load Always-On state from storage (false by default)
chrome.storage.local.get('cwIntAlwaysOn', (r) => {
    intAlwaysOn = !!r.cwIntAlwaysOn;
});

// Per-session custom masking state
// (reset each time the overlay opens)
let inputCustomWords = new Set();  // words the user manually masked
let inputIgnoredWords = new Set();  // words the user manually unmasked (suppress NLP hits)

// ─── Plan helpers ─────────────────────────────────────────────────────────────

/** Types available on the FREE plan. Must stay in sync with ENTITY_TIERS.FREE. */
const INPUT_FREE_TYPES = new Set([
    'NAME', 'EMAIL', 'PHONE', 'LOC', 'POSTAL', 'GPS',
    'DATE', 'TIME', 'URL', 'CUSTOM', 'CITY', 'COUNTRY'
]);

function isFreeType(type) {
    return INPUT_FREE_TYPES.has((type || '').toUpperCase());
}

const TOPBAR_HEIGHT = 30;  // px — matches CSS min-height of #cwio-topbar

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderRaw(hl, text) {
    if (!hl) return;
    hl.textContent = text;
    if (text.endsWith('\n')) hl.appendChild(document.createTextNode('\u00a0'));
}

/** Update free-tier warning strip after a scan settles. Uses shared currentMatches. */
function updateWarnBar() {
    if (!inputOverlayShadowRoot) return;
    const warnBar = inputOverlayShadowRoot.getElementById('cwio-warn');
    if (warnBar) warnBar.classList.toggle('visible', (currentMatches || []).some(m => m.isLocked));
}


// ─── Sync native input height to stay above overlay ─────────────────────────
/**
 * Inject enough blank lines into the (hidden) native input so that its rendered
 * height is always at least `targetH + 20` px — keeping the host chat input
 * visually taller than the integrated overlay, even as the overlay grows.
 */
function syncNativeHeight(targetH) {
    if (syncingNative || !inputOverlayNativeEl || !inputOverlayIsOpen) return;
    const nativeRect = inputOverlayNativeEl.getBoundingClientRect();


    // Hard stop 2: native bottom already at viewport edge — injecting more would
    // push content off-screen. Lock ceiling and let the overlay scroll instead.
    const VIEWPORT_MARGIN = 16;
    if (nativeRect.bottom >= window.innerHeight - VIEWPORT_MARGIN) {
        nativeMaxHeight = nativeRect.height;
        return;
    }

    if (nativeRect.height >= targetH + 4) return; // already tall enough — nothing to do

    syncingNative = true;
    const heightBefore = nativeRect.height;
    try {
        const lineH = Math.max(parseFloat(getComputedStyle(inputOverlayNativeEl).lineHeight) || 20, 16);
        const extraLines = Math.ceil((targetH + 24) / lineH) + 1;
        const injected = nativeOriginalContent + '\n'.repeat(extraLines);
        if (typeof inputOverlayNativeEl.value === 'string') {
            inputOverlayNativeEl.value = injected;
        } else if (inputOverlayNativeEl.isContentEditable) {
            inputOverlayNativeEl.innerText = injected;
        }
        inputOverlayNativeEl.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: '', bubbles: true }));
    } catch (_) { /* non-fatal */ }

    // ── Synchronous snap-back check ─────────────────────────────────────────
    // React/Claude may process the InputEvent synchronously inside dispatchEvent
    // and reset the element to its original height before we return.
    const heightAfterSync = inputOverlayNativeEl.getBoundingClientRect().height;
    if (heightAfterSync <= heightBefore + 2) {
        // Native snapped straight back — mark as resisting so the overlay
        // can grow freely (content-driven) without calling us again.
        nativeResists = true;
        syncingNative = false;
        return;
    }

    // ── Async snap-back / real CSS-max check (rAF) ───────────────────────────
    // If React processes the event later (microtask/scheduler), it snaps back
    // after this function returns. Detect that in the next animation frame.
    requestAnimationFrame(() => {
        syncingNative = false;
        if (!inputOverlayNativeEl || !inputOverlayIsOpen) return;
        const afterRect = inputOverlayNativeEl.getBoundingClientRect();
        if (afterRect.height <= heightBefore + 2) {
            // Async snap-back (e.g. Claude's scheduler) — same treatment as sync.
            nativeResists = true;
        } else if (afterRect.height < targetH || afterRect.bottom >= window.innerHeight - VIEWPORT_MARGIN) {
            // Native grew but hit a real CSS max-height or viewport bottom.
            // Record the hard ceiling so the overlay won't try to exceed it.
            nativeMaxHeight = afterRect.height;
        }
    });
}


// ─── Auto-resize ─────────────────────────────────────────────────────────────
// Uses textarea.scrollHeight (the minimal height to show all content) — reliable
// because scrollHeight is independent of current layout height for textareas.
// We do NOT mutate the native element's height to avoid ResizeObserver feedback loops.

function autoResize(ta, hl) {
    if (!inputOverlayContainer || !inputOverlayNativeEl) return;
    const rect = inputOverlayNativeEl.getBoundingClientRect();

    // Floor: original 1-line native height so overlay never shrinks below it.
    const minH = lockedMinHeight || rect.height;

    // What content needs (grows as user types).
    const contentEditorH = ta ? ta.scrollHeight : 0;
    const contentDesiredH = Math.max(minH, contentEditorH + TOPBAR_HEIGHT + 4);

    // ── Ceiling logic ────────────────────────────────────────────────────────
    // Three tiers:
    //   1. nativeMaxHeight > 0  : native hit a real CSS max-height → hard cap there
    //   2. nativeResists    : native refuses to grow (Claude snap-back) →
    //                             ceiling = contentDesiredH (overlay grows freely)
    //   3. otherwise            : ceiling = max(nativeCurrentH, lockedMinH)
    //                             (keeps growing in sync with native as newlines grow it)
    const nativeCurrentH = rect.height;
    const nativeTopClamped = Math.max(0, Math.min(rect.top, window.innerHeight - minH));
    const nativeBottomClamped = Math.min(rect.bottom, window.innerHeight);
    const spaceBelow = window.innerHeight - nativeTopClamped - 6;
    const spaceAbove = nativeBottomClamped - 6;

    const ceiling = nativeMaxHeight > 0
        ? nativeMaxHeight
        : nativeResists
            ? contentDesiredH          // grow freely with content on snap-back sites
            : Math.max(nativeCurrentH, lockedMinHeight || 0);
    const desiredH = Math.min(contentDesiredH, ceiling);

    let topPx, finalH;
    if (desiredH <= spaceBelow) {
        topPx = nativeTopClamped;
        finalH = desiredH;
    } else if (spaceAbove >= spaceBelow) {
        finalH = Math.min(desiredH, spaceAbove);
        topPx = nativeBottomClamped - finalH;
    } else {
        finalH = Math.max(minH, spaceBelow);
        topPx = nativeTopClamped;
    }
    topPx = Math.max(6, topPx);
    finalH = Math.min(finalH, window.innerHeight - topPx - 6);

    // If the user has manually resized, honour their size — only reposition top
    // when scroll moves the page (left/width frozen so the overlay keeps the user's size).
    if (userResizedHeight > 0 || userResizedWidth > 0) {
        if (userResizedHeight > 0) {
            // Re-anchor top then clamp height so top + height never exceeds the viewport.
            // Without the clamp, a top shift (e.g. from page scroll) can push the bottom
            // edge off-screen, making the overlay disappear.
            inputOverlayContainer.style.top = topPx + 'px';
            const maxH = window.innerHeight - topPx - 6;
            if (userResizedHeight > maxH) {
                userResizedHeight = maxH;
                inputOverlayContainer.style.height = maxH + 'px';
            }
        }
        return;
    }

    Object.assign(inputOverlayContainer.style, {
        top: topPx + 'px',
        left: rect.left + 'px',
        width: rect.width + 'px',
        height: finalH + 'px',
    });

    // Keep asking native to grow toward contentDesiredH as user types.
    // Only attempt to grow native if it hasn't resisted growth yet.
    if (!syncingNative && nativeMaxHeight === 0 && !nativeResists) syncNativeHeight(contentDesiredH);
}

// ─── Positioning ─────────────────────────────────────────────────────────────

function positionInputOverlay() {
    if (!inputOverlayContainer || !inputOverlayNativeEl) return;
    const rect = inputOverlayNativeEl.getBoundingClientRect();
    if (rect.width === 0) return;
    autoResize(inputOverlayInputText, inputOverlayHighlights);
}

// ─── Resize drag ─────────────────────────────────────────────────────────────

// mode: 'both' = height + width (corner); 'height' = height only (bottom edge)
function attachOverlayResizeDrag(handle, gripEl, mode = 'both') {
    handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        const startY = e.clientY;
        const rect = inputOverlayContainer.getBoundingClientRect();
        const startH = rect.height;
        const startW = rect.width;
        const startTop = rect.top;
        const startLeft = rect.left;
        const MIN_H = TOPBAR_HEIGHT + 48;
        const MIN_W = 180;
        const dragCursor = mode === 'height' ? 'ns-resize' : 'nwse-resize';

        if (gripEl) gripEl.style.opacity = '1';
        document.body.style.userSelect = 'none';
        document.body.style.cursor = dragCursor;

        const onMove = (mv) => {
            const dY = mv.clientY - startY;
            const newH = Math.min(Math.max(MIN_H, startH + dY), window.innerHeight - startTop - 6);
            userResizedHeight = newH;
            inputOverlayContainer.style.height = newH + 'px';
            if (mode === 'both') {
                const dX = mv.clientX - startX;
                const newW = Math.min(Math.max(MIN_W, startW + dX), window.innerWidth - startLeft - 6);
                userResizedWidth = newW;
                inputOverlayContainer.style.width = newW + 'px';
            }
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (gripEl) gripEl.style.opacity = '0.5';
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

// ─── Shadow DOM ───────────────────────────────────────────────────────────────

function buildInputOverlayShadow() {
    // ── Synchronous: create container + shadow root ───────────────────────────
    // showInputOverlay() uses inputOverlayContainer.style immediately after this
    // call, so the container MUST be ready synchronously.
    if (!inputOverlayContainer) {
        inputOverlayContainer = document.createElement('div');
        inputOverlayContainer.id = 'cw-input-overlay-host';
        Object.assign(inputOverlayContainer.style, {
            position: 'fixed',
            zIndex: '2147483646',
            pointerEvents: 'auto',
        });
        ['keydown', 'keyup', 'keypress', 'input'].forEach(evt =>
            inputOverlayContainer.addEventListener(evt, e => e.stopPropagation())
        );
        inputOverlayShadowRoot = inputOverlayContainer.attachShadow({ mode: 'closed' });
    }

    if (inputOverlayShadowRoot.getElementById('cwio-shell')) return; // already built

    // ── Attach CSS (starts loading immediately, parallel with HTML fetch) ─────
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('intoverlay.css');
    inputOverlayShadowRoot.appendChild(link);

    // ── Async: fetch HTML → localise → inject → init events ──────────────────
    fetch(chrome.runtime.getURL('intoverlay.html'))
        .then(r => r.text())
        .then(rawHtml => {
            const html = rawHtml
                .replace(/\{\{MSG_(\w+)\}\}/g, (_, k) => chrome.i18n.getMessage(k) || '')
                .replace('src="logo.svg"', `src="${chrome.runtime.getURL('logo.svg')}"`);
            const div = document.createElement('div');
            div.innerHTML = html;
            inputOverlayShadowRoot.appendChild(div.firstElementChild); // #cwio-shell

            // ── Resize handles (inside shadow root so they are rendered) ─────────
            // Both handles must live in the shadow tree — light DOM children of a
            // shadow host are not rendered without a <slot>.

            // Bottom edge — height only (ns-resize); ends before the corner handle
            const edgeHandle = document.createElement('div');
            Object.assign(edgeHandle.style, {
                position: 'absolute',
                bottom: '0',
                left: '0',
                right: '16px',   // leave room for the corner handle
                height: '8px',
                cursor: 'ns-resize',
                zIndex: '9999',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            });
            const edgeGrip = document.createElement('div');
            Object.assign(edgeGrip.style, {
                width: '32px',
                height: '3px',
                borderRadius: '2px',
                background: 'rgba(99,102,241,0.3)',
                pointerEvents: 'none',
                transition: 'background 0.15s',
                opacity: '0.5',
            });
            edgeHandle.appendChild(edgeGrip);
            edgeHandle.addEventListener('mouseenter', () => { edgeGrip.style.background = 'rgba(99,102,241,0.7)'; edgeGrip.style.opacity = '1'; });
            edgeHandle.addEventListener('mouseleave', () => { edgeGrip.style.background = 'rgba(99,102,241,0.3)'; edgeGrip.style.opacity = '0.5'; });
            attachOverlayResizeDrag(edgeHandle, edgeGrip, 'height');
            inputOverlayShadowRoot.appendChild(edgeHandle);

            // Bottom-right corner — height + width (nwse-resize)
            const resizeHandle = document.createElement('div');
            Object.assign(resizeHandle.style, {
                position: 'absolute',
                bottom: '0',
                right: '0',
                width: '16px',
                height: '16px',
                cursor: 'nwse-resize',
                zIndex: '9999',
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'flex-end',
                padding: '2px',
                borderRadius: '0 0 10px 0',
            });
            const grip = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            grip.setAttribute('width', '10');
            grip.setAttribute('height', '10');
            grip.setAttribute('viewBox', '0 0 10 10');
            grip.style.opacity = '0.5';
            grip.style.pointerEvents = 'none';
            grip.style.transition = 'opacity 0.15s';
            grip.innerHTML =
                '<line x1="10" y1="3" x2="3" y2="10" stroke="rgba(99,102,241,0.8)" stroke-width="1.5" stroke-linecap="round"/>' +
                '<line x1="10" y1="6" x2="6" y2="10" stroke="rgba(99,102,241,0.8)" stroke-width="1.5" stroke-linecap="round"/>' +
                '<line x1="10" y1="9" x2="9" y2="10" stroke="rgba(99,102,241,0.8)" stroke-width="1.5" stroke-linecap="round"/>';
            resizeHandle.appendChild(grip);
            resizeHandle.addEventListener('mouseenter', () => { grip.style.opacity = '1'; });
            resizeHandle.addEventListener('mouseleave', () => { grip.style.opacity = '0.5'; });
            attachOverlayResizeDrag(resizeHandle, grip, 'both');
            inputOverlayShadowRoot.appendChild(resizeHandle);

            inputOverlayInputText = inputOverlayShadowRoot.getElementById('cwio-ta');
            inputOverlayHighlights = inputOverlayShadowRoot.getElementById('cwio-hl');
            inputOverlayOutputText = inputOverlayShadowRoot.getElementById('cwio-out');

            // Activate shared scan pipeline for the integrated overlay.
            // This must happen BEFORE initInputOverlayEvents() so that any
            // immediate processText() calls go through our shadow DOM elements.
            activateIntOverlayCtx(
                inputOverlayShadowRoot, inputOverlayInputText, inputOverlayHighlights,
                inputCustomWords, inputIgnoredWords, inputOverlayOutputText
            );
            initInputOverlayEvents();

            // Apply any seed text that was queued while the shadow DOM was loading.
            // On first open, unmaskTokens resolves before the fetch completes,
            // finding inputOverlayInputText still null and discarding the text.
            if (_pendingSeedText != null) {
                const seed = _pendingSeedText;
                _pendingSeedText = null;
                inputOverlayInputText.value = seed;
                renderRaw(inputOverlayHighlights, seed);
                if (seed) {
                    autoResize(inputOverlayInputText, inputOverlayHighlights);
                    processText(true);
                    requestAnimationFrame(updateWarnBar);
                }
                setTimeout(() => { if (inputOverlayInputText) inputOverlayInputText.focus(); }, 30);
            }
        })
        .catch(err => console.error('ChatWall: failed to load intoverlay.html', err));
}

function initInputOverlayEvents() {
    if (!inputOverlayShadowRoot) return;
    const ta = inputOverlayInputText;
    const hl = inputOverlayHighlights;
    if (!ta || !hl) return;

    // Fav button initial state
    const isPremium = () => (typeof USER_PLAN !== 'undefined') && USER_PLAN !== 'FREE';
    const btnFav = inputOverlayShadowRoot.getElementById('cwio-fav');
    const btnMask = inputOverlayShadowRoot.getElementById('cwio-mask');
    const btnUnmask = inputOverlayShadowRoot.getElementById('cwio-unmask');

    const updateFavBtn = () => {
        if (!btnFav) return;
        const ok = isPremium();
        btnFav.style.opacity = ok ? '' : '0.45';
        btnFav.title = ok ? 'Add/remove favorite' : 'Favorites require Premium';
    };
    refreshFavBtnFn = updateFavBtn;
    updateFavBtn();

    // ── Input / paste / scroll ─────────────────────────────────────────────
    // Mirrors the full overlay's event strategy:
    //   • handleOptimisticInput  → instant shift-and-render on every keystroke
    //   • debounced processText  → full NLP scan after 380 ms of silence
    ta.addEventListener('input', () => {
        handleOptimisticInput(ta);  // instant feedback (surgical DOM splice for large texts)
        hl.scrollTop = ta.scrollTop;
        autoResize(ta, hl);
        clearTimeout(inputOverlayTypingTimer);
        inputOverlayTypingTimer = setTimeout(() => { processText(); requestAnimationFrame(updateWarnBar); }, 380);
    });

    ta.addEventListener('paste', () => {
        setTimeout(() => {
            handleOptimisticInput(ta);
            hl.scrollTop = ta.scrollTop;
            autoResize(ta, hl);
            // processText is async — await it so updateWarnBar fires AFTER
            // currentMatches is populated with the scan result (locked tokens).
            processText(true).then(() => requestAnimationFrame(updateWarnBar));
        }, 30);
    });

    let _raf = null;
    let _scrollTimer = null;
    ta.addEventListener('scroll', () => {
        if (_raf) return;
        _raf = requestAnimationFrame(() => {
            _raf = null;
            hl.scrollTop = ta.scrollTop;
            // For large documents, trigger a scroll-based partial scan
            if (ta.value.length > NLP_CONTEXT_WINDOW * 2) {
                clearTimeout(_scrollTimer);
                _scrollTimer = setTimeout(() => { processText(false, true); requestAnimationFrame(updateWarnBar); }, 300);
            }
        });
    }, { passive: true });

    // ── Mask button ────────────────────────────────────────────────────────
    if (btnMask) {
        btnMask.addEventListener('mousedown', e => e.preventDefault());
        btnMask.addEventListener('click', () => {
            const sel = getInputSelection(ta);
            if (sel) {
                applyMask(ta, hl, sel.start, sel.end);
            } else {
                inputOverlayActiveTool = inputOverlayActiveTool === 'mask' ? null : 'mask';
                btnMask.classList.toggle('active', inputOverlayActiveTool === 'mask');
                if (btnUnmask) btnUnmask.classList.remove('active');
                if (btnFav) btnFav.classList.remove('active');
            }
        });
    }

    // ── Unmask button ──────────────────────────────────────────────────────
    if (btnUnmask) {
        btnUnmask.addEventListener('mousedown', e => e.preventDefault());
        btnUnmask.addEventListener('click', () => {
            const sel = getInputSelection(ta);
            if (sel) {
                applyUnmask(ta, hl, sel.start, sel.end);
            } else {
                inputOverlayActiveTool = inputOverlayActiveTool === 'unmask' ? null : 'unmask';
                if (btnUnmask) btnUnmask.classList.toggle('active', inputOverlayActiveTool === 'unmask');
                if (btnMask) btnMask.classList.remove('active');
                if (btnFav) btnFav.classList.remove('active');
            }
        });
    }

    // ── Favorite button ────────────────────────────────────────────────────
    // ── Premium favorites popup (shared helper) ───────────────────────────────
    function showFavPremiumPopup() {
        let popup = inputOverlayShadowRoot.getElementById('cwio-fav-popup');
        if (!popup) {
            popup = document.createElement('div');
            popup.id = 'cwio-fav-popup';
            Object.assign(popup.style, {
                position: 'absolute', inset: '0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(5,5,18,0.72)', backdropFilter: 'blur(6px)',
                zIndex: '999', borderRadius: 'inherit',
            });
            const card = document.createElement('div');
            Object.assign(card.style, {
                background: 'linear-gradient(145deg,#13122a,#1a1838)',
                border: '1px solid rgba(99,102,241,0.28)',
                borderRadius: '14px', padding: '22px 24px 18px',
                maxWidth: '230px', textAlign: 'center',
                boxShadow: '0 8px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)',
                color: '#e2e8f0', fontFamily: 'inherit',
            });
            card.innerHTML = `
                <div style="width:36px;height:36px;margin:0 auto 12px;border-radius:50%;
                    background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.35);
                    display:flex;align-items:center;justify-content:center;font-size:16px;">⭐</div>
                <div style="font-weight:600;font-size:13px;margin-bottom:6px;color:#c7d2fe;letter-spacing:0.02em;">
                    Favorites — Premium
                </div>
                <div style="font-size:11.5px;color:rgba(199,210,254,0.55);line-height:1.6;margin-bottom:18px;">
                    Auto-mask your favourite words every time they appear in your prompts.
                </div>
                <a id="cwio-fav-upgrade" href="https://chatwall.io/#pricing" target="_blank"
                    style="display:block;background:linear-gradient(135deg,#4f46e5,#7c3aed);
                    color:#fff;font-weight:600;font-size:12px;padding:8px 0;border-radius:8px;
                    text-decoration:none;margin-bottom:10px;letter-spacing:0.03em;
                    box-shadow:0 2px 12px rgba(99,102,241,0.35);transition:opacity .15s;">
                    Upgrade to unlock ↗
                </a>
                <button id="cwio-fav-dismiss"
                    style="background:none;border:none;color:rgba(199,210,254,0.35);
                    font-size:11px;cursor:pointer;padding:2px 6px;font-family:inherit;
                    transition:color .15s;">
                    Not now
                </button>`;
            popup.appendChild(card);
            inputOverlayShadowRoot.getElementById('cwio-shell').appendChild(popup);
            popup.addEventListener('click', ev => { if (ev.target === popup) popup.style.display = 'none'; });
            popup.querySelector('#cwio-fav-dismiss').addEventListener('click', () => { popup.style.display = 'none'; });
            popup.querySelector('#cwio-fav-upgrade').addEventListener('click', () => { popup.style.display = 'none'; });
            // Hover effects
            const upgradeBtn = popup.querySelector('#cwio-fav-upgrade');
            upgradeBtn.addEventListener('mouseenter', () => upgradeBtn.style.opacity = '0.88');
            upgradeBtn.addEventListener('mouseleave', () => upgradeBtn.style.opacity = '');
            const dismissBtn = popup.querySelector('#cwio-fav-dismiss');
            dismissBtn.addEventListener('mouseenter', () => dismissBtn.style.color = 'rgba(199,210,254,0.65)');
            dismissBtn.addEventListener('mouseleave', () => dismissBtn.style.color = '');
        }
        popup.style.display = 'flex';
    }

    if (btnFav) {
        btnFav.addEventListener('mousedown', e => e.preventDefault());
        btnFav.addEventListener('click', () => {
            if (!isPremium()) {
                showFavPremiumPopup();
                return;
            }
            const sel = getInputSelection(ta);
            if (sel) {
                const word = ta.value.substring(sel.start, sel.end).trim();
                if (!word) return;
                if (typeof favoritesList !== 'undefined') {
                    if (favoritesList.has(word)) { favoritesList.delete(word); } else {
                        favoritesList.add(word);
                        inputCustomWords.add(word);
                        inputIgnoredWords.delete(word);
                    }
                    if (typeof saveFavorites === 'function') saveFavorites();
                    cachedLocalMatches = null;
                    processText(true);
                    requestAnimationFrame(updateWarnBar);
                }
            } else {
                inputOverlayActiveTool = inputOverlayActiveTool === 'fav' ? null : 'fav';
                if (btnFav) btnFav.classList.toggle('active', inputOverlayActiveTool === 'fav');
                if (btnMask) btnMask.classList.remove('active');
                if (btnUnmask) btnUnmask.classList.remove('active');
            }
        });
    }

    // Sticky tool: fires after drag-release inside the textarea
    ta.addEventListener('mouseup', () => {
        if (!inputOverlayActiveTool) return;
        const sel = getInputSelection(ta);
        if (!sel) return;
        if (inputOverlayActiveTool === 'mask') applyMask(ta, hl, sel.start, sel.end);
        if (inputOverlayActiveTool === 'unmask') applyUnmask(ta, hl, sel.start, sel.end);
        if (inputOverlayActiveTool === 'fav') {
            const word = ta.value.substring(sel.start, sel.end).trim();
            if (word && typeof favoritesList !== 'undefined') {
                favoritesList.add(word);
                inputCustomWords.add(word);
                inputIgnoredWords.delete(word);
                if (typeof saveFavorites === 'function') saveFavorites();
                cachedLocalMatches = null;
                processText(true);
                requestAnimationFrame(updateWarnBar);
            }
        }
        ta.setSelectionRange(sel.start, sel.start);
    });

    // ── Expand ─────────────────────────────────────────────────────────────
    const btnExpand = inputOverlayShadowRoot.getElementById('cwio-expand');
    if (btnExpand) {
        btnExpand.addEventListener('click', () => {
            const currentText = ta.value;
            const blocksToPreserve = Array.from(inputCustomWords);
            // Let sendToLLM know where to paste the masked text back
            lastRightClickedElement = inputOverlayNativeEl;
            // Close integrated overlay before opening full overlay
            hideInputOverlay(false);
            handleShowOverlay(currentText || null, blocksToPreserve);
        });
    }


    // ── Send masked to AI ──────────────────────────────────────────────────
    const btnSend = inputOverlayShadowRoot.getElementById('cwio-send');
    if (btnSend) btnSend.addEventListener('click', () => sendMasked());

    // ── Close ──────────────────────────────────────────────────────────────
    const btnClose = inputOverlayShadowRoot.getElementById('cwio-close');
    if (btnClose) btnClose.addEventListener('click', () => {
        hideInputOverlay(false);
    });

    // ── Settings ───────────────────────────────────────────────────────────
    const btnSettings = inputOverlayShadowRoot.getElementById('cwio-settings');
    if (btnSettings) btnSettings.addEventListener('click', e => {
        e.stopPropagation();
        if (typeof window.cwOpenModeMenu === 'function') window.cwOpenModeMenu();
    });

    // ── Premium locked-token tooltip ──────────────────────────────────────────
    // ta sits ON TOP of hl in z-order, so .token-locked spans never receive
    // pointer events directly. Instead, listen on ta and do a bounding-rect
    // hit-test against all .token-locked spans in hl on every mousemove.
    {
        let _cwTip = null;
        ta.addEventListener('mousemove', (evT) => {
            const lockedSpans = hl.querySelectorAll('.token-locked');
            let found = null;
            for (const span of lockedSpans) {
                const r = span.getBoundingClientRect();
                if (evT.clientX >= r.left && evT.clientX <= r.right &&
                    evT.clientY >= r.top && evT.clientY <= r.bottom) {
                    found = span;
                    break;
                }
            }
            if (!found) {
                if (_cwTip) _cwTip.style.opacity = '0';
                return;
            }
            if (!_cwTip) {
                _cwTip = document.createElement('div');
                Object.assign(_cwTip.style, {
                    position: 'fixed',
                    background: 'linear-gradient(135deg,#13122a,#1a1838)',
                    border: '1px solid rgba(99,102,241,0.28)',
                    color: '#c7d2fe', fontSize: '10.5px', fontWeight: '500',
                    padding: '6px 10px', borderRadius: '7px', lineHeight: '1.5',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.55)',
                    pointerEvents: 'none', whiteSpace: 'normal', maxWidth: '220px',
                    opacity: '0', transition: 'opacity 0.12s',
                    zIndex: '2147483647', fontFamily: 'inherit',
                });
                const shell = inputOverlayShadowRoot.getElementById('cwio-shell');
                if (shell) shell.appendChild(_cwTip);
            }
            const tooltipText = found.getAttribute('data-tooltip-text')
                || '⭐ Upgrade to Premium to auto-mask this';
            _cwTip.textContent = tooltipText;
            _cwTip.style.left = (evT.clientX + 12) + 'px';
            _cwTip.style.top = (evT.clientY - 34) + 'px';
            _cwTip.style.opacity = '1';
        });
        ta.addEventListener('mouseleave', () => {
            if (_cwTip) _cwTip.style.opacity = '0';
        });
    }

    ta.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.stopPropagation(); hideInputOverlay(false); }
    });

    // ── Right-click context menu ───────────────────────────────────────────
    // Provides Mask / Unmask / Favorite without the full overlay's output panel.
    let ctxMenu = null;
    let ctxMenuCursorPos = 0; // char index in ta.value at the time of right-click

    const hideCtxMenu = () => { if (ctxMenu) ctxMenu.style.display = 'none'; };

    const showCtxMenu = (clientX, clientY, cursorPos) => {
        ctxMenuCursorPos = cursorPos;

        // mkItem must be defined here (outside if(!ctxMenu)) so it's in scope
        // on every call — the first call creates the ctxMenu, subsequent calls
        // just clear and repopulate it.
        const mkItem = (icon, label, action) => {
            const item = document.createElement('div');
            item.innerHTML = `<span style="margin-right:8px;display:flex;align-items:center;opacity:0.8">${icon}</span>${label}`;
            Object.assign(item.style, {
                padding: '7px 14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
            });
            item.addEventListener('mouseenter', () => item.style.background = 'rgba(99,102,241,0.22)');
            item.addEventListener('mouseleave', () => item.style.background = '');
            item.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
            item.addEventListener('click', e => {
                e.preventDefault(); e.stopPropagation();
                action();
                hideCtxMenu();
            });
            return item;
        };

        // Create and attach the container once
        if (!ctxMenu) {
            ctxMenu = document.createElement('div');
            ctxMenu.id = 'cwio-ctx-menu';
            Object.assign(ctxMenu.style, {
                position: 'fixed',
                zIndex: '2147483647',
                background: 'rgba(18,20,32,0.98)',
                border: '1px solid rgba(99,102,241,0.45)',
                borderRadius: '8px',
                boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
                padding: '4px 0',
                minWidth: '168px',
                fontFamily: 'inherit',
                fontSize: '12px',
                fontWeight: '500',
                color: '#e2e8f0',
                userSelect: 'none',
                display: 'none',
            });
            // Stop events on the container too (covers clicks on padding/gaps)
            ctxMenu.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
            ctxMenu.addEventListener('click', e => { e.stopPropagation(); });
            // Append to shadow root (outside #cwio-shell) to escape overflow:hidden
            inputOverlayShadowRoot.appendChild(ctxMenu);
        } else {
            // Clear dynamic items (everything after the separator)
            while (ctxMenu.lastChild) ctxMenu.removeChild(ctxMenu.lastChild);
        }

        // ── Resolve context ───────────────────────────────────────────────────
        const sel = getInputSelection(ta);
        const hasSelection = !!sel;
        const selText = sel ? ta.value.substring(sel.start, sel.end).trim() : '';
        // Token at cursor (only when no selection)
        const tokenAtCursor = !hasSelection
            ? (currentMatches || []).find(m => cursorPos >= m.start && cursorPos <= m.end) || null
            : null;
        // Word at cursor (whitespace-delimited, only when no selection)
        const wordAt = (() => {
            if (hasSelection) return null;
            const text = ta.value;
            let s = cursorPos, e = cursorPos;
            while (s > 0 && !/\s/.test(text[s - 1])) s--;
            while (e < text.length && !/\s/.test(text[e])) e++;
            return s < e ? { start: s, end: e, text: text.substring(s, e) } : null;
        })();
        const targetText = selText || (tokenAtCursor ? tokenAtCursor.text : null) || (wordAt ? wordAt.text : null) || '';
        const isFavorite = targetText ? (typeof favoritesList !== 'undefined' && favoritesList.has(targetText)) : false;

        // Shared SVG icons (same as toolbar buttons)
        const SVG_MASK = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
        const SVG_UNMASK = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
        const SVG_FAV = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01z"/></svg>`;
        const SVG_REM = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

        // ── 1. MASK ───────────────────────────────────────────────────────────
        if (hasSelection && selText) {
            ctxMenu.appendChild(mkItem(SVG_MASK, 'Mask selection', () => {
                applyMask(ta, hl, sel.start, sel.end);
            }));
        } else if (wordAt && !tokenAtCursor) {
            ctxMenu.appendChild(mkItem(SVG_MASK, `Mask "${wordAt.text}"`, () => {
                applyMask(ta, hl, wordAt.start, wordAt.end);
            }));
        }

        // ── 2. UNMASK / REMOVE FAVORITE ───────────────────────────────────────
        if (isFavorite) {
            ctxMenu.appendChild(mkItem(SVG_REM, 'Remove from favorites', () => {
                if (!isPremium()) { showFavPremiumPopup(); hideCtxMenu(); return; }
                if (typeof favoritesList !== 'undefined') {
                    favoritesList.delete(targetText);
                    inputCustomWords.delete(targetText);
                    if (typeof saveFavorites === 'function') saveFavorites();
                    cachedLocalMatches = null;
                    processText(true);
                    requestAnimationFrame(updateWarnBar);
                }
            }));
        } else if (tokenAtCursor) {
            ctxMenu.appendChild(mkItem(SVG_UNMASK, 'Unmask token', () => {
                applyUnmask(ta, hl, tokenAtCursor.start, tokenAtCursor.end);
            }));
        } else if (hasSelection && selText) {
            ctxMenu.appendChild(mkItem(SVG_UNMASK, 'Unmask selection', () => {
                applyUnmask(ta, hl, sel.start, sel.end);
            }));
        }

        // ── Separator ─────────────────────────────────────────────────────────
        const sep = document.createElement('div');
        Object.assign(sep.style, { height: '1px', background: 'rgba(99,102,241,0.2)', margin: '4px 0' });
        ctxMenu.appendChild(sep);

        // ── 3. ADD TO FAVORITES ───────────────────────────────────────────────
        if (!isFavorite && targetText) {
            const favLabel = hasSelection ? 'Add selection to favorites' : `Add "${targetText}" to favorites`;
            ctxMenu.appendChild(mkItem(SVG_FAV, favLabel, () => {
                if (!isPremium()) { showFavPremiumPopup(); hideCtxMenu(); return; }
                const word = selText || (wordAt ? wordAt.text : '') || (tokenAtCursor ? tokenAtCursor.text : '');
                if (word && typeof favoritesList !== 'undefined') {
                    favoritesList.add(word);
                    inputCustomWords.add(word);
                    inputIgnoredWords.delete(word);
                    if (typeof saveFavorites === 'function') saveFavorites();
                    cachedLocalMatches = null;
                    processText(true);
                    requestAnimationFrame(updateWarnBar);
                }
            }));
        }

        ctxMenu.style.display = 'block';
        const mW = 240, mH = 160;
        ctxMenu.style.left = Math.min(clientX, window.innerWidth - mW) + 'px';
        ctxMenu.style.top = Math.min(clientY, window.innerHeight - mH) + 'px';
    };

    ta.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        showCtxMenu(e.clientX, e.clientY, ta.selectionStart ?? 0);
    });

    // Hide menu on any click inside the shadow root
    inputOverlayShadowRoot.addEventListener('click', hideCtxMenu);
    inputOverlayShadowRoot.addEventListener('keydown', e => {
        if (e.key === 'Escape') hideCtxMenu();
    });
}




// ─── Selection helper ─────────────────────────────────────────────────────────

function getInputSelection(ta) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    if (s == null || e == null || s === e) return null;
    return { start: s, end: e };
}

// ─── Mask / Unmask ────────────────────────────────────────────────────────────

/**
 * Add a custom mask for the selected text range.
 * The word is stored in inputCustomWords so it survives subsequent NLP scans.
 * Re-renders immediately (with CUSTOM highlight) then fires a background scan.
 */
function applyMask(ta, hl, start, end) {
    const word = ta.value.substring(start, end).trim();
    if (!word) return;
    // inputCustomWords IS manualBlockList after activateIntOverlayCtx → shared pipeline sees it.
    inputCustomWords.add(word);
    inputIgnoredWords.delete(word);
    cachedLocalMatches = null;  // force local regex rebuild in finalizeProcessing
    // Immediate re-render via the shared pipeline (same as full overlay's Mask action).
    finalizeProcessing(cachedNlpMatches, 0, 0, 0);
    requestAnimationFrame(updateWarnBar);
    // Full NLP rescan after a brief pause (debounced).
    clearTimeout(inputOverlayTypingTimer);
    inputOverlayTypingTimer = setTimeout(() => { processText(true); requestAnimationFrame(updateWarnBar); }, 200);
}

/**
 * Remove a custom mask or suppress an NLP-detected word.
 */
function applyUnmask(ta, hl, start, end) {
    // Add EACH matched token in range to ignoredWords.
    // currentMatches is maintained by the shared finalizeProcessing pipeline.
    const inRange = (currentMatches || []).filter(m => m.start >= start && m.end <= end);
    if (inRange.length > 0) {
        inRange.forEach(m => { inputCustomWords.delete(m.text); inputIgnoredWords.add(m.text); });
    } else {
        const word = ta.value.substring(start, end).trim();
        if (word) { inputCustomWords.delete(word); inputIgnoredWords.add(word); }
    }
    cachedLocalMatches = null;
    finalizeProcessing(cachedNlpMatches, 0, 0, 0);
    hl.scrollTop = ta.scrollTop;
    requestAnimationFrame(updateWarnBar);
    clearTimeout(inputOverlayTypingTimer);
    inputOverlayTypingTimer = setTimeout(() => { processText(true); requestAnimationFrame(updateWarnBar); }, 200);
}

// Merge/render is now handled by the shared buildAllMatches + buildHighlightFragment (04_processing.js)

// ─── Build masked text ────────────────────────────────────────────────────────

// ─── sendMasked reads from #cwio-out (written by finalizeProcessing) ──────────
// buildMaskedText was deleted: masking is now done exclusively by the shared
// finalizeProcessing() pipeline (04_processing.js) which writes token spans
// into elOutputText (#cwio-out). sendMasked simply reads its textContent.


// ─── Close hint popup ────────────────────────────────────────────────────────

/**
 * Show an in-overlay hint when the user clicks ✕ on the integrated overlay.
 * Explains that closing is temporary, and offers to open Settings to change mode.
 * Matches the style of the cwio-fav-popup pattern.
 */
function showCloseHint(shell, shadowRoot) {
    let popup = shadowRoot.getElementById('cwio-close-hint');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'cwio-close-hint';
        Object.assign(popup.style, {
            position: 'absolute', inset: '0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
            zIndex: '999', borderRadius: 'inherit',
        });
        const card = document.createElement('div');
        Object.assign(card.style, {
            background: 'linear-gradient(135deg,#1e1b30,#2a2040)',
            border: '1px solid rgba(99,179,237,0.2)',
            borderRadius: '14px', padding: '20px 22px 16px',
            maxWidth: '250px', textAlign: 'center',
            boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
            color: '#f1f5f9', fontFamily: 'inherit',
        });
        card.innerHTML = `
            <div style="font-size:24px;margin-bottom:8px;">⚙️</div>
            <div style="font-weight:700;font-size:13px;color:#93c5fd;margin-bottom:8px;">
                Hide the input assistant?
            </div>
            <div style="font-size:11.5px;color:rgba(255,255,255,0.65);line-height:1.55;margin-bottom:16px;">
                Closing only dismisses it for <strong style="color:#e2e8f0;">this session</strong> — it will reappear next time you visit.
                To <strong style="color:#e2e8f0;">permanently switch</strong> to Float mode, Full overlay, or disable
                ChatWall on this page, open <strong style="color:#e2e8f0;">ChatWall Settings</strong>.
            </div>
            <button id="cwio-close-settings"
                style="display:block;width:100%;background:linear-gradient(90deg,#3b82f6,#6366f1);
                       color:#fff;font-weight:700;font-size:12px;padding:8px 0;border-radius:8px;
                       border:none;cursor:pointer;margin-bottom:8px;">
                ⚙️ Open Settings
            </button>
            <button id="cwio-close-just"
                style="background:none;border:none;color:rgba(255,255,255,0.4);font-size:12px;
                       cursor:pointer;padding:4px 8px;">
                Just close
            </button>`;

        popup.appendChild(card);
        shell.appendChild(popup);

        // Close if user clicks the backdrop
        popup.addEventListener('click', (ev) => {
            if (ev.target === popup) popup.style.display = 'none';
        });
        popup.querySelector('#cwio-close-settings').addEventListener('click', () => {
            popup.style.display = 'none';
            hideInputOverlay(false);
            if (typeof window.cwOpenModeMenu === 'function') window.cwOpenModeMenu();
        });
        popup.querySelector('#cwio-close-just').addEventListener('click', () => {
            popup.style.display = 'none';
            hideInputOverlay(false);
        });
    }
    popup.style.display = 'flex';
}

// ─── Send masked content to AI ────────────────────────────────────────────────

let justSent = false;

async function sendMasked() {
    if (!inputOverlayNativeEl || !inputOverlayInputText) return;

    // finalizeProcessing already wrote the masked text (token spans) into
    // inputOverlayOutputText (#cwio-out). Read it as plain text — same output
    // the full editor uses, so token deduplication and numbering are identical.
    const rawText = inputOverlayInputText.value;
    const maskedText = inputOverlayOutputText ? inputOverlayOutputText.textContent : rawText;
    if (!maskedText.trim()) return;

    // Tokens were already saved by finalizeProcessing via saveTokens().
    // No extra merge needed — just bust the in-memory cache so next open is fresh.
    globalTokenMap = null;

    // Restore native input visibility FIRST — focus() and execCommand require
    // the element to be visible (opacity:0 hides it from the browser's perspective).
    inputOverlayNativeEl.style.opacity = '';
    inputOverlayNativeEl.style.pointerEvents = '';
    inputOverlayNativeEl.style.caretColor = '';
    lockedMinHeight = 0;
    userResizedHeight = 0;
    userResizedWidth = 0;
    nativeOriginalContent = '';
    nativeMaxHeight = 0;
    nativeResists = false;

    // ── Tear down the overlay BEFORE writing to the native element ───────────
    // Why: if we write first and THEN removeChild(overlay), React sees the DOM
    // removal and synchronously flushes a re-render of the page.  At that
    // point React's onChange state update (triggered by our 'input' event) has
    // not yet been committed, so the textarea re-renders with the OLD empty
    // value — silently erasing what we just wrote.  Removing the overlay first
    // lets React settle, then we write + focus in the next animation frame.
    const nativeEl = inputOverlayNativeEl;
    inputOverlayIsOpen = false;
    clearTimeout(inputOverlayTypingTimer);
    deactivateIntOverlayCtx();   // restore full-overlay pipeline before removing DOM

    if (inputOverlayBackdrop && inputOverlayBackdrop.parentNode)
        inputOverlayBackdrop.parentNode.removeChild(inputOverlayBackdrop);
    inputOverlayBackdrop = null;
    if (inputOverlayContainer && inputOverlayContainer.parentNode)
        inputOverlayContainer.parentNode.removeChild(inputOverlayContainer);
    if (inputOverlayTargetObserver) { inputOverlayTargetObserver.disconnect(); inputOverlayTargetObserver = null; }
    if (inputOverlayScrollCleanup) { inputOverlayScrollCleanup(); inputOverlayScrollCleanup = null; }

    inputOverlayNativeEl = null;
    inputOverlayActiveTool = null;
    inputOverlayMatches = [];

    // Write the masked text in two stages separated by animation frames:
    //
    //   rAF 1 — focus the textarea.  React's onFocus fires and is committed
    //            (including any controlled-input state initialisation / reset
    //            that Claude runs on first focus).
    //
    //   rAF 2 — write the value.  React has now settled from the focus event,
    //            so our native-setter + InputEvent flow lands on top of a clean
    //            state and is not overwritten by a pending focus-triggered reset.
    justSent = true;
    requestAnimationFrame(() => {
        // Re-check the element is still live (Claude may replace it on first focus)
        let target = nativeEl;
        if (!document.body.contains(nativeEl)) {
            const fresh = findMainInput();
            if (fresh) target = fresh;
        }

        // ── Focus the target ──────────────────────────────────────────────────
        // On Claude.ai (and potentially other sites), the element captured by
        // findMainInput() may be a hidden backing TEXTAREA that React uses
        // internally but that cannot receive browser focus. The actual visible
        // editor is a contenteditable ProseMirror div.
        // If focus() silently fails (activeElement stays on body/document),
        // immediately re-scan for a visible, focusable contenteditable and
        // switch to that as the write target before calling writeToNativeEl.
        target.focus();
        if (document.activeElement !== target && document.activeElement === document.body) {
            // Focus did not land — look for a visible focusable contenteditable
            const candidates = Array.from(
                document.querySelectorAll('[contenteditable="true"], [contenteditable=""], [role="textbox"]')
            ).filter(el => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            });
            if (candidates.length > 0) {
                // Try each candidate; stop at the first one that accepts focus
                for (const c of candidates) {
                    c.focus();
                    if (document.activeElement === c) { target = c; break; }
                }
            }
        }

        const isClaude = /claude\.ai/i.test(window.location.hostname);
        // ProseMirror contenteditable needs extra settle time on first-ever focus.
        // Hidden-textarea case is also Claude but isContentEditable will now be true
        // after the fallback above, so the settle applies correctly.
        const needsExtraSettle = isClaude && target.isContentEditable;

        const doWrite = () => {
            writeToNativeEl(target, maskedText);
            target.focus();
            setTimeout(() => { justSent = false; }, 800);
        };

        if (needsExtraSettle) {
            setTimeout(doWrite, 80);
        } else {
            requestAnimationFrame(doWrite);
        }
    });

    // Show badge — native now has masked content; user can re-open overlay to edit
    showReopenBadge(nativeEl);
}




// ─── Commit plain text / Restore ─────────────────────────────────────────────

function _commitInputOverlayToNative(restoreNative) {
    if (!inputOverlayNativeEl) return;
    const text = inputOverlayInputText ? inputOverlayInputText.value : '';
    if (text) {
        writeToNativeEl(inputOverlayNativeEl, text); // preserves line breaks on contenteditable
    }
    if (restoreNative) {
        inputOverlayNativeEl.style.opacity = '';
        inputOverlayNativeEl.style.pointerEvents = '';
        inputOverlayNativeEl.style.caretColor = '';
    }
}

// ─── Re-open badge helpers ────────────────────────────────────────────────────

function hideReopenBadge() {
    if (reopenBadgeRafId) { cancelAnimationFrame(reopenBadgeRafId); reopenBadgeRafId = null; }
    if (reopenBadgeSyncInterval) { clearInterval(reopenBadgeSyncInterval); reopenBadgeSyncInterval = null; }
    if (reopenBadgeScrollFn) {
        window.removeEventListener('scroll', reopenBadgeScrollFn, true);
        // Clean up ancestor scroll listeners (ChatGPT inner scroll containers, etc.)
        for (const el of reopenBadgeScrollAncestors) {
            el.removeEventListener('scroll', reopenBadgeScrollFn, true);
        }
        reopenBadgeScrollAncestors = [];
        reopenBadgeScrollFn = null;
    }
    if (reopenBadgeResizeObs) { reopenBadgeResizeObs.disconnect(); reopenBadgeResizeObs = null; }
    if (reopenBadgeMutObs) { reopenBadgeMutObs.disconnect(); reopenBadgeMutObs = null; }
    if (!reopenBadge) return;
    if (reopenBadge.parentNode) reopenBadge.remove();
    reopenBadge = null;
    reopenBadgeNative = null;
}

function positionReopenBadge() {
    if (!reopenBadge || !reopenBadgeNative) return;

    // Self-heal: if the SPA replaced the textarea after submit (React, Vue, etc.)
    // the old reference is detached — find the live input and re-bind.
    if (!document.body.contains(reopenBadgeNative)) {
        const fresh = (typeof findMainInput === 'function') ? findMainInput() : null;
        if (!fresh) return;
        reopenBadgeNative = fresh;
        // Rewire ResizeObserver to the new element so future resizes reposition badge
        if (reopenBadgeResizeObs) {
            reopenBadgeResizeObs.disconnect();
            reopenBadgeResizeObs.observe(fresh);
            if (fresh.parentElement) reopenBadgeResizeObs.observe(fresh.parentElement);
        }
        // Rewire MutationObserver to track the new element's content & parent
        if (reopenBadgeMutObs) {
            reopenBadgeMutObs.disconnect();
            reopenBadgeMutObs.observe(fresh, {
                characterData: true, childList: true, subtree: true,
                attributes: true, attributeFilter: ['style', 'class'],
            });
            if (fresh.parentElement) {
                reopenBadgeMutObs.observe(fresh.parentElement, { childList: true });
            }
        }
    }

    // Choose the best positional anchor.
    // On ChatGPT the contenteditable sits inside a max-height scroll container
    // (overflow:auto, ~208px tall). As the user scrolls within that container,
    // the element's own getBoundingClientRect().top drifts upward. So we walk up
    // to the nearest local scroll ancestor and anchor the badge there instead.
    // "Local" means the container is smaller than 90% of the viewport — it's not
    // the main page scroll, just a field-level clip.
    let anchor = reopenBadgeNative;
    let _el = reopenBadgeNative.parentElement;
    while (_el && _el !== document.body) {
        const _st = window.getComputedStyle(_el);
        if (/auto|scroll/.test(_st.overflow + _st.overflowY)) {
            const _pr = _el.getBoundingClientRect();
            if (_pr.height > 0 && _pr.height < window.innerHeight * 0.9) {
                anchor = _el;
                break;
            }
        }
        _el = _el.parentElement;
    }

    const r = anchor.getBoundingClientRect();
    if (r.width === 0) return;
    // Place badge just ABOVE the input's top-right corner so it never overlaps text
    const badgeH = 32;  // approximate badge height + gap
    reopenBadge.style.top = Math.max(4, r.top - badgeH) + 'px';
    reopenBadge.style.left = Math.max(8, r.right - 160) + 'px';
}

/**
 * Apply or remove risk-warning visuals on the reopen badge.
 * Called from updateButtonState() (08_float_button.js) so both the
 * float button and the reopen badge stay in sync through the same events.
 */
function updateReopenBadgeRisk(hasRisk) {
    if (!reopenBadge) return;

    if (hasRisk) {
        reopenBadge.style.border = '1.5px solid #ef4444';
        reopenBadge.style.boxShadow = '0 4px 16px rgba(0,0,0,0.45), 0 0 0 3px rgba(239,68,68,0.18)';

        // Add RED_SHIELD_SVG badge (same SVG + animation as float button)
        if (!reopenBadge.querySelector('.cw-badge-warn')) {
            const warn = document.createElement('div');
            warn.className = 'cw-badge-warn';
            warn.innerHTML = RED_SHIELD_SVG;
            Object.assign(warn.style, {
                position: 'absolute', top: '-10px', right: '-10px',
                width: '20px', height: '20px', zIndex: '10',
                filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.3))',
                animation: 'cw-bounce 2s infinite',
                pointerEvents: 'none',
            });
            reopenBadge.appendChild(warn);
        }

        // Add tooltip (same text as float button warning)
        if (!reopenBadge.querySelector('.cw-badge-tooltip')) {
            const tip = document.createElement('div');
            tip.className = 'cw-badge-tooltip';
            tip.innerHTML = `<b>⚠️ Sensitive data detected.</b><br>This page can read your input. Mask it with ChatWall.`;
            Object.assign(tip.style, {
                position: 'absolute', bottom: 'calc(100% + 8px)', right: '0',
                background: '#1e293b', color: 'white',
                padding: '8px 12px', borderRadius: '6px',
                fontSize: '12px', lineHeight: '1.4', width: '220px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                pointerEvents: 'none', opacity: '0',
                transition: 'opacity 0.15s', zIndex: '2147483648',
                fontFamily: 'system-ui, sans-serif', textAlign: 'center',
                whiteSpace: 'normal',
            });
            reopenBadge.appendChild(tip);
            reopenBadge.addEventListener('mouseenter', () => { tip.style.opacity = '1'; });
            reopenBadge.addEventListener('mouseleave', () => { tip.style.opacity = '0'; });
        }
    } else {
        reopenBadge.style.border = '1px solid rgba(99,102,241,0.50)';
        reopenBadge.style.boxShadow = '0 4px 16px rgba(0,0,0,0.35)';
        const warn = reopenBadge.querySelector('.cw-badge-warn');
        if (warn) warn.remove();
        const tip = reopenBadge.querySelector('.cw-badge-tooltip');
        if (tip) tip.remove();
    }
}

function showReopenBadge(nativeEl) {
    hideReopenBadge();
    const badge = document.createElement('div');
    badge.id = 'cw-reopen-badge';
    Object.assign(badge.style, {
        position: 'fixed', zIndex: '2147483640',
        display: 'flex', alignItems: 'center', gap: '6px',
        background: 'rgba(30,41,59,0.92)',
        border: '1px solid rgba(148,163,184,0.30)',
        borderRadius: '20px', padding: '5px 12px 5px 8px',
        cursor: 'pointer', color: '#e2e8f0',
        fontFamily: 'system-ui,sans-serif', fontSize: '12px', fontWeight: '600',
        backdropFilter: 'blur(8px)', boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        userSelect: 'none', whiteSpace: 'nowrap',
        opacity: '0.88', transition: 'opacity 0.15s, background 0.15s',
        pointerEvents: 'auto',
    });
    badge.innerHTML = `<img src="${chrome.runtime.getURL('logo.svg')}" style="width:16px;height:16px;object-fit:contain;vertical-align:middle;flex-shrink:0">&nbsp;Mask with ChatWall`;
    badge.addEventListener('mouseenter', () => { badge.style.opacity = '1'; badge.style.background = 'rgba(30,41,59,1.0)'; badge.style.borderColor = 'rgba(148,163,184,0.55)'; });
    badge.addEventListener('mouseleave', () => { badge.style.opacity = '0.88'; badge.style.background = 'rgba(30,41,59,0.92)'; badge.style.borderColor = 'rgba(148,163,184,0.30)'; });
    badge.addEventListener('click', (e) => {
        e.stopPropagation();
        hideReopenBadge();
        forceOverlayOpen = true;
        // Always re-locate the input: SPA chat apps (ChatGPT, DeepSeek…)
        // replace or hide the old input when navigating between chats,
        // leaving the closure's nativeEl stale (detached or zero-sized).
        let target = nativeEl;
        const rect = nativeEl.getBoundingClientRect();
        const isStale = !document.body.contains(nativeEl) || rect.width === 0;
        if (isStale) {
            const fresh = findMainInput();
            if (fresh) target = fresh;
        }
        showInputOverlay(target);
    });
    reopenBadge = badge;
    reopenBadgeNative = nativeEl;
    document.body.appendChild(badge);
    positionReopenBadge();

    // ─ Risk analysis: apply warning if already detected by the shared pipeline ──
    // The typing/input events call analyzeContentRisk() → updateButtonState() →
    // updateReopenBadgeRisk(), which keeps this badge in sync automatically.
    // On creation, apply the current state immediately.
    if (!document.getElementById('chatwall-float-style')) injectFloatStyles();
    // Only apply risk visuals if there is actual risk — don't warn on clean inputs.
    if (lastRiskAnalysis) updateReopenBadgeRisk(true);
    else updateReopenBadgeRisk(false);

    // ─ ResizeObserver: reposition when input grows/shrinks (user typing, framework resize)
    reopenBadgeResizeObs = new ResizeObserver(() => positionReopenBadge());
    reopenBadgeResizeObs.observe(nativeEl);
    if (nativeEl.parentElement) reopenBadgeResizeObs.observe(nativeEl.parentElement);

    // ─ Continuous sync interval: catches all position changes regardless of source
    // (page scroll, inner container scroll, ChatGPT layout shifts, overlay resize, etc.)
    reopenBadgeSyncInterval = setInterval(positionReopenBadge, 100);

    // ─ Scroll: reposition immediately on scroll events (supplements interval)
    reopenBadgeScrollFn = () => positionReopenBadge();
    window.addEventListener('scroll', reopenBadgeScrollFn, { passive: true, capture: true });
    // Also listen on scrollable ancestors (e.g. ChatGPT's inner scroll container)
    reopenBadgeScrollAncestors = [];
    let _anc = nativeEl.parentElement;
    while (_anc && _anc !== document.body) {
        const _st = window.getComputedStyle(_anc);
        if (/auto|scroll/.test(_st.overflow + _st.overflowY)) {
            _anc.addEventListener('scroll', reopenBadgeScrollFn, { passive: true, capture: true });
            reopenBadgeScrollAncestors.push(_anc);
        }
        _anc = _anc.parentElement;
    }

    // ─ MutationObserver: catch framework-driven content resets (React post-send)
    //   that don't fire 'input' events. Also catches attribute/style changes that
    //   can shift the element without triggering ResizeObserver.
    // Track whether the input was already empty when the badge was first shown.
    // If it was, we must NOT auto-hide when it stays empty — this fixes ChatGPT's
    // contenteditable which repeatedly mutates even when blank, hiding the badge
    // before the user can click it.
    const _badgeInitialContent = typeof nativeEl.value === 'string'
        ? nativeEl.value.trim()
        : (nativeEl.innerText || '').trim();
    const _badgeInitEmpty = !_badgeInitialContent;

    reopenBadgeMutObs = new MutationObserver(() => {
        const nEl = reopenBadgeNative;
        if (!nEl) return;
        positionReopenBadge();
        const empty = typeof nEl.value === 'string'
            ? !nEl.value.trim()
            : !(nEl.innerText || '').trim();
        // Only auto-hide when content was cleared AFTER having content
        // (e.g. user sent a message). Never hide for inputs that started empty.
        if (empty && !_badgeInitEmpty) hideReopenBadge();
    });
    reopenBadgeMutObs.observe(nativeEl, {
        characterData: true, childList: true, subtree: true,
        attributes: true, attributeFilter: ['style', 'class'],
    });
    // Also watch parent for React element replacement (whole input node swapped)
    if (nativeEl.parentElement) {
        reopenBadgeMutObs.observe(nativeEl.parentElement, { childList: true });
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

function showInputOverlay(nativeEl) {
    if (!nativeEl) return;
    if (cwInputMode !== 'integrated' && cwInputMode !== 'both') return;
    if (justSent && !forceOverlayOpen) return;  // badge click bypasses this

    // Hide badge — we are about to open the overlay
    hideReopenBadge();

    // Badge-first UX: show re-open badge unless Always-On is enabled or the
    // badge was explicitly clicked (forceOverlayOpen).
    if (!forceOverlayOpen && !intAlwaysOn) {
        // Don't recreate badge if it's already showing for this same element
        if (reopenBadgeNative !== nativeEl) {
            showReopenBadge(nativeEl);
        }
        return;
    }
    forceOverlayOpen = false;  // consume the flag

    // Hide any floating ChatWall buttons — they must not appear on top of the overlay
    if (typeof hideAllFloatButtons === 'function') hideAllFloatButtons();

    if (inputOverlayIsOpen && inputOverlayNativeEl === nativeEl) {
        if (inputOverlayInputText) inputOverlayInputText.focus();
        return;
    }
    if (inputOverlayIsOpen && inputOverlayNativeEl !== nativeEl) {
        // Check if this is a React/framework element-replacement (same visual input,
        // different JS object reference) vs a genuinely different input field.
        const oldInDOM = document.body.contains(inputOverlayNativeEl);
        let adopt = !oldInDOM; // detached → always adopt
        if (!adopt && oldInDOM) {
            // Both in DOM simultaneously (brief React reconcile window).
            // Treat as the same input if they share the same screen position.
            const oR = inputOverlayNativeEl.getBoundingClientRect();
            const nR = nativeEl.getBoundingClientRect();
            adopt = Math.abs(oR.left - nR.left) < 4 && Math.abs(oR.top - nR.top) < 4;
        }
        if (adopt) {
            // Silently update our reference to the new element without closing.
            inputOverlayNativeEl = nativeEl;
            nativeEl.style.opacity = '0';
            nativeEl.style.pointerEvents = 'none';
            nativeEl.style.caretColor = 'transparent';
            if (inputOverlayTargetObserver) {
                inputOverlayTargetObserver.disconnect();
                inputOverlayTargetObserver = new ResizeObserver(positionInputOverlay);
                inputOverlayTargetObserver.observe(nativeEl);
                if (nativeEl.parentElement) inputOverlayTargetObserver.observe(nativeEl.parentElement);
            }
            if (inputOverlayInputText) inputOverlayInputText.focus();
            return;
        }
        // Genuinely different input — close current overlay, fall through to open new.
        hideInputOverlay(false);
    }


    // Sync plan from storage — ensures USER_PLAN is up-to-date for the
    // integrated overlay (the full overlay already calls this on open).
    if (typeof syncUserPlan === 'function') syncUserPlan();

    overlayOpenTime = Date.now();
    // Seed from global state so words masked/favorited in full overlay carry over
    inputCustomWords = new Set(manualBlockList);
    if (typeof favoritesList !== 'undefined') {
        favoritesList.forEach(w => inputCustomWords.add(w));
    }
    inputIgnoredWords = new Set(typeof ignoredEntities !== 'undefined' ? ignoredEntities : []);
    inputOverlayNativeEl = nativeEl;
    inputOverlayIsOpen = true;
    inputOverlayActiveTool = null;
    // Always re-activate ctx (resets cachedNlpMatches etc.) for a fresh session.
    // If the shadow is not yet built, activateIntOverlayCtx will be called later
    // from buildInputOverlayShadow once the HTML fetch completes.
    if (inputOverlayInputText) {
        activateIntOverlayCtx(
            inputOverlayShadowRoot, inputOverlayInputText, inputOverlayHighlights,
            inputCustomWords, inputIgnoredWords, inputOverlayOutputText
        );
    }

    buildInputOverlayShadow();

    // Initial size = native textarea height (overlay never starts bigger than native).
    // Inject enough blank lines to give the editor comfortable headroom:
    // topbar (30px) + ~4 lines of text so the editor area isn't cramped.
    const rect = nativeEl.getBoundingClientRect();
    const COMFORTABLE_EDITOR_H = TOPBAR_HEIGHT + 80; // topbar (30px) + ~4 text lines

    // lockedMinHeight = comfortable target so contentDesiredH in autoResize
    // starts at this height, matching the initially injected native height.
    // This prevents the 1-line-flash where overlay stays tiny until ResizeObserver fires.
    lockedMinHeight = Math.max(COMFORTABLE_EDITOR_H, rect.height);

    const initH = lockedMinHeight;  // overlay opens at comfortable embedded height
    const spaceBelow = window.innerHeight - rect.top - 6;
    const spaceAbove = rect.bottom - 6;
    const initTop = (spaceBelow >= spaceAbove) ? rect.top : Math.max(6, rect.bottom - initH);
    Object.assign(inputOverlayContainer.style, {
        top: Math.max(6, initTop) + 'px',
        left: rect.left + 'px',
        width: rect.width + 'px',
        height: initH + 'px',
    });

    // Hide native FIRST — before injecting blank lines — so the lines are never
    // briefly visible to the user (prevents the "white lines flash" on overlay open).
    nativeEl.style.opacity = '0';
    nativeEl.style.pointerEvents = 'none';
    nativeEl.style.caretColor = 'transparent';

    // Inject lines so native grows to accommodate topbar + comfortable edit area.
    // ResizeObserver will fire and grow the overlay to match the new native height.
    nativeOriginalContent = extractTextFromElement(nativeEl);
    const lineH = Math.max(parseFloat(getComputedStyle(nativeEl).lineHeight) || 20, 16);
    const extraLines = Math.ceil(COMFORTABLE_EDITOR_H / lineH) + 1;
    const injectedContent = nativeOriginalContent + '\n'.repeat(extraLines);
    try {
        if (typeof nativeEl.value === 'string') {
            nativeEl.value = injectedContent;
        } else if (nativeEl.isContentEditable) {
            nativeEl.innerText = injectedContent;
        }
        nativeEl.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: '', bubbles: true }));
    } catch (_) { /* non-fatal */ }

    // ── Modal backdrop: block all page interaction while overlay is open ────────
    inputOverlayBackdrop = document.createElement('div');
    inputOverlayBackdrop.id = 'cw-modal-backdrop';
    Object.assign(inputOverlayBackdrop.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483640',   // just below overlay container (2147483646)
        background: 'rgba(0,0,0,0.35)',
        cursor: 'default',
    });
    // Swallow all pointer events so page content is unreachable
    inputOverlayBackdrop.addEventListener('click', e => e.stopPropagation());
    inputOverlayBackdrop.addEventListener('mousedown', e => e.stopPropagation());
    inputOverlayBackdrop.addEventListener('mouseup', e => e.stopPropagation());
    inputOverlayBackdrop.addEventListener('pointerdown', e => e.stopPropagation());
    document.body.appendChild(inputOverlayBackdrop);
    document.body.appendChild(inputOverlayContainer);

    // Injection dispatches an InputEvent; the host site (React/Lit/etc.) may
    // process it asynchronously, causing the native element to reflow after
    // multiple paint cycles. Schedule repositions at increasing intervals to
    // ensure the overlay snaps to the correct position as soon as each reflow lands.
    requestAnimationFrame(() => {
        if (inputOverlayIsOpen) positionInputOverlay();
        requestAnimationFrame(() => {
            if (inputOverlayIsOpen) positionInputOverlay();
        });
    });
    setTimeout(() => { if (inputOverlayIsOpen) positionInputOverlay(); }, 80);
    setTimeout(() => { if (inputOverlayIsOpen) positionInputOverlay(); }, 250);

    // Seed from nativeOriginalContent (saved BEFORE newline injection) so the
    // overlay gets the real user text, not the injected blank lines.
    const rawSeed = nativeOriginalContent;
    unmaskTokens(rawSeed).then(seedText => {
        if (!inputOverlayInputText) {
            // Shadow DOM not ready yet (first open — fetch still in progress).
            // Stash the text; buildInputOverlayShadow will apply it once ready.
            _pendingSeedText = seedText;
            return;
        }
        inputOverlayInputText.value = seedText;
        renderRaw(inputOverlayHighlights, seedText);
        if (seedText) {
            autoResize(inputOverlayInputText, inputOverlayHighlights);
            processText(true);
            requestAnimationFrame(updateWarnBar);
        }
        setTimeout(() => { if (inputOverlayInputText) inputOverlayInputText.focus(); }, 30);
    });

    // Track native resize / page scroll
    if (inputOverlayTargetObserver) inputOverlayTargetObserver.disconnect();
    inputOverlayTargetObserver = new ResizeObserver(positionInputOverlay);
    inputOverlayTargetObserver.observe(nativeEl);
    if (nativeEl.parentElement) inputOverlayTargetObserver.observe(nativeEl.parentElement);

    const onScroll = () => positionInputOverlay();
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    inputOverlayScrollCleanup = () => window.removeEventListener('scroll', onScroll, { capture: true });
}

function hideInputOverlay(commit) {
    deactivateIntOverlayCtx();
    if (!inputOverlayIsOpen) return;
    const nativeEl = inputOverlayNativeEl;  // capture before we null it below
    inputOverlayIsOpen = false;
    clearTimeout(inputOverlayTypingTimer);

    if (commit) {
        _commitInputOverlayToNative(true);
    } else if (inputOverlayNativeEl) {
        // Restore original content (remove injected newlines) before revealing
        try {
            if (typeof inputOverlayNativeEl.value === 'string') {
                inputOverlayNativeEl.value = nativeOriginalContent;
            } else if (inputOverlayNativeEl.isContentEditable) {
                inputOverlayNativeEl.innerText = nativeOriginalContent;
            }
            inputOverlayNativeEl.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: '', bubbles: true }));
        } catch (_) { /* non-fatal */ }
        inputOverlayNativeEl.style.opacity = '';
        inputOverlayNativeEl.style.pointerEvents = '';
        inputOverlayNativeEl.style.caretColor = '';
    }
    lockedMinHeight = 0;
    userResizedHeight = 0;
    userResizedWidth = 0;
    nativeOriginalContent = '';
    nativeMaxHeight = 0;
    nativeResists = false;

    if (inputOverlayBackdrop && inputOverlayBackdrop.parentNode)
        inputOverlayBackdrop.parentNode.removeChild(inputOverlayBackdrop);
    inputOverlayBackdrop = null;
    if (inputOverlayContainer && inputOverlayContainer.parentNode)
        inputOverlayContainer.parentNode.removeChild(inputOverlayContainer);

    if (inputOverlayTargetObserver) { inputOverlayTargetObserver.disconnect(); inputOverlayTargetObserver = null; }
    if (inputOverlayScrollCleanup) { inputOverlayScrollCleanup(); inputOverlayScrollCleanup = null; }

    inputOverlayNativeEl = null;
    inputOverlayActiveTool = null;
    inputOverlayMatches = [];

    // Show badge if native still has content so user can re-open overlay on demand
    if (nativeEl) {
        const remainingContent = extractTextFromElement(nativeEl).trim();
        if (remainingContent) showReopenBadge(nativeEl);
    }
}

/**
 * Called by sendToLLM (full overlay) when the integrated overlay is also open.
 * Closes the integrated overlay UI WITHOUT writing anything to the native element
 * (sendToLLM has already put the correct masked content there).
 * Sets justSent so re-focus doesn't immediately re-open the overlay.
 */
function dismissInputOverlayAfterSend() {
    if (!inputOverlayIsOpen) return;
    inputOverlayIsOpen = false;
    clearTimeout(inputOverlayTypingTimer);

    // Restore native visibility (it was hidden by the integrated overlay)
    if (inputOverlayNativeEl) {
        inputOverlayNativeEl.style.opacity = '';
        inputOverlayNativeEl.style.pointerEvents = '';
        inputOverlayNativeEl.style.caretColor = '';
        // DO NOT write any content — sendToLLM already set the correct masked text
    }
    lockedMinHeight = 0;
    userResizedHeight = 0;
    userResizedWidth = 0;
    nativeOriginalContent = '';
    nativeMaxHeight = 0;
    nativeResists = false;
    refreshFavBtnFn = null;

    const nativeEl = inputOverlayNativeEl;

    if (inputOverlayBackdrop && inputOverlayBackdrop.parentNode)
        inputOverlayBackdrop.parentNode.removeChild(inputOverlayBackdrop);
    inputOverlayBackdrop = null;
    if (inputOverlayContainer && inputOverlayContainer.parentNode)
        inputOverlayContainer.parentNode.removeChild(inputOverlayContainer);

    if (inputOverlayTargetObserver) { inputOverlayTargetObserver.disconnect(); inputOverlayTargetObserver = null; }
    if (inputOverlayScrollCleanup) { inputOverlayScrollCleanup(); inputOverlayScrollCleanup = null; }

    inputOverlayNativeEl = null;
    inputOverlayActiveTool = null;
    inputOverlayMatches = [];

    // Prevent immediate re-open when the native element regains focus
    justSent = true;
    setTimeout(() => { justSent = false; }, 800);

    // Show badge so user can re-open the overlay to edit the masked content
    if (nativeEl) showReopenBadge(nativeEl);
}

// ─── Click-outside: disabled in modal mode (backdrop blocks page clicks) ──────
// The backdrop swallows all outside clicks, so this handler only fires for
// clicks that pass through the shadow host or the mode-menu — both of which
// should be allowed to proceed without closing the overlay.
document.addEventListener('click', (e) => {
    if (!inputOverlayIsOpen) return;
    if (Date.now() - overlayOpenTime < 350) return;      // guard same-click close
    if (!inputOverlayContainer) return;
    if (inputOverlayContainer.contains(e.target)) return;
    if (inputOverlayNativeEl && inputOverlayNativeEl.contains(e.target)) return;
    if (cwModeMenuEl && cwModeMenuEl.contains(e.target)) return;
    // In modal mode don't close on outside clicks (backdrop blocks them anyway)
    // hideInputOverlay(false);
}, true);
