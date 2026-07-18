// Tracklists horodatées par station (titre, artiste), clé = fichier radio.
// Timecodes relevés sur des uploads "full radio station" YouTube dont la
// durée correspond au fichier utilisé (±quelques s) ; ordre et noms
// vérifiés sur grandtheftwiki. Chaque entrée : [début en secondes, titre, artiste].
// Stations parlées (K-Chat, VCPR) absentes = pas d'affichage de titre.
//
// Notes de fiabilité :
// - FLASH : la vidéo de référence était ~196 s plus longue que le fichier,
//   timecodes remis à l'échelle (léger flottement possible).
// - ESPANT : station très bavarde, quelques titres non horodatés sur la
//   source, complétés depuis le wiki et interpolés dans les silences DJ.
// - FEVER : "I'll Be Good" (René & Angela) absent de la source, position estimée.
const STATION_TRACKS = {
  "radio/EMOTION.mp3": [
    [0, "Waiting for a Girl Like You", "Foreigner"],
    [330, "Wow", "Kate Bush"],
    [623, "Tempted", "Squeeze"],
    [847, "Keep On Loving You", "REO Speedwagon"],
    [1041, "(I Just) Died in Your Arms", "Cutting Crew"],
    [1291, "More Than This", "Roxy Music"],
    [1665, "Africa", "Toto"],
    [1922, "Broken Wings", "Mr. Mister"],
    [2220, "Missing You", "John Waite"],
    [2520, "Crockett's Theme", "Jan Hammer"],
    [2777, "Sister Christian", "Night Ranger"],
    [3179, "Never Too Much", "Luther Vandross"]
  ],
  "radio/ESPANT.mp3": [
    [0, "A Gozar Con Mi Combo", "Cachao"],
    [337, "The Bull Is Wrong", "Alpha Banditos"],
    [560, "Yo Te Miré", "Tres Apenas como eso"],
    [872, "Latin Flute", "Deodato"],
    [1110, "Mama Papa Tu", "Mongo Santamaría"],
    [1380, "Me and You Baby (Picao y Tostao)", "Mongo Santamaría"],
    [1668, "Mambo Mucho Mambo", "Machito and his Afro-Cubans"],
    [1847, "La Vida es Una Lenteja", "Unaesta"],
    [2155, "Expansions", "Lonnie Liston Smith"],
    [2375, "Aguanile", "Irakere"],
    [2724, "Super Strut", "Deodato"],
    [3120, "Jamay", "Xavier Cugat and his Orchestra"],
    [3330, "Maracaïbo Oriental", "Beny Moré"],
    [3480, "Mambo Gozón", "Tito Puente and his Orchestra"]
  ],
  "radio/FEVER.mp3": [
    [0, "And the Beat Goes On", "The Whispers"],
    [272, "Act Like You Know", "Fat Larry's Band"],
    [560, "Get Down Saturday Night", "Oliver Cheatham"],
    [963, "Automatic", "The Pointer Sisters"],
    [1240, "I'll Be Good", "René & Angela"],
    [1486, "All Night Long", "Mary Jane Girls"],
    [1822, "Ghetto Life", "Rick James"],
    [2079, "Wanna Be Startin' Somethin'", "Michael Jackson"],
    [2437, "Shame", "Evelyn \"Champagne\" King"],
    [2746, "Behind the Groove", "Teena Marie"],
    [2964, "Juicy Fruit", "Mtume"],
    [3224, "Summer Madness", "Kool & The Gang"],
    [3538, "Last Night a DJ Saved My Life", "Indeep"]
  ],
  "radio/FLASH.mp3": [
    [10, "Out of Touch", "Hall & Oates"],
    [254, "Dance Hall Days", "Wang Chung"],
    [427, "Billie Jean", "Michael Jackson"],
    [664, "Self Control", "Laura Branigan"],
    [939, "Call Me", "Go West"],
    [1126, "Kiss the Dirt (Falling Down the Mountain)", "INXS"],
    [1399, "Run to You", "Bryan Adams"],
    [1597, "Four Little Diamonds", "Electric Light Orchestra"],
    [1828, "Owner of a Lonely Heart", "Yes"],
    [2072, "Video Killed the Radio Star", "The Buggles"],
    [2257, "Japanese Boy", "Aneka"],
    [2564, "Life's What You Make It", "Talk Talk"],
    [2738, "Your Love", "The Outfield"],
    [3020, "Steppin' Out", "Joe Jackson"],
    [3195, "One Thing Leads to Another", "The Fixx"],
    [3428, "Running with the Night", "Lionel Richie"]
  ],
  "radio/VROCK.mp3": [
    [0, "I Wanna Rock", "Twisted Sister"],
    [186, "Too Young to Fall in Love", "Mötley Crüe"],
    [509, "Cum on Feel the Noize", "Quiet Riot"],
    [865, "She Sells Sanctuary", "The Cult"],
    [1212, "Bark at the Moon", "Ozzy Osbourne"],
    [1548, "Dangerous Bastard", "Love Fist"],
    [1789, "2 Minutes to Midnight", "Iron Maiden"],
    [2250, "Working for the Weekend", "Loverboy"],
    [2524, "God Bless Video", "Alcatrazz"],
    [2737, "Cumin' Atcha Live", "Tesla"],
    [2956, "Turn Up the Radio", "Autograph"],
    [3220, "Peace Sells", "Megadeth"],
    [3513, "Madhouse", "Anthrax"],
    [3755, "Raining Blood", "Slayer"],
    [3956, "You've Got Another Thing Comin'", "Judas Priest"],
    [4225, "Fist Fury", "Love Fist"],
    [4418, "Yankee Rose", "David Lee Roth"]
  ],
  "radio/WAVE.mp3": [
    [7, "Two Tribes", "Frankie Goes to Hollywood"],
    [283, "Love Missile F1-11", "Sigue Sigue Sputnik"],
    [492, "Cars", "Gary Numan"],
    [686, "(Keep Feeling) Fascination", "The Human League"],
    [1015, "Atomic", "Blondie"],
    [1249, "99 Luftballons", "Nena"],
    [1445, "Kids in America", "Kim Wilde"],
    [1638, "Pale Shelter", "Tears for Fears"],
    [1942, "Sunglasses at Night", "Corey Hart"],
    [2162, "Poison Arrow", "ABC"],
    [2362, "I Ran (So Far Away)", "A Flock of Seagulls"],
    [2699, "Love My Way", "The Psychedelic Furs"],
    [2892, "Obsession", "Animotion"],
    [3187, "Gold", "Spandau Ballet"],
    [3417, "Hyperactive!", "Thomas Dolby"],
    [3666, "Never Say Never", "Romeo Void"]
  ],
  "radio/WILD.mp3": [
    [35, "Pump Me Up", "Trouble Funk"],
    [275, "One for the Treble", "Davy DMX"],
    [529, "Clear", "Cybotron"],
    [705, "Al-Naafiysh (The Soul)", "Hashim"],
    [975, "Rockit", "Herbie Hancock"],
    [1130, "Looking for the Perfect Beat", "Afrika Bambaataa & the Soulsonic Force"],
    [1538, "Get It Girl", "2 Live Crew"],
    [1768, "Rock Box", "Run-D.M.C."],
    [2035, "Bassline", "Mantronix"],
    [2258, "The Smurf", "Tyrone Brunson"],
    [2497, "Magic's Wand", "Whodini"],
    [2814, "More Bounce to the Ounce", "Zapp"],
    [3105, "The Message", "Grandmaster Flash & the Furious Five"],
    [3480, "The Breaks", "Kurtis Blow"],
    [3760, "Hip Hop, Be Bop (Don't Stop)", "Man Parrish"]
  ]
};
