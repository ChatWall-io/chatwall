

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
            // Pattern from Presidio IbanRecognizer ("IBAN Generic")
            // Relaxed to support variable spacing (e.g. groups of 4 or irregular)
            // Matches: Country(2) + Check(2) + 10-32 alphanum chars (with optional space/dash)
            // Fix: Negative lookahead to prevent consuming " BIC" at the end
            pattern: /\b[A-Z]{2} ?\d{2}(?:(?!\sBIC\b)[ -]?[A-Z0-9]){10,32}\b/gi,
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
