/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

/**
 * Base Detector Class for all regex and context-based detectors.
 */
if (typeof ContextualDetector === 'undefined') {
    var ContextualDetector = class ContextualDetector {
        constructor() {
            this.rules = [];
        }

        /**
         * Add a detection rule.
         * @param {Object} rule 
         * @param {RegExp} rule.pattern - Main regex to match. Must use global flag 'g'.
         * @param {string} rule.type - Output entity type (e.g. 'NAME', 'PHONE').
         * @param {RegExp} [rule.contextBefore] - Regex to validate text IMMEDIATELY preceding the match.
         * @param {RegExp} [rule.contextAfter] - Regex to validate text IMMEDIATELY following the match.
         * @param {number} [rule.dist] - Max distance for context lookback/lookahead (default: 0 = immediate/regex based). 
         *                               If set, contextBefore/After checks within this window.
         * @param {string[]} [rule.keywords] - List of keywords for loose context checking (if dist > 0).
         * @param {Function} [rule.validator] - Function(matchText): boolean. Returns true if valid.
         */
        addRule(rule) {
            if (!rule.pattern) throw new Error("Rule must have a pattern regex");
            if (!rule.type) throw new Error("Rule must have a type");
            this.rules.push(rule);
        }

        /**
         * Helper: Check loose context (keywords within distance)
         */
        checkLooseContext(text, index, matchLen, rule) {
            if (!rule.keywords || rule.keywords.length === 0) return true; // No context required

            const dist = rule.dist || 50;
            const start = Math.max(0, index - dist);
            const end = Math.min(text.length, index + matchLen + dist);

            // Before Context
            const beforeText = text.substring(start, index).toLowerCase();
            // After Context
            // const afterText = text.substring(index + matchLen, end).toLowerCase(); // Not used currently for keywords, usually lookbehind

            // Check if any keyword exists in the lookback window
            // STRICT: We check distance from Keyword END to Match START
            // Check if any keyword exists in the lookback window
            // STRICT: We check distance from Keyword END to Match START
            return rule.keywords.some(kw => {
                const kwIdx = beforeText.lastIndexOf(kw);
                if (kwIdx === -1) return false;

                // 1. Word Boundary Check (Start)
                // Check character before the keyword
                if (kwIdx > 0) {
                    const charBefore = beforeText[kwIdx - 1];
                    // If char before is a letter/digit, then keyword is part of a longer word prefix
                    if (/[a-z0-9]/.test(charBefore)) return false;
                } else if (start > 0) {
                    // kw is at start of window, check text just outside window
                    const charBefore = text[start - 1];
                    if (/[a-zA-Z0-9]/.test(charBefore)) return false;
                }

                // Check what is between keyword and match
                const gap = beforeText.substring(kwIdx + kw.length);

                // 2. Word Boundary Check (End)
                // If the immediate next char (gap[0]) is a letter/digit, it's a longer word suffix (e.g. "pass" in "passeport")
                if (gap.length > 0 && /[a-z0-9]/.test(gap[0])) return false;

                // Barrier Check: Don't cross newlines or sentence endings if strict
                const barrierRegex = /[\r\n]|\. /;
                if (barrierRegex.test(gap)) return false;

                // Distance check (already constrained by substring, but precise check)
                if (gap.length > dist) return false;

                // 3. Unique Match Check (Shadowing)
                // If requested, ensure no OTHER valid matches exist in the gap (e.g. "Password: [match1] [match2]")
                // If we are looking at match2, and match1 is in the gap, then match2 shouldn't use this "Password" keyword.
                if (rule.uniqueMatch) {
                    // We need to check the gap in the ORIGINAL text to preserve case for regex
                    // Absolute start of gap = start + kwIdx + kw.length
                    const absGapStart = start + kwIdx + kw.length;
                    const realGap = text.substring(absGapStart, index);

                    // CRITICAL: Clone regex to avoid resetting rule.pattern.lastIndex (used by the outer scan loop)
                    const patternClone = new RegExp(rule.pattern.source, rule.pattern.flags);
                    const gapMatches = realGap.match(patternClone);

                    if (gapMatches) {
                        // If validator exists, verify the gap matches are valid. 
                        // If any is valid, then we are shadowed.
                        if (rule.validator) {
                            if (gapMatches.some(m => rule.validator(m))) return false;
                        } else {
                            // No validator, existence is enough to shadow
                            return false;
                        }
                    }
                }

                return true;
            });
        }

        /**
         * Scan text using all registered rules.
         * @param {string} text 
         * @returns {Array} Matches { text, type, start, end }
         */
        scan(text) {
            if (!text) return [];
            let matches = [];
            let ranges = [];

            const isOverlapping = (start, end) => {
                return ranges.some(r => (start < r.end && end > r.start));
            };

            for (const rule of this.rules) {
                rule.pattern.lastIndex = 0;
                let match;
                while ((match = rule.pattern.exec(text)) !== null) {
                    const mText = match[0];
                    const start = match.index;
                    const end = start + mText.length;

                    if (isOverlapping(start, end)) continue;

                    // 1. Validator Check
                    if (rule.validator && !rule.validator(mText, { index: start, text: text, match: match })) continue;

                    // 2. Strict Regex Context Check (Immediate)
                    if (rule.contextBefore) {
                        const before = text.substring(0, start);
                        // Test end of string
                        if (!rule.contextBefore.test(before)) continue;
                        // Note: Simple regex test on substring might satisfy "contains", 
                        // usually we want "ends with" for contextBefore.
                        // User's regexes in content.js were lookbehinds or keyword based.
                        // If contextBefore provided, we assume the user crafted it to match the immediate predecessor.
                    }

                    // 3. Loose Keyword Context Check
                    if (rule.dist && rule.keywords) {
                        if (!this.checkLooseContext(text, start, mText.length, rule)) continue;
                    }

                    matches.push({
                        text: mText,
                        type: rule.type,
                        start: start,
                        end: end
                    });
                    ranges.push({ start, end });
                }
            }

            return matches.sort((a, b) => a.start - b.start);
        }
    };

    // Export
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { ContextualDetector };
    } else {
        var globalScope = (typeof self !== 'undefined') ? self : window;
        globalScope.ContextualDetector = ContextualDetector;
    }
}
