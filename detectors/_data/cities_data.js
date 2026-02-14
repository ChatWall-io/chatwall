/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */

// Top Cities: Specific Asian hubs + Top Western Cities (Title Case)
(function (global) {
    const sampleCities = [
        "Mexico", "New York", "Los Angeles", "Chicago", "Toronto", "Houston", "Phoenix", "Philadelphia",
        "San Antonio", "San Diego", "Dallas", "San Jose", "Austin", "Jacksonville", "Fort Worth", "Columbus",
        "Charlotte", "Indianapolis", "San Francisco", "Seattle", "Denver", "Washington", "Boston", "El Paso",
        "Nashville", "Detroit", "Oklahoma City", "Portland", "Las Vegas", "Memphis", "Louisville", "Baltimore",
        "Milwaukee", "Albuquerque", "Tucson", "Fresno", "Sacramento", "Mesa", "Kansas City", "Atlanta",
        "Miami", "Raleigh", "Omaha", "Long Beach", "Virginia Beach", "Oakland", "Minneapolis", "Tulsa",
        "Arlington", "Tampa", "New Orleans", "Montreal", "Vancouver", "Calgary", "Ottawa", "Edmonton",
        "Moscow", "Paris", "London", "Madrid", "Barcelona", "Saint Petersburg", "Rome", "Berlin",
        "Athens", "Milan", "Istanbul", "Kiev", "Lisbon", "Manchester", "Birmingham", "Hamburg",
        "Munich", "Vienna", "Warsaw", "Budapest", "Bucharest", "Prague", "Brussels", "Amsterdam",
        "Stockholm", "Copenhagen", "Oslo", "Helsinki", "Dublin", "Zurich", "Geneva", "Lyon",
        "Marseille", "Naples", "Turin", "Valencia", "Seville", "Frankfurt", "Cologne", "Stuttgart",
        "Tokyo", "Shanghai", "Singapore", "Hong Kong", "Beijing", "Delhi",
    ];

    global.citiesdataSet = new Set(sampleCities);
    global.cityset = global.citiesdataSet; // Alias: CityDetector looks for "cityset"
    console.log("ChatWall: Loaded OSS Sample City Dataset (" + sampleCities.length + " entries).");

})(self);
