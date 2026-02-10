/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class CvvDetector extends ContextualDetector {
    constructor() {
        super();
        this.addRule({
            type: 'SECRET', // Mapped to SECRET (or CVV?) -> "like pin pass key are secret". CVV is a secret.
            pattern: /\b\d{3,4}\b/g,
            dist: 20,
            keywords: ["cvv", "cvc", "cvv2", "cvc2", "cid", "security code"]
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { CvvDetector }; }
else { (typeof self !== 'undefined' ? self : window).CvvDetector = CvvDetector; }
