

/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class CryptoDetector extends ContextualDetector {
    constructor() {
        super();
        // BTC (Legacy, Nested SegWit, Native SegWit Behc32, Taproot Bech32m)
        // Updated to support up to 59 characters for Bech32m (Taproot)
        this.addRule({
            type: 'CRYPTO',
            pattern: /\b(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,59}\b/g
        });
        // ETH
        this.addRule({
            type: 'CRYPTO',
            pattern: /\b0x[a-fA-F0-9]{40}\b/g
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { CryptoDetector }; }
else { (typeof self !== 'undefined' ? self : window).CryptoDetector = CryptoDetector; }
