/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { var { ContextualDetector } = require('../detector.js'); }

class TimeDetector extends ContextualDetector {
    constructor() {
        super();
        const T_HH = "(?:[01]?\\d|2[0-3])";

        // User Request: Time should not be split on two lines
        const originalAddRule = this.addRule.bind(this);
        this.addRule = (rule) => {
            const originalValidator = rule.validator;
            rule.validator = (match, context) => {
                if (/[\r\n]/.test(match)) return false;
                if (originalValidator) return originalValidator(match, context);
                return true;
            };
            originalAddRule(rule);
        };

        const T_MM = "(?:[0-5]\\d)";
        const T_SS = "(?::[0-5]\\d)?";
        const T_AMPM = "\\s*(?:[ap]\\.?m\\.?)";
        const R_T_STD = `\\b${T_HH}[:.-]${T_MM}${T_SS}\\b`;
        const R_T_SPACE = `\\b${T_HH}\\s${T_MM}\\b`;
        const R_T_H_SEP = `\\b${T_HH}\\s*h\\s*${T_MM}\\b`;
        const R_T_SUFFIX = `\\b${T_HH}[:.]${T_MM}${T_SS}${T_AMPM}|\\b${T_HH}[:.]${T_MM}\\s*(?:Uhr|uur|h)\\b`;
        // Order changed: Suffix first to capture "AM/PM" before standard "HH:MM" cuts it off
        // Removed R_T_SPACE (HH MM) as it caused false positives with Phone numbers e.g. "01 45"
        const R_TIME = `${R_T_SUFFIX}|${R_T_STD}|${R_T_H_SEP}|\\b${T_HH}\\s*h\\b`;

        this.addRule({ type: 'TIME', pattern: new RegExp(R_TIME, 'gi') });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { TimeDetector }; }
else { (typeof self !== 'undefined' ? self : window).TimeDetector = TimeDetector; }
