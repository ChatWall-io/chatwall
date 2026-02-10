/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class PinDetector extends ContextualDetector {
    constructor() {
        super();
        this.addRule({
            type: 'SECRET', // Mapped to SECRET
            pattern: /\b\d{4,8}\b/g,
            dist: 10,
            keywords: ["pin", "code", "password", "mdp", "pass", "geheimzahl"]
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { PinDetector }; }
else { (typeof self !== 'undefined' ? self : window).PinDetector = PinDetector; }
