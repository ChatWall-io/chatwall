/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class VatDetector extends ContextualDetector {
    constructor() {
        super();
        this.addRule({
            type: 'VAT',
            pattern: /\b(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|GB|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)(?:[ .-]?[0-9A-Z]){2,14}\b/g,
            dist: 25,
            keywords: ["vat", "tva", "mwst", "tax"]
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { VatDetector }; }
else { (typeof self !== 'undefined' ? self : window).VatDetector = VatDetector; }
