/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class KeyDetector extends ContextualDetector {
    constructor() {
        super();

        // Contextual API Key (Key: Value)
        this.addRule({
            type: 'SECRET',
            // Positive Lookbehind for keywords + separator (: or =)
            // supports "Private Key (Hex):" or "API KEY:" or "API_KEY:"
            pattern: /(?<=\b(?:api[\s_-]?key|secret|token|access[\s_-]?key|private[\s_-]?key)(?:\s*\([^)]+\))?\s*[:=]\s*)["']?[a-zA-Z0-9_\-]{16,128}["']?/gi,
            validator: (val) => true
        });

        // AWS Access Key ID (AKIA...)
        this.addRule({
            type: 'AWS', // Will map to KEY in frontend if user prefers
            pattern: /(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g
        });

        // AWS Secret Access Key (approximate, needs 40 chars)
        this.addRule({
            type: 'AWS',
            pattern: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g,
            dist: 20,
            keywords: ["aws", "secret", "key", "access"],
            validator: (val) => {
                // Basic entropy check or exclude common strings
                if (val.includes(' ')) return false;
                return true;
            }
        });

        // Key Complex
        this.addRule({
            type: 'SECRET', // Mapped to SECRET
            pattern: /[a-zA-Z0-9+/=._-]{8,80}/g,
            dist: 20,
            keywords: ["key", "token", "credential", "auth", "code", "api", "bearer", "access", "private"],
            validator: (val) => {
                // Must contain at least one number and one letter
                if (!/[0-9]/.test(val) || !/[a-zA-Z]/.test(val)) return false;
                // For matches >= 30 chars (e.g. Hex Keys), allow all lowercase
                if (val.length >= 30) return true;
                // For shorter matches, require mixed case (Uppercase + Number)
                return /[A-Z]/.test(val);
            }
        });

        // Rule: PEM Private Keys
        this.addRule({
            type: 'SECRET',
            pattern: /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+ PRIVATE KEY-----/g,
            // No context or validator needed for such a specific pattern
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { KeyDetector }; }
else { (typeof self !== 'undefined' ? self : window).KeyDetector = KeyDetector; }
