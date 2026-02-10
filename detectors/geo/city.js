/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }
const CITY_CONTEXTS = [
    // English
    "live in", "living in", "residing in", "located in", "based in", "moved to", "travel to", "going to", "come from", "from",
    // French
    "habite à", "habite a", "vivre à", "vivre a", "résidant à", "situé à", "basé à", "déménagé à", "voyager à", "aller à", "viens de", "venant de", "de",
    // German
    "lebe in", "wohne in", "ansässig in", "gezogen nach", "reise nach", "gehe nach", "komme aus", "aus",
    // Spanish
    "vivo en", "viviendo en", "residiendo en", "basado en", "situado en", "mudarse a", "viajar a", "ir a", "venir de", "de",
    // Italian
    "vivo a", "abito a", "resiedere a", "situato a", "basato a", "trasferito a", "viaggiare a", "andare a", "vengo da", "da",
    // Portuguese
    "moro em", "vivendo em", "residindo em", "baseado em", "situado em", "mudou-se para", "viajar para", "ir para", "vir de", "de",
    // Dutch
    "woon in", "wonend in", "gevestigd in", "verhuisd naar", "reizen naar", "gaan naar", "kom uit", "uit"
].sort((a, b) => b.length - a.length).join("|");

class CityDetector extends ContextualDetector {
    constructor() {
        super();

        const getCitiesDataSet = () => {

            // Also check for 'cityset' as used in sample data or alternative configurations
            if (typeof cityset !== 'undefined') return cityset;
            if (typeof window !== 'undefined' && window.cityset) return window.cityset;
            if (typeof self !== 'undefined' && self.cityset) return self.cityset;

            return null;
        };

        const getCommonCities = () => {
            if (typeof commoncitiesdataSet !== 'undefined') return commoncitiesdataSet;
            if (typeof window !== 'undefined' && window.commoncitiesdataSet) return window.commoncitiesdataSet;
            if (typeof self !== 'undefined' && self.commoncitiesdataSet) return self.commoncitiesdataSet;
            return null;
        };

        // 1. Context-Based City Rule (Requires Uppercase)
        this.addRule({
            type: 'CITY',
            pattern: /\b\p{Lu}[\p{L}-]+\b/gu,
            contextBefore: new RegExp(`(?:${CITY_CONTEXTS})[ ]+$`, 'i'),
            validator: (word) => {
                const lower = word.toLowerCase();
                const title = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

                const commonCities = getCommonCities();
                const citiesData = getCitiesDataSet();

                if ((typeof cityset !== 'undefined' && cityset.has(lower)) ||
                    (typeof cityNamesSet !== 'undefined' && cityNamesSet.has(lower)) ||
                    (citiesData && (citiesData.has(title)))) {
                    return true;
                }
                return false;
            }
        });

        // 2. Standard Capitalized City Rule
        this.addRule({
            type: 'CITY',
            pattern: /\b\p{Lu}[\p{L}-]+\b/gu,
            validator: (word, context) => { // context = { index, text }
                const lower = word.toLowerCase();
                const title = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

                const commonCities = getCommonCities();

                // 3. Common City Checks (Strict Mode)
                if (commonCities) {

                    const isCommon = commonCities.has(title);

                    if (isCommon) {
                        if (context && context.text) {
                            const remaining = context.text.substring(context.index + word.length);
                            const separatorMatch = remaining.match(/^[ \t]*[, ]+[ \t]*/);

                            if (separatorMatch && typeof countryNamesSet !== 'undefined') {
                                const afterSeparator = remaining.substring(separatorMatch[0].length);
                                // Split into words (max 5) to check for multi-word country names
                                const tokens = afterSeparator.split(/[ \t\r\n]+/).slice(0, 5);

                                // Check increasing lengths: "United", "United States", "United States of America"
                                for (let i = 1; i <= tokens.length; i++) {
                                    const candidate = tokens.slice(0, i).join(' ').replace(/[^\w\s\.\-']/g, ''); // Clean punctuation trailing

                                    // Check exact, Uppercase (set has variants), and Title Case
                                    if (countryNamesSet.has(candidate) ||
                                        countryNamesSet.has(candidate.toUpperCase()) ||
                                        countryNamesSet.has(candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase())) {
                                        return true; // SAFE: City followed by Country
                                    }
                                }
                            }

                            return false;
                        }
                    }

                    if (typeof cityset !== 'undefined') {
                        if (cityset.has(lower)) return true;
                        if (cityset.has(lower.normalize('NFC'))) return true;
                    }
                    if (typeof cityNamesSet !== 'undefined') {
                        if (cityNamesSet.has(lower)) return true;
                    }

                    const citiesData = getCitiesDataSet();
                    if (citiesData) {
                        // Check against TitleCase data
                        if (citiesData.has(title)) return true;

                    }

                    if (commonCities) {
                        if (commonCities.has(title)) return true;

                    }

                    return false;
                }
            }
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { CityDetector }; }
else { (typeof self !== 'undefined' ? self : window).CityDetector = CityDetector; }
