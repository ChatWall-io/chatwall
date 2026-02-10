/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../detector.js'); }

class CountryDetector extends ContextualDetector {
    constructor() {
        super();


        let pattern = null;

        if (typeof countryNamesSet !== 'undefined') {
            // Prepare candidates: Original + Fully Uppercase variants
            const candidates = new Set();
            countryNamesSet.forEach(name => {
                candidates.add(name);
                candidates.add(name.toUpperCase());
            });

            console.warn(`[CountryDetector] Loaded ${candidates.size} country variants (from ${countryNamesSet.size} originals).`);

            const sorted = Array.from(candidates)
                .sort((a, b) => b.length - a.length);

            // Escape and join with smart boundaries
            const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            const patternStr = sorted.map(name => {
                const escaped = escape(name);
                // Smart Boundary:
                // If name ends with a word char (letter/number), use \b boundary.
                // If name matches non-word char (like period in "U.S."), use negative lookahead (?!\w)
                // to ensure it's not part of a larger word (e.g. U.S.A).
                if (/\w$/.test(name)) {
                    return escaped + "\\b";
                } else {
                    return escaped + "(?!\\w)";
                }
            }).join('|');

            // Regex without 'i' flag -> Case Sensitive
            pattern = new RegExp(`\\b(?:${patternStr})`, 'g');
        } else {
            console.warn("CountryDetector: countryNamesSet not found");
            pattern = /\b(?:US|USA|UK|France|Germany)\b/g;
        }

        this.addRule({
            type: 'COUNTRY',
            pattern: pattern,
            validator: (word) => true // Regex is now strict
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { CountryDetector }; }
else { (typeof self !== 'undefined' ? self : window).CountryDetector = CountryDetector; }
