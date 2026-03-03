/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */
// --- MODE MENU (Center-Top Round Button) ---
// Global ChatWall launcher: mode switcher + overlay + license + help

const CW_MODE_KEY = 'chatwall_input_mode';

// ─── Apply Mode ───────────────────────────────────────────────────────────────
// cwInputMode: 'none' | 'float' | 'integrated' | 'both'

function applyMode(mode) {
    cwInputMode = mode;
    const floatOn = mode === 'float' || mode === 'both';
    const inteOn = mode === 'integrated' || mode === 'both';

    // Float button visibility
    if (floatOn) {
        if (currentFloatTarget && floatBtn) floatBtn.style.display = 'flex';
    } else {
        if (floatBtn) floatBtn.style.display = 'none';
        if (unmaskBtn) unmaskBtn.style.display = 'none';
    }

    // Integrated overlay
    if (inteOn) {
        const activeEl = document.activeElement;
        if (activeEl) {
            const editable = getEditableTarget(activeEl);
            if (editable && typeof showInputOverlay === 'function') showInputOverlay(editable);
        }
    } else {
        if (typeof hideInputOverlay === 'function') hideInputOverlay(false);
        if (typeof hideReopenBadge === 'function') hideReopenBadge();
    }

    updateModeMenuUI();
}

function saveModePreference(mode) {
    chrome.storage.local.set({ [CW_MODE_KEY]: mode });
}

function loadModePreference() {
    chrome.storage.local.get([CW_MODE_KEY], (data) => {
        const saved = data[CW_MODE_KEY];
        if (['integrated', 'float', 'none', 'both'].includes(saved)) {
            applyMode(saved);
        } else {
            // New users: both Inline Masking and Editor Masking enabled by default
            applyMode('both');
            saveModePreference('both');
        }
    });
}

// ─── UI Sync ─────────────────────────────────────────────────────────────────

function updateModeMenuUI() {
    if (!cwModeMenuEl) return;
    const floatItem = cwModeMenuEl.querySelector('#cw-mode-float');
    const inteItem = cwModeMenuEl.querySelector('#cw-mode-integrated');
    const floatOn = cwInputMode === 'float' || cwInputMode === 'both';
    const inteOn = cwInputMode === 'integrated' || cwInputMode === 'both';
    if (floatItem) floatItem.setAttribute('data-active', floatOn ? 'true' : 'false');
    if (inteItem) inteItem.setAttribute('data-active', inteOn ? 'true' : 'false');
    // Button dims when neither mode is active
    const modeBtn = cwModeMenuEl.querySelector('#cw-mode-btn');
    if (modeBtn) modeBtn.style.opacity = (!cwInputMode || cwInputMode === 'none') ? '0.35' : '0.6';
}

// ─── Widget ──────────────────────────────────────────────────────────────────

function createModeMenu() {
    if (cwModeMenuEl) return;

    const logoUrl = chrome.runtime.getURL('logo.svg');
    const ver = (typeof ChatWallConfig !== 'undefined' && ChatWallConfig.VERSION) ? ChatWallConfig.VERSION : '';

    // ── Host ────────────────────────────────────────────────────────────────
    const host = document.createElement('div');
    host.id = 'cw-mode-menu';
    Object.assign(host.style, {
        position: 'fixed',
        top: '0',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '2147483647',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        userSelect: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
    });

    ['click', 'mousedown', 'mouseup', 'keydown', 'keyup'].forEach(evt =>
        host.addEventListener(evt, e => e.stopPropagation())
    );

    // ── Trigger button ───────────────────────────────────────────────────────
    const btn = document.createElement('button');
    btn.id = 'cw-mode-btn';
    btn.title = 'ChatWall';
    btn.type = 'button';
    Object.assign(btn.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        background: 'rgba(52,52,56,0.88)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        color: 'rgba(255,255,255,0.85)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderTop: 'none',
        borderRadius: '0 0 20px 20px',
        padding: '3px 14px 5px',
        cursor: 'pointer',
        fontSize: '12px',
        fontWeight: '700',
        letterSpacing: '0.5px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        transition: 'background 0.15s, opacity 0.15s',
        opacity: '0.6',
        outline: 'none',
    });
    btn.onmouseenter = () => { btn.style.opacity = '1'; btn.style.background = 'rgba(62,62,68,0.98)'; };
    btn.onmouseleave = () => { btn.style.opacity = '0.6'; btn.style.background = 'rgba(52,52,56,0.88)'; };

    const btnImg = document.createElement('img');
    btnImg.src = logoUrl;
    btnImg.width = 14; btnImg.height = 14;
    btnImg.style.cssText = 'object-fit:contain;opacity:0.8;';
    btn.appendChild(btnImg);
    btn.appendChild(Object.assign(document.createElement('span'), { textContent: 'ChatWall' }));

    // ── Panel ────────────────────────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.id = 'cw-mode-panel';
    Object.assign(panel.style, {
        display: 'none',
        flexDirection: 'column',
        background: 'rgba(46,46,50,0.98)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '14px',
        padding: '8px 8px 6px',
        boxShadow: '0 12px 36px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2)',
        minWidth: '230px',
        marginTop: '6px',
        gap: '1px',
    });

    // ── Helpers ──────────────────────────────────────────────────────────────
    const mkSep = (label) => {
        const sep = document.createElement('div');
        Object.assign(sep.style, {
            padding: '6px 11px 3px',
            fontSize: '10px',
            fontWeight: '600',
            letterSpacing: '0.7px',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.32)',
            marginTop: '3px',
        });
        sep.textContent = label || '';
        return sep;
    };

    const mkHr = () => {
        const hr = document.createElement('hr');
        Object.assign(hr.style, { border: 'none', borderTop: '1px solid rgba(255,255,255,0.07)', margin: '5px 0' });
        return hr;
    };

    // SVG icon strings (Lucide-style, 18×18)
    const IC = {
        shield: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
        lock: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
        search: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
        user: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
        key: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="5"/><path d="M21 2l-9.4 9.4M17 6l2 2"/></svg>`,
        help: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
        file: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
        privacy: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>`,
        scale: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="3" x2="12" y2="21"/><path d="M3 9h18M3 9l3 6h6L3 9zM21 9l-4.5 6h-3L21 9"/></svg>`,
        zap: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    };

    const mkItem = (id, icon, label, sublabel, extraStyle) => {
        const item = document.createElement('div');
        item.id = id;
        Object.assign(item.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 11px',
            borderRadius: '9px',
            cursor: 'pointer',
            transition: 'background 0.12s',
            color: 'rgba(220,222,228,0.85)',
            ...extraStyle,
        });
        item.onmouseenter = () => item.style.background = 'rgba(255,255,255,0.09)';
        item.onmouseleave = () => item.style.background = '';

        const iconEl = document.createElement('div');
        iconEl.innerHTML = icon;
        Object.assign(iconEl.style, { width: '22px', textAlign: 'center', flexShrink: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: '0.7' });
        item.appendChild(iconEl);

        const wrap = document.createElement('div');
        Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '1px', flex: '1' });
        const titleEl = Object.assign(document.createElement('div'), { textContent: label });
        Object.assign(titleEl.style, { fontWeight: '600', fontSize: '13px', color: 'rgba(235,236,240,0.95)' });
        wrap.appendChild(titleEl);
        if (sublabel) {
            const subEl = Object.assign(document.createElement('div'), { textContent: sublabel });
            Object.assign(subEl.style, { fontSize: '11px', color: 'rgba(255,255,255,0.38)' });
            wrap.appendChild(subEl);
        }
        item.appendChild(wrap);
        return item;
    };

    // On/off toggle switch item for mode selection
    const mkToggle = (id, icon, label, sublabel) => {
        const item = document.createElement('div');
        item.id = id;
        item.setAttribute('data-active', 'false');
        Object.assign(item.style, {
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '8px 11px', borderRadius: '9px', cursor: 'pointer',
            transition: 'background 0.12s', color: 'rgba(220,222,228,0.85)',
        });
        item.onmouseenter = () => item.style.background = 'rgba(255,255,255,0.09)';
        item.onmouseleave = () => item.style.background = '';

        const iconEl = document.createElement('div');
        iconEl.innerHTML = icon;
        Object.assign(iconEl.style, { width: '22px', flexShrink: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: '0.7' });
        item.appendChild(iconEl);

        const wrap = document.createElement('div');
        Object.assign(wrap.style, { flex: '1', display: 'flex', flexDirection: 'column', gap: '1px' });
        const titleEl = Object.assign(document.createElement('div'), { textContent: label });
        Object.assign(titleEl.style, { fontWeight: '600', fontSize: '13px', color: 'rgba(235,236,240,0.95)' });
        wrap.appendChild(titleEl);
        if (sublabel) {
            const subEl = Object.assign(document.createElement('div'), { textContent: sublabel });
            Object.assign(subEl.style, { fontSize: '11px', color: 'rgba(255,255,255,0.38)' });
            wrap.appendChild(subEl);
        }
        item.appendChild(wrap);

        // Toggle switch
        const track = document.createElement('div');
        Object.assign(track.style, {
            flexShrink: '0', width: '32px', height: '18px', borderRadius: '9px',
            background: 'rgba(255,255,255,0.12)', position: 'relative',
            transition: 'background 0.2s', marginLeft: 'auto',
        });
        const knob = document.createElement('div');
        Object.assign(knob.style, {
            position: 'absolute', top: '2px', left: '2px',
            width: '14px', height: '14px', borderRadius: '50%',
            background: 'rgba(255,255,255,0.45)',
            transition: 'left 0.2s, background 0.2s',
        });
        track.appendChild(knob);
        item.appendChild(track);

        new MutationObserver(() => {
            const on = item.getAttribute('data-active') === 'true';
            track.style.background = on ? 'rgba(34,197,94,0.75)' : 'rgba(255,255,255,0.12)';
            knob.style.left = on ? '16px' : '2px';
            knob.style.background = on ? '#fff' : 'rgba(255,255,255,0.45)';
            iconEl.style.opacity = on ? '1' : '0.7';
        }).observe(item, { attributes: true, attributeFilter: ['data-active'] });

        return item;
    };

    // ── Mode section ─────────────────────────────────────────────────────────
    panel.appendChild(mkSep('Mode'));
    const floatItem = mkToggle('cw-mode-float', IC.shield, 'Editor Masking', 'Full masking editor');
    const inteItem = mkToggle('cw-mode-integrated', IC.lock, 'Inline Masking', 'Integrated inline overlay');
    // Independent toggles: each flips its own bit in the composite mode
    floatItem.onclick = () => {
        const floatOn = cwInputMode === 'float' || cwInputMode === 'both';
        const inteOn = cwInputMode === 'integrated' || cwInputMode === 'both';
        const next = floatOn
            ? (inteOn ? 'integrated' : 'none')
            : (inteOn ? 'both' : 'float');
        saveModePreference(next); applyMode(next);
    };
    inteItem.onclick = () => {
        const floatOn = cwInputMode === 'float' || cwInputMode === 'both';
        const inteOn = cwInputMode === 'integrated' || cwInputMode === 'both';
        const next = inteOn
            ? (floatOn ? 'float' : 'none')
            : (floatOn ? 'both' : 'integrated');
        saveModePreference(next); applyMode(next);
    };
    panel.appendChild(inteItem);
    panel.appendChild(floatItem);

    // ── Always-On sub-toggle (Inline Masking only) ────────────────────────────
    const alwaysOnItem = mkToggle('cw-mode-always-on', IC.zap, 'Always-On', 'Open overlay automatically on focus');
    alwaysOnItem.onclick = () => {
        chrome.storage.local.get('cwIntAlwaysOn', (r) => {
            const next = !r.cwIntAlwaysOn;
            chrome.storage.local.set({ cwIntAlwaysOn: next });
            alwaysOnItem.setAttribute('data-active', String(next));
            // Keep 13_input_overlay.js in sync (same content script scope)
            if (typeof intAlwaysOn !== 'undefined') intAlwaysOn = next;
        });
    };
    // Sync initial state from storage when panel is built
    chrome.storage.local.get('cwIntAlwaysOn', (r) => {
        alwaysOnItem.setAttribute('data-active', String(!!r.cwIntAlwaysOn));
    });
    panel.appendChild(alwaysOnItem);

    // ── Account section ──────────────────────────────────────────────────────
    panel.appendChild(mkHr());
    panel.appendChild(mkSep('Account'));
    const accountItem = mkItem('cw-account', IC.user, 'My Account', 'Sign in or manage');
    accountItem.onclick = () => {
        chrome.storage.local.get(['chatwall_id'], (d) => {
            const qs = d.chatwall_id ? `?id=${encodeURIComponent(d.chatwall_id)}` : '';
            window.open(`${CONFIG_API_URL}/login.html${qs}`, '_blank');
        });
        togglePanel(false);
    };
    panel.appendChild(accountItem);

    const licItem = mkItem('cw-license-toggle', IC.key, 'Enter License Key', 'Activate Premium');
    panel.appendChild(licItem);

    // Inline license form (hidden by default)
    const licForm = document.createElement('div');
    licForm.id = 'cw-license-form';
    Object.assign(licForm.style, {
        display: 'none',
        flexDirection: 'column',
        gap: '6px',
        padding: '2px 8px 8px',
    });

    const emailRow = document.createElement('div');
    Object.assign(emailRow.style, { display: 'flex', flexDirection: 'column', gap: '3px' });
    const emailLabel = Object.assign(document.createElement('label'), { textContent: 'Email', htmlFor: 'cw-lic-email' });
    Object.assign(emailLabel.style, { fontSize: '11px', color: 'rgba(255,255,255,0.4)', paddingLeft: '2px' });
    const emailInp = document.createElement('input');
    emailInp.id = 'cw-lic-email'; emailInp.type = 'email'; emailInp.placeholder = 'you@example.com';
    licInputStyle(emailInp);
    emailRow.appendChild(emailLabel); emailRow.appendChild(emailInp);

    const keyRow = document.createElement('div');
    Object.assign(keyRow.style, { display: 'flex', flexDirection: 'column', gap: '3px' });
    const keyLabel = Object.assign(document.createElement('label'), { textContent: 'License Key', htmlFor: 'cw-lic-key' });
    Object.assign(keyLabel.style, { fontSize: '11px', color: 'rgba(255,255,255,0.4)', paddingLeft: '2px' });
    const keyInp = document.createElement('input');
    keyInp.id = 'cw-lic-key'; keyInp.type = 'password'; keyInp.placeholder = 'CW-XXXX-XXXX-XXXX';
    licInputStyle(keyInp);

    // Eye toggle — reveal / hide key text
    const keyInputRow = document.createElement('div');
    Object.assign(keyInputRow.style, { position: 'relative', display: 'flex', alignItems: 'center' });
    const btnEye = document.createElement('button');
    btnEye.type = 'button';
    const EYE_OPEN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const EYE_CLOSED = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
    btnEye.innerHTML = EYE_OPEN;
    Object.assign(btnEye.style, {
        position: 'absolute', right: '7px', top: '50%', transform: 'translateY(-50%)',
        background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
        color: 'rgba(255,255,255,0.4)', lineHeight: '0', flexShrink: '0',
    });
    btnEye.onmouseenter = () => btnEye.style.color = 'rgba(255,255,255,0.8)';
    btnEye.onmouseleave = () => btnEye.style.color = 'rgba(255,255,255,0.4)';
    let _keyVisible = false;
    btnEye.addEventListener('click', (e) => {
        e.stopPropagation();
        _keyVisible = !_keyVisible;
        keyInp.type = _keyVisible ? 'text' : 'password';
        btnEye.innerHTML = _keyVisible ? EYE_CLOSED : EYE_OPEN;
    });
    keyInp.style.paddingRight = '28px'; // make room for eye icon
    keyInputRow.appendChild(keyInp);
    keyInputRow.appendChild(btnEye);

    keyRow.appendChild(keyLabel); keyRow.appendChild(keyInputRow);

    const statusEl = document.createElement('div');
    statusEl.id = 'cw-lic-status';
    Object.assign(statusEl.style, { fontSize: '11px', padding: '4px 6px', borderRadius: '6px', display: 'none' });

    const actRow = document.createElement('div');
    Object.assign(actRow.style, { display: 'flex', gap: '6px', marginTop: '2px' });

    const btnActivate = document.createElement('button');
    btnActivate.type = 'button'; btnActivate.textContent = 'Activate';
    Object.assign(btnActivate.style, {
        flex: '1', padding: '6px', borderRadius: '7px', border: 'none', cursor: 'pointer',
        background: 'rgba(99,102,241,0.8)', color: '#fff', fontWeight: '700', fontSize: '12px',
    });
    btnActivate.onmouseenter = () => btnActivate.style.background = 'rgba(99,102,241,1)';
    btnActivate.onmouseleave = () => btnActivate.style.background = 'rgba(99,102,241,0.8)';

    const btnUpgrade = document.createElement('a');
    btnUpgrade.href = 'https://chatwall.io/#pricing'; btnUpgrade.target = '_blank';
    btnUpgrade.textContent = 'Get Premium ↗';
    Object.assign(btnUpgrade.style, {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '6px 8px', borderRadius: '7px', border: '1px solid rgba(234,179,8,0.4)',
        color: 'rgba(253,230,138,0.85)', fontSize: '11px', fontWeight: '600', textDecoration: 'none', whiteSpace: 'nowrap',
    });

    actRow.appendChild(btnActivate);
    actRow.appendChild(btnUpgrade);

    licForm.appendChild(emailRow);
    licForm.appendChild(keyRow);
    licForm.appendChild(statusEl);
    licForm.appendChild(actRow);

    // Footer links: forgot key / connect to account (email prefilled from storage)
    const linksRow = document.createElement('div');
    Object.assign(linksRow.style, { display: 'flex', justifyContent: 'space-between', padding: '2px 2px 0' });
    const mkFootLink = (text, baseUrl) => {
        const a = document.createElement('a');
        a.textContent = text;
        a.target = '_blank';
        a.href = baseUrl; // updated dynamically on form open
        Object.assign(a.style, { fontSize: '10.5px', color: 'rgba(147,197,253,0.7)', textDecoration: 'none', cursor: 'pointer' });
        a.onmouseenter = () => a.style.color = '#93c5fd';
        a.onmouseleave = () => a.style.color = 'rgba(147,197,253,0.7)';
        return a;
    };
    const linkForgot = mkFootLink('Forgot key / password?', 'https://chatwall.io/forgot-password.html');
    const linkConnect = mkFootLink('Sign in to account ↗', 'https://chatwall.io/login.html');
    linksRow.appendChild(linkForgot);
    linksRow.appendChild(linkConnect);
    licForm.appendChild(linksRow);

    panel.appendChild(licForm);

    // Pre-fill saved key; use chatwall_id for all links (same as full overlay)
    const showLicForm = () => {
        const open = licForm.style.display === 'flex';
        licForm.style.display = open ? 'none' : 'flex';
        if (!open) {
            chrome.storage.local.get(['chatwall_email', 'chatwall_license_key', 'chatwall_id'], (d) => {
                emailInp.value = d.chatwall_email || '';
                keyInp.value = d.chatwall_license_key || '';
                // Use chatwall_id as the session identifier, matching the full overlay pattern
                const qs = d.chatwall_id ? `?id=${encodeURIComponent(d.chatwall_id)}` : '';
                linkForgot.href = `${CONFIG_API_URL}/login.html${qs}`;
                linkConnect.href = `${CONFIG_API_URL}/login.html${qs}`;
            });
        }
    };
    licItem.onclick = showLicForm;

    btnActivate.addEventListener('click', (e) => {
        e.stopPropagation();
        const email = emailInp.value.trim();
        const key = keyInp.value.trim();
        if (!email || !key) {
            licStatus(statusEl, 'Please fill in email and key.', 'warn');
            return;
        }
        licStatus(statusEl, 'Verifying…', 'info');
        chrome.runtime.sendMessage({ action: 'CHECK_LICENSE_API', email, licenseKey: key }, (resp) => {
            if (resp && (resp.status === 'VALID' || resp.status === 'VIP' || resp.status === 'VALID_DEV')) {
                licStatus(statusEl, `✓ Activated (${resp.plan})`, 'ok');
                chrome.storage.local.set({ chatwall_email: email, chatwall_license_key: key });
                // Immediately apply the new plan in this tab without waiting for
                // the background's UPDATE_PLAN broadcast (which may be throttled).
                if (typeof USER_PLAN !== 'undefined') USER_PLAN = resp.plan;
                if (typeof updatePlanUI === 'function') updatePlanUI();
                if (typeof processText === 'function') processText(true);
                if (typeof inputOverlayIsOpen !== 'undefined' && inputOverlayIsOpen &&
                    typeof processText === 'function') {
                    processText(true);
                }
            } else if (resp && resp.status === 'LIMIT_REACHED') {
                licStatus(statusEl, 'Device limit reached. Reset devices on chatwall.io.', 'err');
            } else {
                licStatus(statusEl, resp?.message || 'Activation failed.', 'err');
            }
        });
    });

    // ── Help / About ─────────────────────────────────────────────────────────
    panel.appendChild(mkHr());
    panel.appendChild(mkSep('Resources'));

    const helpItem = mkItem('cw-menu-help', IC.help, 'Help & Docs', '');
    const termsItem = mkItem('cw-menu-terms', IC.file, 'Terms', '');
    const privItem = mkItem('cw-menu-privacy', IC.privacy, 'Privacy', '');
    const licPageItem = mkItem('cw-menu-license', IC.scale, 'License', '');

    helpItem.onclick = () => { window.open('https://chatwall.io/support.html#docs', '_blank'); togglePanel(false); };
    termsItem.onclick = () => { window.open('https://chatwall.io/terms.html', '_blank'); togglePanel(false); };
    privItem.onclick = () => { window.open('https://chatwall.io/privacy.html', '_blank'); togglePanel(false); };
    licPageItem.onclick = () => { window.open('https://chatwall.io/license.html', '_blank'); togglePanel(false); };

    panel.appendChild(helpItem);
    panel.appendChild(termsItem);
    panel.appendChild(privItem);
    panel.appendChild(licPageItem);

    // ── Footer version ────────────────────────────────────────────────────────
    panel.appendChild(mkHr());
    const footer = document.createElement('div');
    const planLabel = (typeof USER_PLAN !== 'undefined' && USER_PLAN !== 'FREE') ? `${USER_PLAN} 🌟` : 'Free';
    footer.textContent = `ChatWall${ver ? ' v' + ver : ''} · ${planLabel}`;
    footer.id = 'cw-mode-footer';
    Object.assign(footer.style, { fontSize: '10px', color: 'rgba(255,255,255,0.2)', padding: '3px 11px 2px', letterSpacing: '0.3px' });
    panel.appendChild(footer);

    // ── Assemble ─────────────────────────────────────────────────────────────
    host.appendChild(btn);
    host.appendChild(panel);
    document.body.appendChild(host);
    cwModeMenuEl = host;

    // ── Toggle logic ─────────────────────────────────────────────────────────
    let panelOpen = false;
    const togglePanel = (force) => {
        panelOpen = (force !== undefined) ? force : !panelOpen;
        panel.style.display = panelOpen ? 'flex' : 'none';
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(); });
    document.addEventListener('click', (e) => { if (panelOpen && !host.contains(e.target)) togglePanel(false); }, true);

    // Allow external callers (e.g. topbar settings button) to open the panel
    window.cwOpenModeMenu = () => togglePanel(true);


    loadModePreference();
    updateModeMenuUI();
}

// ─── License helpers ──────────────────────────────────────────────────────────

function licInputStyle(el) {
    Object.assign(el.style, {
        background: 'rgba(255,255,255,0.07)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: '7px',
        color: '#fff',
        fontSize: '12px',
        padding: '6px 8px',
        outline: 'none',
        width: '100%',
        fontFamily: 'inherit',
    });
}

function licStatus(el, msg, type) {
    el.textContent = msg;
    el.style.display = 'block';
    const styles = {
        ok: { background: 'rgba(21,128,61,0.3)', color: '#86efac' },
        err: { background: 'rgba(185,28,28,0.3)', color: '#fca5a5' },
        warn: { background: 'rgba(161,98,7,0.3)', color: '#fde68a' },
        info: { background: 'rgba(37,99,235,0.2)', color: '#93c5fd' },
    };
    Object.assign(el.style, styles[type] || styles.info);
}

// Bootstrap
createModeMenu();
