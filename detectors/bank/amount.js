/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class AmountDetector extends ContextualDetector {
    constructor() {
        super();
        // Matters: 1.000,00 € OR $10.50
        this.addRule({
            type: 'AMOUNT',
            // Comprehensive Money Regex
            // 1. Prefix Symbols ($, €, £, ¥, ￥, R$, CHF) - Uses Lookbehind (?<=...) to check boundary without consuming char
            //    Supports abbreviations like $1M, £10k
            // 2. Suffix ISO (USD, EUR, BTC, JPY, CNY, etc.)
            pattern: /(?<=^|[^0-9a-zA-Z])(?:€|\$|£|¥|￥|R\$|CHF)\s?(?:\d{1,3}(?:[., ]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?|[1-9]\d{0,2}\s?[kKmMbB])\b|\b(?:\d{1,3}(?:[., ]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,8})?)\s?(?:€|\$|£|¥|￥|EUR|USD|GBP|CHF|JPY|CNY|CAD|AUD|BTC|ETH)(?:\b|(?=[^0-9a-zA-Z]|$))/gi
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { AmountDetector }; }
else { (typeof self !== 'undefined' ? self : window).AmountDetector = AmountDetector; }
