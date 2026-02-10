/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class PlateDetector extends ContextualDetector {
    constructor() {
        super();
        this.addRule({
            type: 'PLATE',
            // Pattern: Uppercase Alphanumeric groups separated by [ -.;]
            // Example: AA-123-BB, 1-ABC-123, 123.456.78, 123;456
            // Must have at least 2 groups to distinguish from simple words/numbers, OR be strictly formatted.
            // But relying on context allows broader matching. 
            // We'll enforce at least one separator to be safe, or just [A-Z0-9]+ if context is strong?
            // User requested "followed by uppercase numbers ; - .."
            pattern: /\b[A-Z0-9]{1,10}(?:[ \-.;]+[A-Z0-9]{1,10}){1,4}\b/g,
            dist: 25,
            keywords: [
                "immatriculation", "numéro de plaque", "numero de plaque", "plate number", "plate nbr", "license plate",
                "plaque", "kennzeichen", "matrícula", "matricula", "targa", "kenteken", "nummerplaat",
                "vehicule", "vehicle", "immatriculée"
            ]
        });
    }
}

if (typeof module !== 'undefined' && module.exports) { module.exports = { PlateDetector }; }
else { (typeof self !== 'undefined' ? self : window).PlateDetector = PlateDetector; }
