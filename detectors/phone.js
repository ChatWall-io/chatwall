/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

/**
 * PhoneDetector
 * Detects: PHONE
 */
if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) {
    const { ContextualDetector } = require('../detector.js');
}

class PhoneDetector extends ContextualDetector {
    constructor() {
        super();

        // Regex List from previous phone.js implementation
        const VAT_CC = "AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|GB|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK";
        const R_NANP = "(?:\\+?1[\\s.-]?)?(?:\\(?\\d{3}\\)?[\\s.-]?)\\d{3}[\\s.-]?\\d{4}";
        const R_EU_INTL = "\\+(?:3[0-469]|4[0-9])\\d{0,3}(?:[\\s./-]\\d{1,12}){1,5}";
        const R_EU_DOM = `(?<!\\b(?:${VAT_CC})[ .-]?)` + "(?<![\\w-])0\\d{1,4}(?:[\\s./-]\\d{2,12}){1,5}";
        const R_CIS = "(?:\\+7|8)[\\s.-]?\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{2}[\\s.-]?\\d{2}";
        const R_ASIA_INTL = "\\+(?:6[0-6]|8[1246]|9[0-8])\\d{0,3}(?:[\\s./-]\\d{1,12}){1,6}";
        const R_ASIA_DOM = "(?<![\\w-])0\\d{1,3}[\\s.-]?\\d{1,12}[\\s.-]?\\d{4}";
        const R_ROW_INTL = "\\+(?:2[0-8]|5[0-8]|9[679])\\d{0,3}(?:[\\s./-]\\d{1,12}){1,6}";
        const R_COMPACT = "\\+\\d{10,15}";
        const R_GLOBAL_FALLBACK = `(?<!\\b(?:${VAT_CC})[ .-]?)` + "(?<![\\w-])(?:\\+|00)?\\d{1,4}(?:[\\s./-]\\d{1,12}){1,5}(?![\\w-])";

        // Custom Format: 0491 / 93.00.23 or 0491 / 93 00 23
        // Structure: 4 digits, space, slash, space, 2 digits, separator, 2 digits, separator, 2 digits
        const R_CUSTOM_BELGIUM = "(?<![\\w-])0\\d{3}[ ]?\\/[ ]?\\d{2}[ .]\\d{2}[ .]\\d{2}(?![\\w-])";

        const patterns = [
            R_CIS, R_EU_INTL, R_EU_DOM, R_NANP,
            R_ASIA_INTL, R_ASIA_DOM, R_ROW_INTL,
            R_COMPACT, R_GLOBAL_FALLBACK,
            R_CUSTOM_BELGIUM
        ];

        patterns.forEach(regexStr => {
            this.addRule({
                type: 'PHONE',
                pattern: new RegExp(regexStr, 'g'),
                validator: (val, context) => { // Context is { index, text, match }
                    const digits = val.replace(/\D/g, '');
                    if (digits.length < 7 || digits.length > 15) return false;

                    // Exclude VCS (+...+) or (*...*) - Check surrounding text
                    // We check if the text *containing* this match is wrapped in +++ or ***
                    if (context && context.text) {
                        const s = context.index;
                        const e = context.index + val.length;
                        // Look back 3 chars
                        const prefix = context.text.substring(Math.max(0, s - 3), s);
                        // Look ahead 3 chars
                        const suffix = context.text.substring(e, e + 3);

                        if (prefix === '+++' || suffix === '+++') return false;
                        if (prefix === '***' || suffix === '***') return false;
                    }

                    // Exclude VCS (+...+) or (*...*) - Internal Check (Legacy fallback)
                    if (val.includes("+++") || val.includes("***")) return false;

                    // Exclude Dates (YYYY-MM-DD or DD/MM/YYYY)
                    if (/^(?:19|20)\d{2}[-./]\d{2}[-./]\d{2}$/.test(val)) return false;
                    if (/^\d{2}[-./]\d{2}[-./](?:19|20)\d{2}$/.test(val)) return false;
                    // Exclude SSN
                    if (/^\d{3}-\d{2}-\d{4}$/.test(val)) return false;

                    // User Request: Phone numbers cannot be split on two different lines
                    if (/[\r\n]/.test(val)) return false;

                    return true;
                }
            });
        });

        // Contextual Rule (User Request: "Tél, Fax, Phone, Cell, Join us at")
        // Allows looser matching if explicitly labeled.
        this.addRule({
            type: 'PHONE',
            pattern: /(?:T[ée]l|Fax|Phone|Cell|Hotline|Join us at)\s*:?\s*(\+?[\d\s.-]{8,})/gi,
            validator: (matchText, context) => {
                // Ensure valid char count (digits)
                const digits = matchText.replace(/\D/g, '');
                if (digits.length < 7 || digits.length > 15) return false;
                // Prevent splitting (User Request #2)
                if (/[\r\n]/.test(matchText)) return false;
                return true;
            }
        });

        // User Request: "+NN or +NNN followed by numbers and spaces is a phone"
        // Generic International Rule (Permissive +... rule)
        this.addRule({
            type: 'PHONE',
            pattern: /\+\d{1,4}(?:[ \t.-]?\d+)+/g,
            validator: (matchText) => {
                const digits = matchText.replace(/\D/g, '');
                if (digits.length < 7 || digits.length > 15) return false;
                // Prevent splitting (User Request #2)
                if (/[\r\n]/.test(matchText)) return false;
                return true;
            }
        });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PhoneDetector };
} else {
    var globalScope = (typeof self !== 'undefined') ? self : window;
    globalScope.PhoneDetector = PhoneDetector;
}
