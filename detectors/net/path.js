/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class PathDetector extends ContextualDetector {
    constructor() {
        super();

        // Windows Paths
        this.addRule({
            type: 'PATH',
            // C:\Users\..., D:\Data\..., \\Server\Share\..., \Project\Src\...
            // Expanded to support Root-Relative paths starting with single backslash `\` followed by valid chars
            pattern: /(?:[a-zA-Z]:|\\\\[a-zA-Z0-9_.$]+\\[a-zA-Z0-9_.$]+|\\[a-zA-Z0-9_.$]+)\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]+/gi,
            validator: (val) => val.length > 5 && val.includes('\\')
        });

        // Unix/Linux Paths (Strong Roots - Context Independent)
        // Supported Roots: Standard (/var, /usr...), Tilde (~), and Hidden files support
        this.addRule({
            type: 'PATH',
            pattern: /(?:^|[\s"':;=,(\[<>*])((?:~|(?:\/(?:var|usr|home|etc|opt|bin|sbin|tmp|root|boot|dev|lib|lib64|mnt|media|srv|sys|proc)))(?:\/[.a-zA-Z0-9_-]+)+)/g
        });

        // General Unix Path (Requires 3+ slashes OR context if 2)
        this.addRule({
            type: 'PATH',
            // Negative lookbehind to avoid http:// or https:// (simplified as not preceded by :)
            pattern: /(?<!:)(?:\/[a-zA-Z0-9._-]+){2,}/g,
            dist: 20,
            keywords: ["path", "dir", "directory", "file", "folder", "output", "input", "log", "config"],
            validator: (val) => {
                // Reject invalid starts
                if (val.startsWith('//')) return false;

                // Reject common URL/Date patterns
                if (/^\/\d{2,4}\/\d{2}\/\d{2}/.test(val)) return false;
                if (val.length < 6) return false;

                // If explicit high-signal root, allow (already covered by rule 1, but safe to double check)
                if (/^\/(var|usr|home|etc|opt|bin|sbin|tmp|root|boot|dev)\//.test(val)) return true;

                // Otherwise require more signal
                if ((val.match(/\//g) || []).length < 3) return false; // Require at least 3 slashes if no specific root/keyword

                return true;
            }
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { PathDetector }; }
else { (typeof self !== 'undefined' ? self : window).PathDetector = PathDetector; }
