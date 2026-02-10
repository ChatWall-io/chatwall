/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class IdDetector extends ContextualDetector {
    constructor() {
        super();
        this.addRule({
            type: 'ID',
            pattern: /[#A-Za-z0-9_\-\/.]{8,64}/g,
            dist: 25,
            keywords: [
                "id", "ref", "client", "customer", "uid", "user", "account", "dossier", "project",
                "invoice", "bill", "case", "file", "number", "no", "nr", "n°", "n.", "order", "shipping",
                "shipment", "tracking", "delivery", "ticket", "incident", "report", "issue", "bug",
                "réf", "reference", "référence", "projet", "facture", "compte", "numéro", "num",
                "commande", "livraison", "expédition", "suivi", "billet", "rapport", "signalement",
                "referenz", "projekt", "rechnung", "kunde", "konto", "akte", "nummer", "bestellung",
                "lieferung", "versand", "sendung", "vorfall", "bericht", "meldung", "transaction"
            ],
            validator: (match) => {
                // Reject pure alphabetic strings (too many false positives like "philipddpe")
                if (/^[a-zA-Z]+$/.test(match)) return false;

                // Optional: Require at least one number?
                // if (!/\d/.test(match)) return false; 

                return true;
            }
        });

        // Rule 2: Hash IDs (Short) - e.g. Ref #123, Item # A-99
        // Allows shorter length (3+) IF it starts with #
        this.addRule({
            type: 'ID',
            pattern: /#\s*[A-Za-z0-9_\-\/.]{3,64}/g,
            dist: 25,
            keywords: [
                "id", "ref", "client", "customer", "uid", "user", "account", "dossier", "project",
                "invoice", "bill", "receipt", "case", "file", "number", "no", "nr", "n°", "n.", "order", "shipping",
                "shipment", "tracking", "delivery", "ticket", "incident", "report", "issue", "bug",
                "réf", "reference", "référence", "projet", "facture", "compte", "numéro", "num",
                "commande", "livraison", "expédition", "suivi", "billet", "rapport", "signalement",
                "referenz", "projekt", "rechnung", "kunde", "konto", "akte", "nummer", "bestellung",
                "lieferung", "versand", "sendung", "vorfall", "bericht", "meldung", "transaction",
                "item", "entry", "record", "code"
            ]
        });

        // Rule 3: Greedy Contextual IDs (User Request: "detect until the end")
        // Matches ANY non-whitespace string if explicitly labeled as an ID.
        // Support for: Request-ID, Trace ID, Cart ID, GUID, UUID, etc.
        // Handles "Key: Value" where Value is irregular or long.
        // Supports Markdown artifacts (e.g. **Trace ID:** value)
        this.addRule({
            type: 'ID',
            pattern: /(?<=\b(?:(?:gu|uu)?id|ref(?:erence)?|sub|token|key|receipt|(?:request|trace|correlation|cart|app|object|client|user|account|order|case|file|session|segment)[\s_-]?id)(?:\*\*|['"]|[\s])*\s*[:=]\s*(?:\*\*|['"]|[\s])*)[^\s]+/gi,
            validator: (match) => {
                // Ignore short common words if any slip through (unlikely due to keys)
                if (match.length < 3) return false;
                // Ignore if it's purely alphabetical common word (e.g. "Status: Active") - "Active" passed
                // But "ID: Active" is rare? "Status" is not in keywords.
                // Ref: Active -> Maybe.
                // Let's rely on the specific keys.
                return true;
            }
        });

        // Rule 4: Invoice/Reference Numbers (Greedy)
        // Matches "Rechnung Nr. 123", "Invoice No 123", "Ref N. 123"
        // Handles cases without colon separator.
        this.addRule({
            type: 'ID',
            pattern: /(?<=\b(?:invoice|rechnung|bill|receipt|facture|ref(?:erence)?|commande|order)\s+(?:no|nr|n|n°|num|#)(?:\.|:)?\s*)[^\s]+/gi,
            validator: (match) => {
                if (match.length < 3) return false;
                return true;
            }
        });

        // Rule 5: Standalone Complex Hash IDs (Hyphenated) - e.g. #RE-2023-AT-99
        // Detects IDs that contain hyphens/underscores even without keywords.
        // Assumes that standard social hashtags don't use hyphens.
        this.addRule({
            type: 'ID',
            pattern: /#\s*[a-zA-Z0-9]+(?:[-_][a-zA-Z0-9]+)+/g,
            validator: (match) => {
                // Ensure it's not just a common word with a hyphen (unlikely with #)
                return true;
            }
        });

        // Rule 6: Multiline / Colon-less IDs (Strong Keywords)
        // Matches "Tracking Number\n123", "Code 456", "Ref 789" (no colon required, allows newline)
        this.addRule({
            type: 'ID',
            pattern: /(?<=\b(?:tracking(?:\s+number)?|code|refs?|ids?)(?:[:\s]+))[^\s]+/gi,
            validator: (match) => {
                // Reject pure alphabetic strings (e.g. "Code Red" -> "Red")
                if (/^[a-zA-Z]+$/.test(match)) return false;
                if (match.length < 3) return false;
                return true;
            }
        });

        // Rule 7: Standalone Mixed-Hash IDs (No Context Required)
        // User request: "#134EAZER should be detected... because of # then letters and numbers"
        // Risk: Hashtags (#coding). Mitigation: Require DIGITS.
        this.addRule({
            type: 'ID',
            pattern: /#\s*[a-zA-Z0-9]{3,64}/g,
            validator: (match) => {
                // Must contain at least one digit to distinguish from generic hashtags (#love, #tbt)
                if (!/\d/.test(match)) return false;

                // Exclude pure 4-digit years (e.g. #2024) to avoid false positive years
                if (/^#\s*(?:19|20)\d{2}$/.test(match)) return false;

                return true;
            }
        });

        // User Request: "a string of 5 char or more composed of letter and numbers should be detected as an ID"
        // Generic Mixed Alphanumeric Rule (No Context Required)
        this.addRule({
            type: 'ID',
            pattern: /\b[A-Za-z0-9]{5,}\b/g,
            validator: (val) => {
                // Must contain at least one Letter AND at least one Number
                // This prevents common words like "Hello" or pure numbers "12345" from being flagged as IDs genericly.
                const hasLetter = /[A-Za-z]/.test(val);
                const hasNumber = /\d/.test(val);
                return hasLetter && hasNumber;
            }
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { IdDetector }; }
else { (typeof self !== 'undefined' ? self : window).IdDetector = IdDetector; }
