/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class JwtDetector extends ContextualDetector {
    constructor() {
        super();
        this.addRule({
            type: 'JWT',
            // JWT regex: Header (ey...) . Payload (ey...) . Signature (chars)
            pattern: /ey[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g,
            validator: (val) => {
                // Basic validation: must have at least 2 dots
                return (val.match(/\./g) || []).length >= 2;
            }
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { JwtDetector }; }
else { (typeof self !== 'undefined' ? self : window).JwtDetector = JwtDetector; }
