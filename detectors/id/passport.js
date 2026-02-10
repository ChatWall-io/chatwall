/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class PassportDetector extends ContextualDetector {
    constructor() {
        super();
        this.addRule({
            type: 'PASSPORT',
            pattern: /\b[A-Z0-9]{6,9}\b/g,
            dist: 20,
            keywords: ["passport", "passeport", "pasaporte", "reisepass", "pass", "id", "num"]
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { PassportDetector }; }
else { (typeof self !== 'undefined' ? self : window).PassportDetector = PassportDetector; }
