

/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class CbDetector extends ContextualDetector {
    constructor() {
        super();
        this.addRule({
            type: 'CB',
            // Pattern from Presidio CreditCardRecognizer ("All Credit Cards (weak)")
            // Relaxed for generic 13-19 digit detection (Test numbers, unknown issuers)
            pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}(?:[- ]?\d{1,7})?\b/g,
            validator: (match) => {
                // Sanitize
                const clean = match.replace(/[- ]/g, '');
                if (!/^\d+$/.test(clean)) return false;
                if (clean.length < 13 || clean.length > 19) return false;

                // User requested "Flexible" detection for test numbers (e.g. 5555...)
                // Luhn Checksum Disabled
                /*
                let sum = 0;
                let shouldDouble = false;
                for (let i = clean.length - 1; i >= 0; i--) {
                    let digit = parseInt(clean.charAt(i), 10);
                    if (shouldDouble) {
                        digit *= 2;
                        if (digit > 9) digit -= 9;
                    }
                    sum += digit;
                    shouldDouble = !shouldDouble;
                }
                return (sum % 10) === 0;
                */
                return true;
            }
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { CbDetector }; }
else { (typeof self !== 'undefined' ? self : window).CbDetector = CbDetector; }
