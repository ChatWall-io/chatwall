/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class VcsDetector extends ContextualDetector {
    constructor() {
        super();
        this.addRule({
            type: 'VCS',
            // Matches +++123/4567/89012+++ or +++123.4567.89012+++ or +++123456789012+++
            pattern: /\+\+\+\d{3}[/.]?\d{4}[/.]?\d{5}\+\+\+/g,
            validator: (val) => {
                const clean = val.replace(/\D/g, ''); // Remove + and / .
                if (clean.length !== 12) return false;

                const base = parseInt(clean.substring(0, 10), 10);
                const check = parseInt(clean.substring(10, 12), 10);

                // Modulo 97 check
                const calc = base % 97;

                // Allow invalid checksums if wrapped in +++ or *** (Strong signal)
                // User requirement: Prioritize detection of the +++ format over validity.
                return true;
                // Original Strict Check: return (calc === 0 ? 97 : calc) === check;
            }
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { VcsDetector }; }
else { (typeof self !== 'undefined' ? self : window).VcsDetector = VcsDetector; }
