/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

/**
 * NameDetector
 * Detects: NAME
 * Logic:
 * 1. First Name (Known) -> NAME
 * 2. Last Name (Known) -> NAME (Only if context present)
 * 3. Prefix + Capitalized Word -> NAME
 * 4. Greeting + Capitalized Word -> NAME
 * 5. Patterns from Content Scripts (Username context)
 */
// Safe Initialization
let NameDetectorDeps = {
    ContextualDetector: (typeof ContextualDetector !== 'undefined' ? ContextualDetector : undefined),
    FIRST_NAMES: (typeof firstnamesdataSet !== 'undefined' ? firstnamesdataSet : undefined),
    LAST_NAMES: (typeof lastnamesdataSet !== 'undefined' ? lastnamesdataSet : undefined),
    COMMON_NAMES: (typeof commonnamesdataSet !== 'undefined' ? commonnamesdataSet : undefined)
};

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) {
    const detectorMod = require('../detector.js');
    NameDetectorDeps.ContextualDetector = detectorMod.ContextualDetector;

    // Check if files map export correctly, handling potential named exports or global side-effects
    try {
        // Ensure self is defined for data files that rely on it (IIFE pattern)
        if (typeof self === 'undefined') {
            global.self = global;
        }

        require('./_data/first_names_data.js');
        if (typeof firstnamesdataSet !== 'undefined') {
            NameDetectorDeps.FIRST_NAMES = firstnamesdataSet;
        }

        require('./_data/last_names_data.js');
        if (typeof lastnamesdataSet !== 'undefined') {
            NameDetectorDeps.LAST_NAMES = lastnamesdataSet;
        }

        const cnMod = require('./_data/common_names_data.js'); // Correctly uses commonnamesdataSet inside?
        // If common_names_data.js also writes to global, we can check global, otherwise check export
        if (cnMod && cnMod.commonnamesdataSet) {
            NameDetectorDeps.COMMON_NAMES = cnMod.commonnamesdataSet;
        } else if (typeof commonnamesdataSet !== 'undefined') {
            NameDetectorDeps.COMMON_NAMES = commonnamesdataSet;
        }
    } catch (e) {
        // Fallback or ignore in non-node envs if require exists but fails
    }
}

// Safe resolution of ContextualDetector (CD)
// If NameDetectorDeps.ContextualDetector is missing (load order issue), try global scope directly
const CD = NameDetectorDeps.ContextualDetector || (typeof ContextualDetector !== 'undefined' ? ContextualDetector : class { addRule() { } });

// Dynamic Data Accessors (Handle async loading)
const getFN = () => (typeof firstnamesdataSet !== 'undefined' ? firstnamesdataSet : NameDetectorDeps.FIRST_NAMES);
const getLN = () => (typeof lastnamesdataSet !== 'undefined' ? lastnamesdataSet : NameDetectorDeps.LAST_NAMES);
const getCN = () => (typeof commonnamesdataSet !== 'undefined' ? commonnamesdataSet : NameDetectorDeps.COMMON_NAMES);


// Prefixes
// Prefixes (Sorted by length descending to ensure longest match first)
const RAW_PREFIXES = [
    // English
    "Mister", "Miss", "Misses", "Mrs", "Mrs\\.", "Ms", "Ms\\.", "Mr", "Mr\\.", "Mx", "Mx\\.",
    "Doctor", "Dr", "Dr\\.", "Professor", "Prof", "Prof\\.", "Sir", "Madam", "Dame", "Lord", "Lady",

    // French
    "Monsieur", "Madame", "Mademoiselle", "Mme", "Mme\\.", "Mlle", "Mlle\\.", "M", "M\\.",
    "Docteur", "Professeur", "Maitre", "Maître", "Mgr", "Monseigneur", "Veuve",

    // German
    "Herr", "Frau", "Doktor", "Professor", "Dr", "Dr\\.", "Prof", "Prof\\.",

    // Spanish
    "Señor", "Señora", "Señorita", "Don", "Doña", "Sr", "Sr\\.", "Sra", "Sra\\.", "Srta", "Srta\\.",
    "Licenciado", "Licenciada", "Lic", "Lic\\.",

    // Italian
    "Signore", "Signora", "Signorina", "Signor", "Sig", "Sig\\.", "Sig\\.ra", "Sig\\.na",
    "Dottore", "Dottoressa", "Dott", "Dott\\.", "Dott\\.ssa", "Avvocato", "Avv", "Avv\\.",

    // Portuguese
    "Senhor", "Senhora", "Senhorita", "Dom", "Dona", "Sr", "Sr\\.", "Sra", "Sra\\.", "Srta", "Srta\\.",

    // Dutch
    "Meneer", "Mevrouw", "Juffrouw", "De heer", "Dhr", "Dhr\\.", "Mevr", "Mevr\\.", "Juf", "Ing", "Ir",

    // Arabic / Honorifics
    "Sheikh", "Abu", "Umm"
];

// Sort matches by length descending for regex safety
const PREFIXES = RAW_PREFIXES.sort((a, b) => b.length - a.length).join("|");

// --- SHARED GLOBALS (used by background.js and content/04_processing.js) ---
// Exported as globals to avoid duplicating the honorific list in multiple files.
var HONORIFIC_PREFIXES = RAW_PREFIXES;
var HONORIFIC_RE = new RegExp(`(?:${PREFIXES})\\s*$`, 'i');

// Greetings
const GREETINGS = [
    "Hi", "Hello", "Hey", "Dear", "Greetings",
    "Call", "Contact", "Phone", "Ring", // EN
    "Hola", "Bonjour", "Salut", "Ciao", "Salve", "Olá", "Estimado",
    "Appeler", "Appelez", "Contacter", "Contactez", // FR
    "Llamar", "Llame", "Contactar", "Contacte", // ES
    "Chiamare", "Chiama", "Contattare", "Contatta", // IT
    "Ligar", "Ligue", "Contatar", "Contactar", // PT
    "Anrufen", "Kontaktieren", "Rufen", // DE
    "Hallo", "Hej", "Moin", "Guten Tag",
    "Namaste", "Salaam"
].join("|");

// Introductions / Self-Identification / Impersonal Context
const INTRODUCTIONS = [
    // Self
    "my name is", "i am", "this is",
    "je m'appelle", "mon nom est", "je suis", "voici", "c'est",
    "ich heiße", "mein name ist", "ich bin",
    "me llamo", "mi nombre es", "soy",
    "mi chiamo", "il mio nome è", "sono",
    "meu nome é", "eu sou",
    "mijn naam is", "ik heet", "ik ben",

    // Impersonal / Third-party
    "his name is", "her name is", "their name is", "named", "called", "by the name of",
    "son nom est", "sa nom est", "du nom de", "s'appelant", "nommé", "prénommé", "surnommé",
    "sein name ist", "ihr name ist", "namens", "genannt",
    "su nombre es", "se llama", "llamado", "de nombre",
    "il suo nome è", "si chiama", "chiamato", "di nome",
    "seu nome é", "o nome dele é", "o nome dela é", "chamado",
    "zijn naam is", "haar naam is", "genaamd", "met de naam",

    // Explicit Labels (acting as introduction context)
    "prénom", "nom", "surnom",
    "first name", "last name", "nickname", "surname",
    "vorname", "nachname", "spitzname",
    "nombre", "apellido", "apodo",
    "nome", "cognome", "soprannome",
    "sobrenome", "apelido",
    "voornaam", "achternaam", "bijnaam"
].sort((a, b) => b.length - a.length).join("|");

class NameDetector extends CD {
    constructor() {
        super();

        // Helper for casing
        const toTitleCase = (str) => {
            if (!str) return str;
            return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
        };

        // Helper to check if ignored (Common words)
        // User requested case-insensitive check against Common List
        const isIgnored = (word) => {
            const CN = getCN();
            if (!CN) return false;
            const lower = word.toLowerCase();
            const title = toTitleCase(word);

            // Check both lowercase and TitleCase in Common List
            if (CN.has(lower)) return true;
            if (CN.has(title)) return true;

            return false;
        };

        // Helper to check if a word is a Known Last Name
        const isKnownLastName = (w) => {
            const LN = getLN();
            if (!LN) return false;
            const check = (part) => {
                const title = toTitleCase(part);
                const lower = part.toLowerCase();
                // DB is Lowercase, but we check both just in case DB changes style, or primary is Lower
                return LN.has(lower) || LN.has(title);
            };
            if (w.includes('-')) {
                return w.split('-').every(p => check(p));
            }
            return check(w);
        };

        // Helper to check if a word is ANY Known Name (First or Last)
        const isKnownName = (w) => {
            const FN = getFN();
            const LN = getLN();
            const check = (part) => {
                const title = toTitleCase(part);
                const lower = part.toLowerCase();
                // DB is Lowercase
                return (FN && (FN.has(lower) || FN.has(title))) || (LN && (LN.has(lower) || LN.has(title)));
            };
            if (w.includes('-')) {
                return w.split('-').every(p => check(p));
            }
            return check(w);
        };

        // 1. PREFIX Rule (Greedy Name Match)
        // Mr. Smith, Mr. Philippe Collignon
        // Context: Prefix
        // Match: 1 or more Capitalized Words (Greedy)
        this.addRule({
            type: 'NAME',
            pattern: new RegExp(`\\b(?!(?:${PREFIXES})\\b)\\p{Lu}[\\p{L}-]+(?:[^\\S\\r\\n]+(?!(?:${PREFIXES})\\b)\\p{Lu}[\\p{L}-]+)*\\b`, 'gu'),
            contextBefore: new RegExp(`(?:${PREFIXES})[^\\S\\r\\n]+$`, 'u'),
            validator: (match) => {

                return true;
            }
        });


        // 2. COMPOSITE NAME Rule
        // Philippe Collignon, COLLIGNON Philippe
        // Matches 2 or more Capitalized Words where at least ONE is a known First Name
        // Negative Lookahead `(?!(?:${GREETINGS}|${INTRODUCTIONS})\b)` ensures we don't start with a Greeting (e.g. "Bonjour Philippe Collignon")
        // This forces the match to start AFTER the greeting ("Philippe Collignon"), allowing meaningful validation.
        this.addRule({
            type: 'NAME',
            // Changed to [^\\S\\r\\n]+ to strictly match horizontal whitespace (prevent multi-line)
            pattern: new RegExp(`\\b(?!(?:${GREETINGS}|${INTRODUCTIONS}|${PREFIXES})\\b)\\p{Lu}[\\p{L}-]+(?:[^\\S\\r\\n]+(?!(?:${GREETINGS}|${INTRODUCTIONS}|${PREFIXES})\\b)\\p{Lu}[\\p{L}-]+)+\\b`, 'gu'),
            validator: (match) => {
                const words = match.split(/[\s]+/);

                // 1. Must contain at least one Known Name part
                // (This filters out random capitalized phrases like "Status OK")
                const hasKnownPart = words.some(w => isKnownName(w));
                if (!hasKnownPart) return false;

                // 2. Reject if any part is "Invalid Common"
                /* 
                   User Logic for Common Words in Composite Names:
                   - if it is followed or following a known LAST NAME then accept it
                   - else ignore it (reject the match)
                */
                const hasInvalidCommonPart = words.some((w, index) => {
                    // If word is NOT common, it's safe
                    if (!isIgnored(w)) return false;

                    // It IS Common. Check if accepted by context (Adjacent to Known Last Name OR Known First Name)
                    const prev = index > 0 ? words[index - 1] : null;
                    const next = index < words.length - 1 ? words[index + 1] : null;

                    const hasTrustedContext =
                        (prev && isKnownName(prev)) ||
                        (next && isKnownName(next));

                    if (hasTrustedContext) return false; // Approved by neighbor

                    return true; // Common + No Trusted Neighbor -> INVALID
                });

                if (hasInvalidCommonPart) return false;

                return true;
            }
        });

        // 3. GREETING Rule
        // Hello John, Hello david (if david in FN AND not common), Hello Collignon
        // Strict separation: Greeting followed by SPACES only
        this.addRule({
            type: 'NAME',
            pattern: new RegExp(`\\b(?!(?:${PREFIXES})\\b)\\p{Lu}[\\p{L}-]+\\b`, 'gu'), // STRICT: Capitalized only -> User request: "do not allow full lower case"
            contextBefore: new RegExp(`(?:${GREETINGS})[ ]+$`, 'i'),
            validator: (match) => {
                const title = toTitleCase(match);

                // If Capitalized -> Valid (Context "Hello X" is strong)
                if (/^\p{Lu}/u.test(match)) {
                    // But if it is Common, check strict rules
                    if (isIgnored(match)) {
                        /* 
                           User Logic: "if it is alone and with context (best, hi ...) then accept it"
                           Implied: Accept common words in greeting ONLY if they are actually known names.
                           (e.g. "Hi Will" -> Accept, "Hi Table" -> Reject)
                        */
                        if (!isKnownName(match)) return false;
                    }
                    return true;
                }

                // If not capitalized (should be filtered by regex, but double check)
                return false;
            }
        });

        // 4. INTRODUCTION Rule
        // My name is John, My name is david
        this.addRule({
            type: 'NAME',
            pattern: new RegExp(`\\b(?!(?:${PREFIXES})\\b)\\p{Lu}[\\p{L}-]+\\b`, 'gu'), // STRICT: Capitalized only -> Temporarily disabled
            contextBefore: new RegExp(`(?:${INTRODUCTIONS})[\\s]+$`, 'i'),
            validator: (match) => {
                const title = toTitleCase(match);

                // If Capitalized -> Valid (Context "Introduction X" is strong)
                if (/^\p{Lu}/u.test(match)) {
                    if (isIgnored(match)) {
                        if (!isKnownName(match)) return false;
                    }
                    return true;
                }
                return false;
            }
        });

        // 5. FIRST NAME (Standalone) -> ENABLED (User Request 2026-01-07)
        this.addRule({
            type: 'NAME',
            pattern: /\b\p{Lu}[\p{L}-]{1,30}\b/gu,
            validator: (word) => {
                // Must NOT be Ignored (Common + Blacklist)
                if (isIgnored(word)) return false;

                const title = toTitleCase(word);
                const FN = getFN();
                if (FN && FN.has(title)) {
                    return true;
                }
                // Handle Hyphenated Names (Jean-Marie) if parts are known
                if (word.includes('-')) {
                    const parts = word.split('-');
                    if (parts.length > 0 && parts.every(p => FN && FN.has(toTitleCase(p)))) {
                        return true;
                    }
                }
                return false;
            }
        });

        // 5b. COMMON NAME (Mid-Sentence Exception) -> ENABLED 
        // Accepts "Pierre" if it appears in the middle of a sentence (preceded by lowercase/comma)
        // This rescues Common Names that were rejected by Rule 5 because they are Common.
        /* this.addRule({
             type: 'NAME',
             pattern: /\b\p{Lu}[\p{L}-]{1,30}\b/gu,
             // Context: Preceded by lowercase letter, digit, comma, semicolon, colon followed by space
             // This signals we are INSIDE a sentence, not at the start.
             contextBefore: /(?:[\p{Ll}0-9,;:])\s+$/u,
             validator: (word) => {
                 // 1. Only rescue words that ARE Ignored (Common)
                 if (!isIgnored(word)) return false; // Handled by Rule 5
 
                 // 2. Must be a Known Name (e.g. Pierre)
                 if (isKnownName(word)) return true;
 
                 return false;
             }
         });*/

        // 6. LAST NAME (Context Required)
        // Detects "Smith" (Common) ONLY if context exists.
        this.addRule({
            type: 'NAME',
            pattern: /\b\p{Lu}[\p{L}-]{1,30}\b/gu,
            dist: 10,
            keywords: ["name", "nom", "user", "mr", "mrs", "dr", "hello", "hi"],
            validator: (word) => {
                const title = toTitleCase(word);
                const LN = getLN();
                const isLastName = (LN && LN.has(title));
                if (!isLastName) return false;
                return true;
            }
        });

        // 7. LAST NAME (Standalone if not common) 

        this.addRule({
            type: 'NAME',
            pattern: /\b\p{Lu}[\p{L}-]{1,30}\b/gu,
            validator: (word) => {
                const lower = word.toLowerCase();
                const title = toTitleCase(word);
                const LN = getLN();

                // Must be in Last Names
                if (!LN || !LN.has(title)) return false;

                // Must NOT be Ignored
                if (isIgnored(word)) return false;

                // Explicitly exclude known Greetings/Prefixes/Intros relative to this file's constants
                // (Matches regex lists defined above: RAW_PREFIXES, GREETINGS, INTRODUCTIONS)
                // Use strict check against arrays
                if (RAW_PREFIXES.includes(word) || RAW_PREFIXES.includes(word + ".")) return false;

                // GREETINGS and INTRODUCTIONS are strings joined by |
                if (new RegExp(`^(?:${GREETINGS})$`, 'i').test(word)) return false;
                if (new RegExp(`^(?:${INTRODUCTIONS})$`, 'i').test(word)) return false;

                return true;
            }
        });


        // 6. USERNAME / EXPLICIT CONTEXT (from content.js)
        // User Requirement: Must have : or = between keyword and name
        const USERNAME_KEYWORDS = [
            "username", "login", "user", "user_name", "pseudo", "handle", "alias", "identifiant",
            "nom d'utilisateur", "utilisateur", "benutzername", "nome utente", "nombre de usuario"
        ].sort((a, b) => b.length - a.length).join("|");

        this.addRule({
            type: 'NAME',
            pattern: /\b[a-zA-Z0-9._-]{3,30}\b/g,
            // Context: Keyword followed by optional space, then : or =, then optional space
            contextBefore: new RegExp(`(?:${USERNAME_KEYWORDS})\\s*[:=]\\s*$`, 'i'),
            validator: (val) => val.length > 2
        });

        // 7. Explicit "First Name" / "Last Name" Label Context (from content.js)
        this.addRule({
            type: 'NAME',
            pattern: /\b[A-Z][a-z]+(?:[- ][A-Z][a-z]+)*\b/g,
            dist: 20,
            keywords: [
                "first_name", "last_name", "full_name", "first name", "last name", "surname",
                "nom", "prenom", "apellidos", "nombre", "apellido", "vorname", "nachname"
            ]
        });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NameDetector };
} else {
    var globalScope = (typeof self !== 'undefined') ? self : window;
    globalScope.NameDetector = NameDetector;
}
