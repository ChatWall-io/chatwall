/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class BicDetector extends ContextualDetector {
    constructor() {
        super();
        this.addRule({
            type: 'BIC',
            pattern: /\b[A-Z]{4}\s*[A-Z]{2}\s*[A-Z0-9]{2}(?:\s*[A-Z0-9]{3})?\b/g,
            dist: 10,
            keywords: ["bic", "swift", "bank", "code", "identifier", "bankcode"]
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { BicDetector }; }
else { (typeof self !== 'undefined' ? self : window).BicDetector = BicDetector; }
