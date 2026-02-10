/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('../../detector.js'); }

class PassDetector extends ContextualDetector {
    constructor() {
        super();

        // Contextual Pwd (Key: Value) - e.g. "password: admin123"
        this.addRule({
            type: 'SECRET',
            // Positive Lookbehind for keywords + separator (: or =)
            // Support keywords: password, mdp, pwd, pass, mot de passe, identifiant, login, wachtwoord, kennwort, passwort, contraseña, senha
            // Removed internal quote matching ["']? ... ["']? to prevent eating quotes
            pattern: /(?<=\b(?:password|passwd|pwd|pass|mdp|mot de passe|identifiant|login|wachtwoord|kennwort|passwort|contraseña|senha)\s*[:=]\s*)[a-zA-Z0-9@#$%^&+=!.\-_]{1,128}/gi,
            validator: (val) => true
        });

        // Complex Pwd (Loose)
        this.addRule({
            type: 'SECRET', // Mapped to SECRET
            // Removed delimiters: () {} [] : " ; ' < > . ,
            pattern: /[a-zA-Z0-9@!#$%^*_|~\-\/]{8,128}/g,
            dist: 40,
            keywords: ["password", "mdp", "pwd", "pass", "mot de passe", "identifiant", "login", "wachtwoord", "kennwort", "passwort", "contraseña", "senha"],
            uniqueMatch: true,
            validator: (val) => {
                return /(?=.*[\d@!#$%^*_|~\-\/])/.test(val);
            }
        });

        // Simple Pwd (Strict)
        this.addRule({
            type: 'SECRET', // Mapped to SECRET
            // Removed delimiters
            pattern: /[a-zA-Z0-9@!#$%^*_|~\-\/]{8,128}/g,
            dist: 40,
            keywords: ["password", "mdp", "pwd", "pass", "mot de passe", "identifiant", "login", "passwort"],
            uniqueMatch: true,
            validator: (val) => {
                // Must contain at least one Uppercase, Digit, or Special char.
                // Reject if it is purely lowercase letters.
                return !/^[a-z]+$/.test(val);
            }
        });

        // User Request: "a string of 8 char of more composed of letter, numbers and special char should be considered as password"
        // High Entropy Rule (No Context Required if strictly mixed)
        this.addRule({
            type: 'SECRET',
            // High Entropy: Removed delimiters , . < > " ' ( ) [ ] { } : ; \
            pattern: /\b[A-Za-z0-9!@#$%^&*_+=\-|\/?]{8,}\b/g,
            validator: (val) => {
                // Must contain at least one Letter, one Number, AND one Special char.
                const hasLetter = /[A-Za-z]/.test(val);
                const hasNumber = /\d/.test(val);
                const hasSpecial = /[!@#$%^&*_+=\-|\/?]/.test(val);
                return hasLetter && hasNumber && hasSpecial;
            }
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { PassDetector }; }
else { (typeof self !== 'undefined' ? self : window).PassDetector = PassDetector; }
