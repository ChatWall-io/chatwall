/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 *
 * Top world countries + main Western European countries.
 */

var countryNamesSet = new Set([
    // === TOP WORLD COUNTRIES ===
    "Australia",
    "Brazil", "Brasil",
    "Canada",
    "China",
    "India",
    "Japan",
    "Russia",
    "United States", "USA",

    // === WESTERN EUROPE ===
    "France",
    "Germany", "Deutschland",
    "Italy", "Italia",
    "Netherlands", "Nederland",
    "Spain", "España",
    "United Kingdom", "UK"
]);
