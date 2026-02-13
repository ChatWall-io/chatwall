/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */
// --- OVERLAY UI ---

let currentOverlayMode = 'anonymize';

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

        shadowRoot = overlayContainer.attachShadow({ mode: 'closed' });
        const link = document.createElement('link');
        link.setAttribute('rel', 'stylesheet');
        link.setAttribute('href', chrome.runtime.getURL('overlay.css'));
        // Wait for CSS to load before showing content (prevent FOUC)
        const cssReady = new Promise(r => { link.onload = r; link.onerror = r; });
        shadowRoot.appendChild(link);

        fetch(chrome.runtime.getURL('overlay.html') + '?t=' + Date.now()).then(res => res.text()).then(async html => {
            html = localizeHtml(html);

            // OPTIMIZATION: Perform string replacements BEFORE creating DOM to avoid layout reflows and Safari security blocks
            const logoUrl = chrome.runtime.getURL('logo_t.png');
            html = html.replace('src="logo_t.png"', `src="${logoUrl}"`);
            html = html.replace(/http:\/\/localhost:3000/g, CONFIG_API_URL);

            const wrapper = document.createElement('div');
            wrapper.innerHTML = html;

            shadowRoot.appendChild(wrapper);

            // Wait for CSS before initializing events (ensures layout is correct)
            await cssReady;

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
        } else {
            btnUpgrade.style.display = isPremium ? 'none' : 'flex';
        }
    }

    const linkGetLicense = shadowRoot.getElementById('linkGetLicense');
    if (linkGetLicense) {
        if (hidePayment || isPremium) {
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
