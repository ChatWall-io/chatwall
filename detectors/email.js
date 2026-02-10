

if (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) { const { ContextualDetector } = require('./detector.js'); }

class EmailDetector extends ContextualDetector {
    constructor() {
        super();
        this.addRule({
            type: 'EMAIL',
            // Presidio Email Regex (RFC 5322 compatible)
            pattern: /\b((?:[!#$%&'*+\-/=?^_`{|}~\w]|(?:[!#$%&'*+\-/=?^_`{|}~\w][!#$%&'*+\-/=?^_`{|}~\.\w]*[!#$%&'*+\-/=?^_`{|}~\w]))[@]\w+(?:[-.]\w+)*\.\w+(?:[-.]\w+)*)\b/gi
        });
    }
}
if (typeof module !== 'undefined' && module.exports) { module.exports = { EmailDetector }; }
else { (typeof self !== 'undefined' ? self : window).EmailDetector = EmailDetector; }
