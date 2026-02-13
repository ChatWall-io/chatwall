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
