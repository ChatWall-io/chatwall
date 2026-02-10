/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class MacDetector extends ContextualDetector {
    constructor() {
        super();
        this.addRule({
            type: 'MAC',
            pattern: /\b([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})\b/g
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { MacDetector }; }
else { (typeof self !== 'undefined' ? self : window).MacDetector = MacDetector; }
