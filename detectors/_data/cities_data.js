/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

// Top Cities: Specific Asian hubs + Top Western Cities (Lowercase)
(function (global) {
    const sampleCities = [
        "mexico", "new york", "los angeles", "chicago", "toronto", "houston", "phoenix", "philadelphia",
        "san antonio", "san diego", "dallas", "san jose", "austin", "jacksonville", "fort worth", "columbus",
        "charlotte", "indianapolis", "san francisco", "seattle", "denver", "washington", "boston", "el paso",
        "nashville", "detroit", "oklahoma city", "portland", "las vegas", "memphis", "louisville", "baltimore",
        "milwaukee", "albuquerque", "tucson", "fresno", "sacramento", "mesa", "kansas city", "atlanta",
        "miami", "raleigh", "omaha", "long beach", "virginia beach", "oakland", "minneapolis", "tulsa",
        "arlington", "tampa", "new orleans", "montreal", "vancouver", "calgary", "ottawa", "edmonton",
        "moscow", "paris", "london", "madrid", "barcelona", "saint petersburg", "rome", "berlin",
        "athens", "milan", "istanbul", "kiev", "lisbon", "manchester", "birmingham", "hamburg",
        "munich", "vienna", "warsaw", "budapest", "bucharest", "prague", "brussels", "amsterdam",
        "stockholm", "copenhagen", "oslo", "helsinki", "dublin", "zurich", "geneva", "lyon",
        "marseille", "naples", "turin", "valencia", "seville", "frankfurt", "cologne", "stuttgart",
        "tokyo", "shanghai", "singapore", "hong kong", "beijing", "delhi",
    ];

    global.citiesdataSet = new Set(sampleCities);
    console.log("ChatWall: Loaded OSS Sample City Dataset (" + sampleCities.length + " entries).");

})(self);
