/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { var { ContextualDetector } = require('../detector.js'); }

class SecretDetector extends ContextualDetector {
    constructor() {
        super();
        this.addRule({
            type: 'SECRET',
            // Removed: () {} [] : " ; ' < > . ,
            pattern: /[a-zA-Z0-9@!#$%^*_|~\-\/]{16,128}/g,
            dist: 20,
            keywords: ["secret", "confidential"]
        });

        // User Request: "a string of 10 char or more composed of letter and numbers should be detected as a secret"
        // Generic Long Alphanumeric Rule (No Context Required)
        this.addRule({
            type: 'SECRET',
            pattern: /\b[A-Za-z0-9]{10,}\b/g,
            validator: (val) => {
                // Must contain at least one Letter AND at least one Number
                const hasLetter = /[A-Za-z]/.test(val);
                const hasNumber = /\d/.test(val);
                return hasLetter && hasNumber;
            }
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { SecretDetector }; }
else { (typeof self !== 'undefined' ? self : window).SecretDetector = SecretDetector; }
