/**
 * ChatWall - AI Firewall Extension
 *
 * @description Anonymize text before sending to AI. Local processing only.
 * @license Proprietary / Source Available. See License.txt for details.
 * @copyright © 2025 StarObject S.A. - Philippe Collignon. All Rights Reserved.
 */
// Sample of common First Names

const FIRST_NAMES_LIST = [
    "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth",
    "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen",
    "Christopher", "Nancy", "Daniel", "Lisa", "Matthew", "Margaret", "Anthony", "Betty", "Donald", "Sandra",
    "Mark", "Ashley", "Paul", "Dorothy", "Steven", "Kimberly", "Andrew", "Emily", "Kenneth", "Donna",
    "Joshua", "Michelle", "Kevin", "Carol", "Brian", "Amanda", "George", "Melissa", "Edward", "Deborah",
    "Ronald", "Stephanie", "Timothy", "Rebecca", "Jason", "Laura", "Jeffrey", "Helen", "Ryan", "Sharon",
    "Jacob", "Cynthia", "Gary", "Kathleen", "Nicholas", "Amy", "Eric", "Shirley", "Jonathan", "Angela",
    "Stephen", "Anna", "Larry", "Ruth", "Justin", "Brenda", "Scott", "Pamela", "Brandon", "Nicole",
    "Benjamin", "Katherine", "Samuel", "Samantha", "Frank", "Christine", "Gregory", "Catherine", "Raymond", "Virginia",
    "Alexander", "Debra", "Patrick", "Rachel", "Jack", "Janet", "Dennis", "Emma", "Jerry", "Carolyn",
    "Tyler", "Maria", "Aaron", "Heather", "Henry", "Diane", "Jose", "Julie", "Douglas", "Joyce",
    "Peter", "Evelyn", "Adam", "Joan", "Nathan", "Victoria", "Zachary", "Kelly", "Walter", "Christina",
    "Kyle", "Lauren", "Harold", "Frances", "Carl", "Martha", "Jeremy", "Judith", "Gerald", "Cheryl",
    "Keith", "Megan", "Roger", "Andrea", "Arthur", "Olivia", "Terry", "Ann", "Lawrence", "Jean",
    "Sean", "Alice", "Christian", "Jacqueline", "Ethan", "Hannah", "Austin", "Doris", "Joe", "Kathryn",
    "Albert", "Gloria", "Jesse", "Teresa", "Willie", "Sara", "Billy", "Janice", "Bryan", "Marie",
    "Bruce", "Julia", "Noah", "Grace", "Jordan", "Judy", "Dylan", "Theresa", "Ralph", "Madison",
    "Roy", "Beverly", "Alan", "Denise", "Wayne", "Marilyn", "Eugene", "Amber", "Juan", "Danielle",
    "Gabriel", "Rose", "Louis", "Brittany", "Russell", "Diana", "Randy", "Abigail", "Vincent", "Natalie",
    "Philip", "Jane", "Logan", "Lori", "Bobby", "Alexis", "Harry", "Tiffany", "Johnny", "Kayla",
    "Philippe", "Pierre", "Jean", "Marie", "Luc", "Sophie", "Thomas", "Julien", "Nicolas", "Camille",
    "Mohammed", "Ahmed", "Ali", "Fatima", "Youssef", "Amine", "Sarah", "Leila", "Karim", "Nadia",
    "Wei", "Li", "Zhang", "Liu", "Chen", "Yang", "Huang", "Zhao", "Wu", "Zhou"
];

const firstnamesdataSet = new Set(FIRST_NAMES_LIST.map(n => n.toLowerCase()));


if (typeof module !== 'undefined' && module.exports) {
    module.exports = { firstnamesdataSet };
} else {
    var globalScope = (typeof self !== 'undefined') ? self : window;
    globalScope.firstnamesdataSet = firstnamesdataSet;
}
