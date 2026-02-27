/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */
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

    // Cap text sent to SW to prevent catastrophic regex backtracking on huge inputs.
    // Sample beginning + end (most likely to contain PII like names, emails, signatures).
    const MAX_RISK_SCAN = 8000;
    let scanText = text;
    if (text.length > MAX_RISK_SCAN) {
        const half = Math.floor(MAX_RISK_SCAN / 2);
        scanText = text.substring(0, half) + text.substring(text.length - half);
    }

    try {
        chrome.runtime.sendMessage({
            action: 'ANALYZE_TEXT',
            text: scanText,
            offset: 0
        }, (response) => {
            if (chrome.runtime.lastError) return; // SW dead — silently fail
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
        img.src = chrome.runtime.getURL('logo.svg');
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
                const hasKnownTokens = (currentText.match(/\[[A-Z]+_[A-Z0-9]+\]/g) || []).some(t => tokenMap.hasOwnProperty(t));

                if (hasKnownTokens) {
                    // Response has masked tokens — show how-to-unmask popup
                    showUnmaskGuidePopup(floatBtn);
                    return;
                }

                lastRightClickedElement = currentFloatTarget;
                handleShowOverlay();
            }
        });
        floatBtn.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            showFloatHideHint(floatBtn);
        });
        document.body.appendChild(floatBtn);
    }

    if (!document.getElementById('chatwall-unmask-btn')) {
        unmaskBtn = document.createElement('div');
        unmaskBtn.id = 'chatwall-unmask-btn';
        unmaskBtn.className = 'cw-float-base';

        const imgUn = document.createElement('img');
        imgUn.src = chrome.runtime.getURL('logo.svg');
        imgUn.style.width = '28px'; imgUn.style.height = '28px'; imgUn.style.objectFit = 'contain'; imgUn.style.pointerEvents = 'none';
        unmaskBtn.appendChild(imgUn);

        unmaskBadge = document.createElement('div');
        unmaskBadge.className = 'cw-badge';
        unmaskBadge.style.display = 'block';
        unmaskBadge.innerHTML = GREEN_EYE_SVG;
        unmaskBtn.appendChild(unmaskBadge);

        unmaskBtn.addEventListener('mousedown', (e) => e.preventDefault());
        unmaskBtn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            showUnmaskGuidePopup(unmaskBtn);
        });
        unmaskBtn.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            showFloatHideHint(unmaskBtn);
        });
        document.body.appendChild(unmaskBtn);
    }
}

/**
 * Show a small "want to hide this button?" hint popup anchored below anchorEl.
 * Triggered by right-clicking either floating button.
 */
function showFloatHideHint(anchorEl) {
    const OLD = document.getElementById('cw-float-hint-popup');
    if (OLD) OLD.remove();

    const popup = document.createElement('div');
    popup.id = 'cw-float-hint-popup';
    Object.assign(popup.style, {
        position: 'fixed',
        zIndex: '2147483647',
        background: 'linear-gradient(135deg,#1e1b30,#2a2040)',
        border: '1px solid rgba(99,179,237,0.25)',
        borderRadius: '12px',
        padding: '14px 16px 12px',
        width: '230px',
        boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
        color: '#f1f5f9',
        fontFamily: 'system-ui,sans-serif',
        fontSize: '12px',
        lineHeight: '1.5',
    });

    popup.innerHTML = `
        <div style="font-weight:700;font-size:13px;color:#93c5fd;margin-bottom:6px;">
            🛡️ Want to hide this button?
        </div>
        <div style="color:rgba(255,255,255,0.7);margin-bottom:12px;">
            This button appears whenever ChatWall detects sensitive data in the input field.
            To <strong style="color:#e2e8f0;">switch mode</strong> (Integrated overlay, Full overlay, or Off)
            open <strong style="color:#e2e8f0;">ChatWall Settings</strong>.
        </div>
        <button id="cw-fhint-settings" style="display:block;width:100%;background:linear-gradient(90deg,#3b82f6,#6366f1);color:#fff;font-weight:700;font-size:12px;padding:7px 0;border-radius:7px;border:none;cursor:pointer;margin-bottom:7px;">
            ⚙️ Open Settings
        </button>
        <button id="cw-fhint-dismiss" style="background:none;border:none;color:rgba(255,255,255,0.38);font-size:11.5px;cursor:pointer;width:100%;padding:2px 0;">
            Dismiss
        </button>`;

    // Position below the anchor button
    const rect = anchorEl.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left - 90, window.innerWidth - 246));
    popup.style.top = (rect.bottom + 8) + 'px';
    popup.style.left = left + 'px';
    document.body.appendChild(popup);

    function closeHint() { if (popup.parentNode) popup.remove(); }

    popup.querySelector('#cw-fhint-settings').addEventListener('click', () => {
        closeHint();
        if (typeof window.cwOpenModeMenu === 'function') window.cwOpenModeMenu();
    });
    popup.querySelector('#cw-fhint-dismiss').addEventListener('click', closeHint);

    // Close on outside click
    setTimeout(() => {
        document.addEventListener('mousedown', function _h(e) {
            if (!popup.contains(e.target)) { closeHint(); document.removeEventListener('mousedown', _h); }
        });
    }, 10);
}

/** Returns true when the full overlay or the integrated overlay is open. */
function anyOverlayOpen() {
    const fullOpen = typeof overlayContainer !== 'undefined' &&
        overlayContainer && overlayContainer.style.display !== 'none';
    const intOpen = typeof inputOverlayIsOpen !== 'undefined' && inputOverlayIsOpen;
    return fullOpen || intOpen;
}

/** Immediately hide all floating ChatWall buttons. Called when any overlay opens. */
function hideAllFloatButtons() {
    const fb = document.getElementById('chatwall-float-btn');
    if (fb) fb.style.display = 'none';
    const ub = document.getElementById('chatwall-unmask-btn');
    if (ub) ub.style.display = 'none';
    if (floatHideTimer) { clearTimeout(floatHideTimer); floatHideTimer = null; }
    if (typeof decisionPopup !== 'undefined' && decisionPopup) {
        decisionPopup.remove(); decisionPopup = null;
    }
}

function showFloatButton(target) {
    if (anyOverlayOpen()) return;           // never on top of an open overlay
    if (cwInputMode !== 'float') return;       // Only show in pure float mode
    if (floatHideTimer) clearTimeout(floatHideTimer);

    createFloatingButton();
    currentFloatTarget = target;
    activeTarget = target;
    currentFloatAnchor = getVisualAnchor(target);

    const rect = currentFloatAnchor.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const top = rect.top + window.scrollY - 50;
    const left = rect.right + window.scrollX - 50;

    // Avoid overlapping the reopen badge (Open ChatWall pill)
    const _badge = document.getElementById('cw-reopen-badge');
    let _fbLeft = left;
    if (_badge && _badge.style.display !== 'none') {
        const _br = _badge.getBoundingClientRect();
        const _btnRight = left + 44;
        if (_btnRight > _br.left && top < _br.bottom + window.scrollY && top + 44 > _br.top + window.scrollY) {
            // Shift float button left enough to avoid the badge
            _fbLeft = _br.left + window.scrollX - 54;
        }
    }
    floatBtn.style.top = `${top}px`;
    floatBtn.style.left = `${_fbLeft}px`;
    floatBtn.style.display = 'flex';

    analyzeContentRisk(target);
}

function hideFloatButton() {
    if (cwInputMode === 'integrated') return;
    floatHideTimer = setTimeout(() => {
        if (floatBtn) floatBtn.style.display = 'none';
        currentFloatTarget = null;
    }, 200);
}

function showUnmaskButton(target) {
    if (anyOverlayOpen()) return;           // never on top of an open overlay
    createFloatingButton();
    currentUnmaskTarget = target;
    currentUnmaskAnchor = getVisualAnchor(target);

    if (!document.body.contains(target)) return;
    updateUnmaskPosition(target);
}

function updateUnmaskPosition(targetBtn) {
    if (!unmaskBtn) return;

    // ── Prefer to anchor next to the reopen badge ────────────────────────────
    const badge = document.getElementById('cw-reopen-badge');
    if (badge && badge.style.display !== 'none') {
        const br = badge.getBoundingClientRect();
        if (br.width > 0) {
            const GAP = 8; // gap between badge right edge and unmask button
            unmaskBtn.style.top = (br.top + window.scrollY + (br.height - 44) / 2) + 'px';
            unmaskBtn.style.left = (br.right + window.scrollX + GAP) + 'px';
            unmaskBtn.style.display = 'flex';
            return;
        }
    }

    // ── Fallback: position relative to the input anchor ──────────────────────
    let anchor = currentFloatAnchor;
    if (!anchor) {
        const input = findMainInput();
        if (input) anchor = getVisualAnchor(input);
    }
    if (!anchor) return;
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
    if (hasRisk === lastRiskAnalysis) return;
    lastRiskAnalysis = hasRisk;

    // Update float button (editor mode)
    if (floatBtn) {
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

    // Update reopen badge (integrated mode) — same warning visuals
    if (typeof updateReopenBadgeRisk === 'function') {
        updateReopenBadgeRisk(hasRisk);
    }
}


/**
 * Show a "How to unmask" explanation popup (closed shadow DOM).
 * Explains the 3 ways to reveal masked tokens in AI responses.
 */
function showUnmaskGuidePopup(anchorBtn) {
    const OLD = document.getElementById('cw-unmask-guide-host');
    if (OLD) OLD.remove();

    const host = document.createElement('div');
    host.id = 'cw-unmask-guide-host';
    host.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:auto;';

    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
        :host { display: block; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .popup {
            background: linear-gradient(180deg, #13111f 0%, #0f0e1a 100%);
            border: 1px solid rgba(99,102,241,0.2);
            border-radius: 16px;
            width: 320px;
            box-shadow: 0 24px 60px rgba(0,0,0,0.7), 0 4px 16px rgba(99,102,241,0.08);
            color: #e2e8f0;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 12px;
            line-height: 1.5;
            overflow: hidden;
        }
        .popup-header {
            background: linear-gradient(135deg, rgba(99,102,241,0.18), rgba(139,92,246,0.1));
            border-bottom: 1px solid rgba(255,255,255,0.06);
            padding: 14px 16px 12px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .popup-header .shield {
            width: 32px;
            height: 32px;
            background: linear-gradient(135deg, rgba(99,102,241,0.3), rgba(139,92,246,0.2));
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            flex-shrink: 0;
        }
        .popup-header-text {
            flex: 1;
        }
        .popup-header-title {
            font-size: 14px;
            font-weight: 700;
            color: #e0e7ff;
            letter-spacing: -0.01em;
        }
        .popup-header-sub {
            font-size: 10.5px;
            color: rgba(255,255,255,0.35);
            margin-top: 2px;
        }
        .methods {
            padding: 12px 12px 8px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .method {
            display: flex;
            gap: 12px;
            align-items: center;
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 12px;
            padding: 12px;
            transition: background 0.15s, border-color 0.15s;
            cursor: default;
        }
        .method:hover {
            background: rgba(99,102,241,0.06);
            border-color: rgba(99,102,241,0.15);
        }
        .method-icon {
            flex-shrink: 0;
            width: 36px;
            height: 36px;
            background: rgba(99,102,241,0.12);
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #a5b4fc;
        }
        .method-icon svg {
            width: 18px;
            height: 18px;
        }
        .method-content {
            flex: 1;
            min-width: 0;
        }
        .method-title {
            font-size: 12.5px;
            font-weight: 700;
            color: #e2e8f0;
            line-height: 1.3;
        }
        .method-desc {
            font-size: 10.5px;
            color: rgba(255,255,255,0.4);
            margin-top: 2px;
            line-height: 1.4;
        }
        .method-desc em {
            font-style: normal;
            color: #a5b4fc;
            font-weight: 600;
        }
        .method-step {
            flex-shrink: 0;
            width: 18px;
            height: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(99,102,241,0.2);
            color: #a5b4fc;
            font-size: 9px;
            font-weight: 800;
            border-radius: 50%;
        }
        .popup-footer {
            padding: 8px 12px 12px;
            border-top: 1px solid rgba(255,255,255,0.05);
        }
        .btn-dismiss {
            display: block;
            width: 100%;
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.2);
            color: rgba(165,180,252,0.8);
            font-size: 11.5px;
            font-weight: 600;
            cursor: pointer;
            border-radius: 8px;
            padding: 7px 0;
            font-family: inherit;
            transition: all 0.15s;
        }
        .btn-dismiss:hover {
            background: rgba(99,102,241,0.2);
            border-color: rgba(99,102,241,0.35);
            color: #c7d2fe;
        }
        .btn-action {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
            background: linear-gradient(135deg, rgba(34,197,94,0.18), rgba(16,185,129,0.12));
            border: 1px solid rgba(34,197,94,0.35);
            color: rgba(134,239,172,0.9);
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            border-radius: 8px;
            padding: 9px 0;
            font-family: inherit;
            transition: all 0.15s;
            margin-bottom: 6px;
        }
        .btn-action:hover {
            background: linear-gradient(135deg, rgba(34,197,94,0.28), rgba(16,185,129,0.22));
            border-color: rgba(34,197,94,0.6);
            color: #86efac;
        }
    `;

    // ── Icon SVGs (Lucide-style) ────────────────────────────────────────
    const icCopy = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>`;

    const icSelect = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 7V4h3"/><path d="M20 7V4h-3"/><path d="M4 17v3h3"/><path d="M20 17v3h-3"/>
        <rect x="7" y="9" width="10" height="6" rx="1" fill="rgba(99,102,241,0.2)" stroke="rgba(99,102,241,0.6)"/>
    </svg>`;

    const icEye = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
    </svg>`;

    const popup = document.createElement('div');
    popup.className = 'popup';
    popup.innerHTML = `
        <div class="popup-header">
            <div class="shield">🛡️</div>
            <div class="popup-header-text">
                <div class="popup-header-title">How to unmask responses</div>
                <div class="popup-header-sub">3 ways to reveal your original content</div>
            </div>
        </div>
        <div class="methods">
            <div class="method">
                <div class="method-icon">${icCopy}</div>
                <div class="method-content">
                    <div class="method-title">Right-click a Copy button</div>
                    <div class="method-desc">Choose <em>Unmask & Preview</em> or <em>Unmask & Copy</em></div>
                </div>
                <div class="method-step">1</div>
            </div>
            <div class="method">
                <div class="method-icon">${icSelect}</div>
                <div class="method-content">
                    <div class="method-title">Select text → Right-click</div>
                    <div class="method-desc">Pick <em>ChatWall → Unmask</em> from context menu</div>
                </div>
                <div class="method-step">2</div>
            </div>
        </div>
        <div class="popup-footer">
            <button class="btn-action" id="guide-unmask-copy">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;flex-shrink:0">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Unmask &amp; Copy last response
            </button>
            <button class="btn-dismiss" id="guide-dismiss">Got it</button>
        </div>
    `;

    shadow.appendChild(style);
    shadow.appendChild(popup);
    document.body.appendChild(host);

    // Position near anchor — prefer above, fall back to below
    const rect = anchorBtn.getBoundingClientRect();
    const popW = 320, popH = 300;
    const left = Math.max(8, Math.min(rect.right - popW, window.innerWidth - popW - 8));
    let top = rect.top - popH - 8 + window.scrollY;
    if (top < window.scrollY + 8) top = rect.bottom + 8 + window.scrollY;
    host.style.top = top + 'px';
    host.style.left = left + 'px';

    function close() { if (host.parentNode) host.remove(); }

    shadow.getElementById('guide-dismiss').addEventListener('click', close);
    shadow.getElementById('guide-unmask-copy').addEventListener('click', () => {
        close();
        if (typeof handleDeanonymizeAndCopy === 'function') handleDeanonymizeAndCopy(anchorBtn);
    });
    setTimeout(() => {
        document.addEventListener('mousedown', function _h(ev) {
            if (!host.contains(ev.target)) { close(); document.removeEventListener('mousedown', _h); }
        });
    }, 10);
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
