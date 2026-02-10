/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class PostalDetector extends ContextualDetector {
    constructor() {
        super();
        this.addRule({
            type: 'POSTAL',
            pattern: /\b\d{5}(?:-\d{4})?\b/gi
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { PostalDetector }; }
else { (typeof self !== 'undefined' ? self : window).PostalDetector = PostalDetector; }
