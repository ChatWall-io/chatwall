

/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class SsnDetector extends ContextualDetector {
    constructor() {
        super();
        this.addRule({
            type: 'SSN',
            // Pattern from Presidio UsSsnRecognizer ("SSN5 (medium)")
            // Supports dash, space, or dot separator
            pattern: /\b([0-9]{3})[- .]([0-9]{2})[- .]([0-9]{4})\b/g,
            dist: 25,
            keywords: ["ssn", "social", "secu", "number"],
            validator: (match) => {
                const clean = match.replace(/[- .]/g, '');

                // REMOVED VALIDATION FOR TEST DATA SUPPORT (User Request)
                // - Allow 666 prefix
                // - Allow all same digits (999-99-9999)
                // - Allow dummy starts

                return true;
            }
        });

        // Rule 2: Greedy Contextual SSN (Original)
        this.addRule({
            type: 'SSN',
            pattern: /(?<=\bssn(?:\s+number)?(?:[:\s]+))[^\s]+/gi,
            validator: (match) => {
                const clean = match.replace(/[^0-9]/g, '');
                if (clean.length !== 9) return false;
                return true;
            }
        });

        // Rule 3: Strict Dash-Separated SSN (No Context Required)
        // User Request: Recognize raw SSNs in lists (e.g. 000-12-3456)
        this.addRule({
            type: 'SSN',
            pattern: /\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b/g,
            validator: (match) => {
                // Formatting is guaranteed by regex
                return true;
            }
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { SsnDetector }; }
else { (typeof self !== 'undefined' ? self : window).SsnDetector = SsnDetector; }
