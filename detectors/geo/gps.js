/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class GpsDetector extends ContextualDetector {
    constructor() {
        super();

        // 1. Decimal Degrees (DD) - STRICT (Must have 6+ decimals)
        // e.g. 48.858400, 2.294500
        this.addRule({
            type: 'GPS',
            pattern: /[-+]?(?:90(?:\.0{6,})?|[1-8]?\d\.\d{6,}|0\.\d{6,}),\s+[-+]?(?:180(?:\.0{6,})?|(?:1[0-7]\d|[1-9]?\d)\.\d{6,}|0\.\d{6,})/g,
            validator: (val) => {
                const parts = val.split(',');
                if (parts.length !== 2) return false;
                const lat = parseFloat(parts[0]);
                const lon = parseFloat(parts[1]);
                return !isNaN(lat) && !isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
            }
        });

        // 2. Degrees Minutes Seconds (DMS)
        // e.g. 48°51′30.24″N 2°17′40.20″E
        this.addRule({
            type: 'GPS',
            pattern: /\d{1,3}°\s*\d{1,2}['′]\s*\d{1,2}(?:\.\d+)?["″]\s*[NSns][,\s]+\d{1,3}°\s*\d{1,2}['′]\s*\d{1,2}(?:\.\d+)?["″]\s*[EWew]/g
        });

        this.addRule({
            type: 'GPS',
            pattern: /\d{1,3}°\s*\d{1,2}(?:\.\d+)?['′]\s*[NSns][,\s]+\d{1,3}°\s*\d{1,2}(?:\.\d+)?['′]\s*[EWew]/g
        });

        // 4. Contextual Decimal Degrees (Relaxed Precision but Require Keyword)
        // User Request: "Loc: 34.0522, -118.2437" etc. using 4 decimals
        // Keywords: Loc, Coords, Pos, Map, GPS, Lat/Long, Position, Coordinates, Pin, Waypoint, Spot, Target, Geo
        this.addRule({
            type: 'GPS',
            // Pattern matches: Keyword[:] number, number
            pattern: /(?:Loc|Coords|Pos|Map|GPS|Lat\/Long|Position|Coordinates|Pin|Waypoint|Spot|Target|Geo)(?:\s*:)?\s*([-+]?\d{1,3}\.\d{4,}),\s*([-+]?\d{1,3}\.\d{4,})(?:\s*[NSEW])?/gi,
            validator: (val, match) => {
                // match is the regex exec result, so match[1] and match[2] capture the numbers
                if (!match) return false;
                // If using ContextualDetector base scan, match is { index, text, match: RegExpExecArray }
                // Wait, base scan passes (mText, { index, text, match }) to validator.
                // But the regex itself includes the keyword prefix which confirms context.
                // We just need to check bounds.

                // Extract numbers from the text if captured groups aren't passed directly as args in this implementation
                // Re-parsing for safety or using the passed match object if available
                const parts = val.match(/([-+]?\d{1,3}\.\d{4,})/g);
                if (!parts || parts.length < 2) return false;

                const lat = parseFloat(parts[0]);
                const lon = parseFloat(parts[1]);

                if (isNaN(lat) || isNaN(lon)) return false;
                if (Math.abs(lat) > 90) return false;
                if (Math.abs(lon) > 180) return false;

                return true;
            }
        });

        // 5. Decimal Degrees with Cardinal Directions (No Keyword Required)
        // e.g. "51.5074° N, 0.1278° W" or "51.5074 N, 0.1278 W"
        this.addRule({
            type: 'GPS',
            pattern: /\b\d{1,3}(?:\.\d+)?\s*°?\s*[NSns]\s*[,]\s*\d{1,3}(?:\.\d+)?\s*°?\s*[EWew]\b/g,
            validator: (val) => {
                // Extract numbers
                const parts = val.match(/(\d{1,3}(?:\.\d+)?)/g);
                if (!parts || parts.length < 2) return false;

                const lat = parseFloat(parts[0]);
                const lon = parseFloat(parts[1]);

                if (isNaN(lat) || isNaN(lon)) return false;
                if (lat > 90) return false;
                if (lon > 180) return false;

                return true;
            }
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { GpsDetector }; }
else { (typeof self !== 'undefined' ? self : window).GpsDetector = GpsDetector; }
