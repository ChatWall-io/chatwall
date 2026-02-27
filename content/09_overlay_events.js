/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */
// --- OVERLAY EVENTS ---
// Internal overlay interaction: input, toolbar, scroll sync, settings, license, help, mouse/selection, tooltips

function initOverlayEvents() {
    // Cache overlay DOM elements at module level (used by hot-path functions)
    elInputText = shadowRoot.getElementById('inputText');
    elInputHighlights = shadowRoot.getElementById('inputHighlights');
    elOutputText = shadowRoot.getElementById('outputText');

    const inputText = elInputText;
    const inputHighlights = elInputHighlights;
    const outputText = elOutputText;

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
                // Use cursor-centered partial scan for large texts (matches accumulate)
                const isLargeText = inputText.value.length > 20000;
                processText(false, isLargeText);
            }, 300);
        });

        inputText.addEventListener('paste', () => {
            const savedScrollTop = inputText.scrollTop;
            setTimeout(() => {
                // Restore scroll position (browser scrolls to cursor on paste)
                inputText.scrollTop = savedScrollTop;
                if (elInputHighlights) elInputHighlights.scrollTop = savedScrollTop;
                // Optimized Paste: Immediate Partial Scan of Visible Area
                // forceFullScan=false, fromScroll=true (To center on viewport)
                processText(false, true);
            }, 50);
        });
    }
    const closeBtn = shadowRoot.getElementById('closeBtn');
    if (closeBtn) closeBtn.addEventListener('click', hideOverlay);

    const btnMinimize = shadowRoot.getElementById('btnMinimize');
    if (btnMinimize) btnMinimize.addEventListener('click', hideOverlay);

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

    if (btnAccount) {
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
    if (menuAccountLink) {
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
            window.open(CONFIG_API_URL + '/#pricing', '_blank');
            const modal = shadowRoot.getElementById('modalLicense');
            if (modal) modal.style.display = 'flex';
        });
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

        if (inputText && shadowRoot.activeElement === inputText) {
            start = inputText.selectionStart || 0;
            end = inputText.selectionEnd || 0;
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

        if (inputText && shadowRoot.activeElement === inputText) {
            start = inputText.selectionStart || 0;
            end = inputText.selectionEnd || 0;
            hasSelection = (start !== end);
        }

        if (hasSelection) {
            const selectedText = inputText.value.substring(start, end);
            handleUnmaskAction(selectedText, null, start, end);
            inputText.setSelectionRange(start, start);
            return;
        }

        if (inputText && shadowRoot.activeElement === inputText) {
            const cursor = inputText.selectionStart;
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


    // --- SCROLL SYNC ---

    const ctxMenu = shadowRoot.getElementById('customContextMenu');
    shadowRoot.addEventListener('click', () => { if (ctxMenu) ctxMenu.style.display = 'none'; });

    if (inputText) {
        let scrollRAF = null;
        // SAFARI FIX: Simple One-Way Scroll Sync (Input -> Highlights)
        // Bidirectional Input <-> Output sync removed to prevent infinite scroll loops.
        let scrollTimer;
        const syncScrollCore = () => {
            scrollRAF = null;
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
            // Adaptive debounce: longer for large texts to avoid wasted re-renders during fast scrolling
            const scrollDebounce = (inputText && inputText.value.length > 20000) ? 500 : 300;
            clearTimeout(scrollTimer);
            scrollTimer = setTimeout(() => {
                processText(false, true); // forceFullScan=false, fromScroll=true
            }, scrollDebounce);
        };
        // rAF guard: batch multiple scroll events into a single frame to avoid redundant layout reads
        const syncScroll = () => {
            if (scrollRAF) return;
            scrollRAF = requestAnimationFrame(syncScrollCore);
        };
        inputText.addEventListener('scroll', syncScroll, { passive: true });
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
            try {
                if (!shadowRoot) return;  // guard against ctx-switch null
                const elem = shadowRoot.elementFromPoint(e.clientX, e.clientY);
                if (elem && elem.classList.contains('token-locked')) {
                    window.open(CONFIG_API_URL + '/#pricing', '_blank');
                } else if (elem && elem.classList.contains('token')) {
                    if (activeTool === 'unmask') {
                        const originalText = elem.getAttribute('data-text');
                        if (originalText) {
                            ignoredEntities.add(originalText);
                            if (favoritesList.has(originalText)) {
                                favoritesList.delete(originalText);
                                saveFavorites();
                            }
                            cachedLocalMatches = null;
                            processText(true);
                        }
                    }
                }
            } finally {
                inputText.style.pointerEvents = 'auto';  // ALWAYS restore, even if above threw
            }
        });

        const premiumTooltip = shadowRoot.getElementById('premiumTooltip');
        inputText.addEventListener('mousemove', (e) => {
            if (!shadowRoot) return;  // guard against ctx-switch null
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

        // Context menu setup is delegated to 10_context_menu.js
        initContextMenuEvents(inputText, ctxMenu);
    }
}
