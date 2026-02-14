

/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class IbanDetector extends ContextualDetector {
    constructor() {
        super();
        this.addRule({
            type: 'IBAN',
            // Pattern: Valid IBAN country codes + Check(2) + 10-32 alphanum chars (with optional space/dash)
            // Uses explicit ISO 13616 country codes to avoid false positives (e.g. "of 50 similar")
            // Fix: Negative lookahead to prevent consuming " BIC" at the end
            pattern: /\b(?:AL|AD|AT|AZ|BH|BY|BE|BA|BR|BG|CR|HR|CY|CZ|DK|DO|EG|SV|EE|FO|FI|FR|GE|DE|GI|GR|GL|GT|HU|IS|IQ|IE|IL|IT|JO|KZ|XK|KW|LV|LB|LI|LT|LU|MK|MT|MR|MU|MD|MC|ME|NL|NO|PK|PS|PL|PT|QA|RO|LC|SM|ST|SA|RS|SC|SK|SI|ES|SD|SE|CH|TL|TN|TR|UA|AE|GB|VA|VG|GF|GP|MQ|RE|PF|TF|YT|NC|BL|MF|PM|WF) ?\d{2}(?:(?!\sBIC\b)[ -]?[A-Z0-9]){10,32}\b/g,
            validator: (match) => {
                const clean = match.replace(/[- ]/g, '').toUpperCase();

                if (clean.length < 15 || clean.length > 34) return false;

                // User requested to REMOVE checksum validation to detect all IBAN-like numbers
                // Checksum validation is disabled to allow masking of invalid/test IBANs
                /*
                // Move first 4 chars to end
                const moved = clean.substring(4) + clean.substring(0, 4);
                ... Mod 97 logic removed ...
                */
                return true;
            }
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { IbanDetector }; }
else { (typeof self !== 'undefined' ? self : window).IbanDetector = IbanDetector; }
