/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class UuidDetector extends ContextualDetector {
    constructor() {
        super();
        this.addRule({
            type: 'UUID',
            pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { UuidDetector }; }
else { (typeof self !== 'undefined' ? self : window).UuidDetector = UuidDetector; }
