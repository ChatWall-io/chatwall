/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class DateDetector extends ContextualDetector {
    constructor() {
        super();

        // User Request: A date should not be split on two lines
        // We override addRule to inject a global validator for all Date rules.
        const originalAddRule = this.addRule.bind(this);
        this.addRule = (rule) => {
            const originalValidator = rule.validator;
            rule.validator = (match, context) => {
                if (/[\r\n]/.test(match)) return false; // Reject newlines
                if (originalValidator) return originalValidator(match, context);
                return true;
            };
            originalAddRule(rule);
        };

        // 1. ISO 8601
        this.addRule({ type: 'DATE', pattern: /\b(?:\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d(?:\.\d+)?(?:[+-][0-2]\d:[0-5]\d|Z))\b/g });
        this.addRule({ type: 'DATE', pattern: /\b(?:\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d(?:[+-][0-2]\d:[0-5]\d|Z))\b/g });

        // 2. mm/dd/yyyy or dd/mm/yyyy
        this.addRule({ type: 'DATE', pattern: /\b(?:(?:[1-9]|0[1-9]|1[0-2])\/(?:[1-9]|0[1-9]|[1-2][0-9]|3[0-1])\/(?:\d{4}|\d{2}))\b/g });
        this.addRule({ type: 'DATE', pattern: /\b(?:(?:[1-9]|0[1-9]|[1-2][0-9]|3[0-1])\/(?:[1-9]|0[1-9]|1[0-2])\/(?:\d{4}|\d{2}))\b/g });
        // Explicit DD/MM/YYYY safety (matches 31/12/2024 if above fails)
        this.addRule({ type: 'DATE', pattern: /\b(?:3[01]|[12][0-9]|0?[1-9])\/(?:1[0-2]|0?[1-9])\/(?:19|20)\d{2}\b/g });

        // 3. yyyy/mm/dd
        this.addRule({ type: 'DATE', pattern: /\b(?:\d{4}\/(?:[1-9]|0[1-9]|1[0-2])\/(?:[1-9]|0[1-9]|[1-2][0-9]|3[0-1]))\b/g });

        // 4. Dash separators
        this.addRule({ type: 'DATE', pattern: /\b(?:(?:[1-9]|0[1-9]|1[0-2])-(?:[1-9]|0[1-9]|[1-2][0-9]|3[0-1])-\d{4})\b/g });
        this.addRule({ type: 'DATE', pattern: /\b(?:(?:[1-9]|0[1-9]|[1-2][0-9]|3[0-1])-(?:[1-9]|0[1-9]|1[0-2])-\d{4})\b/g });
        this.addRule({ type: 'DATE', pattern: /\b(?:\d{4}-(?:[1-9]|0[1-9]|1[0-2])-(?:[1-9]|0[1-9]|[1-2][0-9]|3[0-1]))\b/g });
        // Explicit YYYY-MM-DD (ISO Simple) - e.g. 2024-06-15
        this.addRule({ type: 'DATE', pattern: /\b(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g });

        // 5. Dot separators (Strict Boundaries to avoid IPs)
        this.addRule({ type: 'DATE', pattern: /(?<!\.)\b(?:(?:[1-9]|0[1-9]|[1-2][0-9]|3[0-1])\.(?:[1-9]|0[1-9]|1[0-2])\.(?:\d{4}|\d{2}))\b(?!\.)/g });

        // 13. MM/YYYY (Credit Card Expiry / Short Dates)
        // 05/2028, 12-2024, 01.2025
        this.addRule({
            type: 'DATE',
            pattern: /\b(?:0[1-9]|1[0-2])[-/.](?:19|20)\d{2}\b/g
        });

        // 13b. MM/YY Expiration Date (Context Required, Years 20-50)
        // exp 05/28, valid thru 12/30
        this.addRule({
            type: 'DATE',
            pattern: /\b(0[1-9]|1[0-2])\/(\d{2})\b/g,
            contextBefore: /(?:exp|expiry|expiration|valid|thru|until|date|caducidad)\b[\s:.]*$/i,
            validator: (match) => {
                const parts = match.split('/');
                if (parts.length !== 2) return false;
                const year = parseInt(parts[1], 10);
                // User Requirement: Year between 25 and 50
                return year >= 20 && year <= 50;
            }
        });

        // 14. Compact Date (YYYYMMDD)
        // 20240228
        this.addRule({
            type: 'DATE',
            pattern: /\b(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/g
        });

        // RE-DEFINING EN Rules for Flexibility (Dash + Historic Years)
        // 6. Textual Months (EN) - Improved
        // 4 July 1776, 01-Jan-2023
        const MONTHS_EN = "jan(?:uary|\\.)?|feb(?:ruary|\\.)?|mar(?:ch|\\.)?|apr(?:il|\\.)?|may|jun(?:e|\\.)?|jul(?:y|\\.)?|aug(?:ust|\\.)?|sep(?:tember|t\\.|\\.)?|oct(?:ober|\\.)?|nov(?:ember|\\.)?|dec(?:ember|\\.)?";
        const DAYS_EN = "mon(?:day|\\.)?|tue(?:sday|\\.)?|wed(?:nesday|\\.)?|thu(?:rsday|r\\.|\\.)?|fri(?:day|\\.)?|sat(?:urday|\\.)?|sun(?:day|\\.)?";

        // Day Month Year (01-Jan-2023, 4 July 1776)
        this.addRule({
            type: 'DATE',
            pattern: new RegExp(`\\b(?:(?:${DAYS_EN})[\\s,./-]*)?(?:[1-9]|[0-2]\\d|3[01])(?:st|nd|rd|th)?[\\s,./-]+(?:${MONTHS_EN})(?:[\\s,./-]+(?:1\\d|20)\\d{2})?\\b`, 'gi')
        });

        // Month Day Year (July 4, 1776)
        this.addRule({
            type: 'DATE',
            pattern: new RegExp(`\\b(?:(?:${MONTHS_EN})[\\s,./-]*)(?:[1-9]|[0-2]\\d|3[01])(?:st|nd|rd|th)?(?:,?[\\s,./-]*(?:1\\d|20)\\d{2})?\\b`, 'gi')
        });

        // Specific Rule for "Fri, 12 Jan 2024" (Day Name, Day Month Year)
        // Explicitly ensuring Day Name is captured to override "Person" detections on the Day Name
        this.addRule({
            type: 'DATE',
            pattern: new RegExp(`\\b(?:on\\s+)?(?:${DAYS_EN})[\\s,./-]+(?:[1-9]|[0-2]\\d|3[01])[\\s,./-]+(?:${MONTHS_EN})[\\s,./-]+(?:19|20)\\d{2}\\b`, 'gi')
        });

        // Specific Rule for "12 Jan 2024" (DD Mon YYYY)
        this.addRule({
            type: 'DATE',
            pattern: new RegExp(`\\b(?:[1-9]|[0-2]\\d|3[01])[\\s,./-]+(?:${MONTHS_EN})[\\s,./-]+(?:19|20)\\d{2}\\b`, 'gi')
        });

        // 7. French Dates (FR)
        // mardi, mar., mar | janvier, janv., janv
        const MONTHS_FR = "janv(?:ier|\\.)?|f[eé]v(?:rier|\\.)?|mars|avr(?:il|\\.)?|mai|juin|juil(?:let|\\.)?|ao[uû]t|sept(?:embre|\\.)?|oct(?:obre|\\.)?|nov(?:embre|\\.)?|d[eé]c(?:embre|\\.)?";
        const DAYS_FR = "lun(?:di|\\.)?|mar(?:di|\\.)?|mer(?:credi|\\.)?|jeu(?:di|\\.)?|ven(?:dredi|\\.)?|sam(?:edi|\\.)?|dim(?:anche|\\.)?";
        this.addRule({
            type: 'DATE',
            pattern: new RegExp(`\\b(?:(?:${DAYS_FR})[\\s,./]*)?(?:1er|[1-9]|[0-2]\\d|3[01])\\s+(?:${MONTHS_FR})(?:\\s+(?:19|20)\\d{2})?\\b`, 'gi')
        });

        // 8. German Dates (DE)
        // Montag, Mo., Mo | Januar, Jan., Jan
        const MONTHS_DE = "jan(?:uar|\\.)?|feb(?:ruar|\\.)?|m[aä]rz|apr(?:il|\\.)?|mai|juni|juli|aug(?:ust|\\.)?|sept(?:ember|\\.)?|okt(?:ober|\\.)?|nov(?:ember|\\.)?|dez(?:ember|\\.)?";
        const DAYS_DE = "mo(?:ntag|\\.)?|di(?:enstag|\\.)?|mi(?:ttwoch|\\.)?|do(?:nnerstag|\\.)?|fr(?:eitag|\\.)?|sa(?:mstag|\\.)?|so(?:nntag|\\.)?";
        this.addRule({
            type: 'DATE',
            pattern: new RegExp(`\\b(?:(?:${DAYS_DE})[\\s,.]*)?(?:[1-9]|[0-2]\\d|3[01])\\.\\s+(?:${MONTHS_DE})(?:\\s+(?:19|20)\\d{2})?\\b`, 'gi')
        });

        // 9. Spanish Dates (ES)
        // Lunes, Lun., Lun | Enero, Ene., Ene
        const MONTHS_ES = "ene(?:ro|\\.)?|feb(?:rero|\\.)?|mar(?:zo|\\.)?|abr(?:il|\\.)?|may(?:o|\\.)?|jun(?:io|\\.)?|jul(?:io|\\.)?|ago(?:sto|\\.)?|sept(?:iembre|\\.)?|oct(?:ubre|\\.)?|nov(?:iembre|\\.)?|dic(?:iembre|\\.)?";
        const DAYS_ES = "lun(?:es|\\.)?|mar(?:tes|\\.)?|mi[eé]r(?:coles|\\.)?|jue(?:ves|\\.)?|vie(?:rnes|\\.)?|s[aá]b(?:ado|\\.)?|dom(?:ingo|\\.)?";
        this.addRule({
            type: 'DATE',
            pattern: new RegExp(`\\b(?:(?:${DAYS_ES})[\\s,.]*)?(?:[1-9]|[0-2]\\d|3[01])\\s+de\\s+(?:${MONTHS_ES})(?:\\s+de\\s+(?:19|20)\\d{2})?\\b`, 'gi')
        });

        // 10. Italian Dates (IT)
        // Lunedì, Lun., Lun | Gennaio, Gen., Gen
        const MONTHS_IT = "gen(?:naio|\\.)?|feb(?:braio|\\.)?|mar(?:zo|\\.)?|apr(?:ile|\\.)?|mag(?:gio|\\.)?|giu(?:gno|\\.)?|lug(?:lio|\\.)?|ago(?:sto|\\.)?|set(?:tembre|\\.)?|ott(?:obre|\\.)?|nov(?:embre|\\.)?|dic(?:embre|\\.)?";
        const DAYS_IT = "lun(?:ed[iì]|\\.)?|mar(?:ted[iì]|\\.)?|mer(?:coled[iì]|\\.)?|gio(?:ved[iì]|\\.)?|ven(?:erd[iì]|\\.)?|sab(?:ato|\\.)?|dom(?:enica|\\.)?";
        this.addRule({
            type: 'DATE',
            pattern: new RegExp(`\\b(?:(?:${DAYS_IT})[\\s,.]*)?(?:[1-9]|[0-2]\\d|3[01])\\s+(?:${MONTHS_IT})(?:\\s+(?:19|20)\\d{2})?\\b`, 'gi')
        });

        // 11. Dutch Dates (NL)
        // Maandag, Ma., Ma | Januari, Jan., Jan
        const MONTHS_NL = "jan(?:uari|\\.)?|feb(?:ruari|\\.)?|mrt|maart|apr(?:il|\\.)?|mei|jun(?:i|\\.)?|jul(?:i|\\.)?|aug(?:ustus|\\.)?|sep(?:tember|\\.)?|okt(?:ober|\\.)?|nov(?:ember|\\.)?|dec(?:ember|\\.)?";
        const DAYS_NL = "ma(?:andag|\\.)?|di(?:nsdag|\\.)?|wo(?:ensdag|\\.)?|do(?:nderdag|\\.)?|vr(?:ijdag|\\.)?|za(?:terdag|\\.)?|zo(?:ndag|\\.)?";
        this.addRule({
            type: 'DATE',
            pattern: new RegExp(`\\b(?:(?:${DAYS_NL})[\\s,.]*)?(?:[1-9]|[0-2]\\d|3[01])\\s+(?:${MONTHS_NL})(?:\\s+(?:19|20)\\d{2})?\\b`, 'gi')
        });

        // 12. Portuguese Dates (PT)
        // Segunda-feira, Seg., Seg | Janeiro, Jan., Jan
        const MONTHS_PT = "jan(?:eiro|\\.)?|fev(?:ereiro|\\.)?|mar(?:[çc]o|\\.)?|abr(?:il|\\.)?|mai(?:o|\\.)?|jun(?:ho|\\.)?|jul(?:ho|\\.)?|ago(?:sto|\\.)?|set(?:embro|\\.)?|out(?:ubro|\\.)?|nov(?:embro|\\.)?|dez(?:embro|\\.)?";
        const DAYS_PT = "seg(?:unda-feira|\\.)?|ter(?:[çc]a-feira|\\.)?|qua(?:rta-feira|\\.)?|qui(?:nta-feira|\\.)?|sex(?:ta-feira|\\.)?|s[aá]b(?:ado|\\.)?|dom(?:ingo|\\.)?";
        this.addRule({
            type: 'DATE',
            pattern: new RegExp(`\\b(?:(?:${DAYS_PT})[\\s,.]*)?(?:[1-9]|[0-2]\\d|3[01])\\s+de\\s+(?:${MONTHS_PT})(?:\\s+de\\s+(?:19|20)\\d{2})?\\b`, 'gi')
        });

        // 15. Month Year (No Day) - e.g. "July 2024", "Mars 2024"
        // Year is mandatory to avoid false positives (e.g. "May", "Mars")

        // EN
        this.addRule({ type: 'DATE', pattern: new RegExp(`\\b(?:${MONTHS_EN})[\\s,.-]+(?:19|20)\\d{2}\\b`, 'gi') });
        // FR
        this.addRule({ type: 'DATE', pattern: new RegExp(`\\b(?:${MONTHS_FR})[\\s,.-]+(?:19|20)\\d{2}\\b`, 'gi') });
        // DE
        this.addRule({ type: 'DATE', pattern: new RegExp(`\\b(?:${MONTHS_DE})[\\s,.-]+(?:19|20)\\d{2}\\b`, 'gi') });
        // IT
        this.addRule({ type: 'DATE', pattern: new RegExp(`\\b(?:${MONTHS_IT})[\\s,.-]+(?:19|20)\\d{2}\\b`, 'gi') });
        // NL
        this.addRule({ type: 'DATE', pattern: new RegExp(`\\b(?:${MONTHS_NL})[\\s,.-]+(?:19|20)\\d{2}\\b`, 'gi') });

        // ES (de match)
        this.addRule({ type: 'DATE', pattern: new RegExp(`\\b(?:${MONTHS_ES})\\s+de\\s+(?:19|20)\\d{2}\\b`, 'gi') });
        // PT (de match)
        this.addRule({ type: 'DATE', pattern: new RegExp(`\\b(?:${MONTHS_PT})\\s+de\\s+(?:19|20)\\d{2}\\b`, 'gi') });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { DateDetector }; }
else { (typeof self !== 'undefined' ? self : window).DateDetector = DateDetector; }
