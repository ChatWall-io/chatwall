/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class VinDetector extends ContextualDetector {
    constructor() {
        super();

        // 1. Strict VIN Pattern (17 chars, no I, O, Q)
        // Also supports 16-17 chars separated by _ - or space (e.g. 1M8GDM9A_KP042788)
        const R_VIN = "\\b[A-HJ-NPR-Z0-9]{8,9}[-_ ]?[A-HJ-NPR-Z0-9]{8,9}\\b";

        this.addRule({
            type: 'VIN',
            pattern: new RegExp(R_VIN, 'g'),
            validator: (val) => {
                const clean = val.replace(/[-_ ]/g, '');
                if (clean.length < 16 || clean.length > 17) return false;

                // Must have at least one letter and one number to avoid confusing with pure numbers
                if (!/[A-Z]/.test(clean)) return false;
                if (!/[0-9]/.test(clean)) return false;

                return true;
            }
        });

        // 2. Loose with Context
        this.addRule({
            type: 'VIN',
            pattern: /\b[A-Z0-9]{17}\b/g,
            dist: 10,
            keywords: ["vin", "chassis", "serial", "fahrgestell", "vehicle", "auto", "car", "id"]
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { VinDetector }; }
else { (typeof self !== 'undefined' ? self : window).VinDetector = VinDetector; }
