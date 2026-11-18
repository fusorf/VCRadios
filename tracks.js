// Tracklists horodatées par station (titre, artiste), clé = fichier radio.
// Chaque entrée : [début en secondes, titre, artiste], ou :
// - [début, ADS] : coupure pub (publicités fictives de la station) ;
// - [début, TALK] : ni musique ni pub (DJ, jingle, appel d'auditeur,
//   interview, sketch, silence). Placé à la fin de chaque morceau qui n'est
//   pas enchaîné directement sur un autre morceau ou sur une pub : dernière
//   note ou fin du fondu (si le DJ parle par-dessus la fin, c'est la fin de
//   la musique qui compte). Aussi après une coupure pub quand le DJ parle
//   ensuite au moins une dizaine de secondes.
// L'entrée suivante reprend à son propre début. Avant la première entrée
// (jingle/intro DJ) : pas de titre. Stations parlées (K-Chat, VCPR) absentes.
//
// Méthode (recalage nov. 2026, sur les fichiers audio eux-mêmes) :
// - début d'un titre = première note, même si le DJ parle dessus ;
// - fin d'un titre = canal stéréo (L-R) retombé à ≥ 18 dB sous le corps du
//   morceau (les voix DJ/pub sont mono), contrôlé avec basses et aigus par
//   fenêtres de 0,5 s ; morceaux mono (Espantoso) jugés sur basses/aigus ;
// - transcription Whisper (small.en, horodatage au mot) pour les paroles,
//   les interventions DJ et les débuts de pub ;
// - précision visée ≈ 1 s.
//
// Débuts incertains (±2-5 s, intro fondue sous le DJ ou un jingle) :
// - EMOTION : Broken Wings (1922).
// - FEVER : And the Beat Goes On (7), Automatic (963 ; autre lecture ≈ 992).
// - FLASH : Self Control (698), Run to You (1473 ; autre lecture ≈ 1487),
//   Steppin' Out (3162).
// - VROCK : She Sells Sanctuary (865 ; jingle possible jusqu'à ≈ 872),
//   Bark at the Moon (1208 ; idem jusqu'à ≈ 1212), Turn Up the Radio (2957 ;
//   autre lecture ≈ 3007), Raining Blood (3755).
// - WAVE : Poison Arrow (2165), I Ran (2369).
// - ESPANT : A Gozar Con Mi Combo (10), dernière pub (3472).
// - WILD : Pump Me Up, Clear, Al-Naafiysh, Bassline, The Message gardent
//   les anciens timecodes (DJ en continu sur les instrumentaux).
// Fins (TALK) incertaines :
// - FEVER : le DJ parle presque toujours sur un fond musical continu ; fins
//   placées là où ce fond s'arrête ou change (889, 1763, 2378, 3780 : ±3 s).
// - Longs fondus sous le DJ : EMOTION 829, 1488, 2431 ; WAVE 2330 (fond
//   faible jusqu'à ≈ 2361) ; FLASH 1912.
// - VROCK : 1728 (fin live de Dangerous Bastard), 2731, 3935 (jingle au
//   milieu du passage DJ).
// - ESPANT 3278 (Jamay est mono : fin jugée sur basses/aigus).
// - Enchaînés sans TALK (morceau → morceau, ou fondu croisé) : Atomic → 99
//   Luftballons, Sunglasses → Poison Arrow, Obsession → pub, Turn Up the
//   Radio → Peace Sells, Madhouse → Raining Blood, Billie Jean → Self
//   Control, Video Killed → Japanese Boy, Me and You Baby → Mambo Mucho,
//   Mambo Mucho → La Vida, Ghetto Life → Wanna Be ; Wildstyle hors des 5
//   vrais arrêts de musique.
// - FLASH : « Running with the Night » (Lionel Richie) absent du fichier, retiré.
const ADS = 'ads';
const TALK = 'talk';

const STATION_TRACKS = {
  "radio/EMOTION.mp3": [
    [12, "Waiting for a Girl Like You", "Foreigner"],
    [268, ADS],
    [330, "Wow", "Kate Bush"],
    [548, TALK],
    [571, ADS],
    [623, "Tempted", "Squeeze"],
    [829, TALK],
    [847, "Keep On Loving You", "REO Speedwagon"],
    [1024, TALK],
    [1041, "(I Just) Died in Your Arms", "Cutting Crew"],
    [1285, TALK],
    [1291, "More Than This", "Roxy Music"],
    [1488, TALK],
    [1541, ADS],
    [1648, TALK],
    [1665, "Africa", "Toto"],
    [1909, TALK],
    [1922, "Broken Wings", "Mr. Mister"],
    [2208, TALK],
    [2220, "Missing You", "John Waite"],
    [2431, TALK],
    [2444, ADS],
    [2520, "Crockett's Theme", "Jan Hammer"],
    [2711, TALK],
    [2718, ADS],
    [2777, "Sister Christian", "Night Ranger"],
    [3071, TALK],
    [3078, ADS],
    [3179, "Never Too Much", "Luther Vandross"],
    [3397, ADS]
  ],
  "radio/ESPANT.mp3": [
    [10, "A Gozar Con Mi Combo", "Cachao"],
    [335, TALK],
    [338, "The Bull Is Wrong", "Alpha Banditos"],
    [553, TALK],
    [555, "Yo Te Miré", "Tres Apenas como eso"],
    [758, TALK],
    [767, ADS],
    [855, TALK],
    [873, "Latin Flute", "Deodato"],
    [1106, TALK],
    [1108, "Mama Papa Tu", "Mongo Santamaría"],
    [1307, TALK],
    [1323, ADS],
    [1402, "Me and You Baby (Picao y Tostao)", "Mongo Santamaría"],
    [1666, "Mambo Mucho Mambo", "Machito and his Afro-Cubans"],
    [1847, "La Vida es Una Lenteja", "Unaesta"],
    [2082, TALK],
    [2084, ADS],
    [2155, "Expansions", "Lonnie Liston Smith"],
    [2368, TALK],
    [2370, "Aguanile", "Irakere"],
    [2722, TALK],
    [2724, "Super Strut", "Deodato"],
    [3059, ADS],
    [3120, "Jamay", "Xavier Cugat and his Orchestra"],
    [3278, TALK],
    [3289, "Maracaïbo Oriental", "Beny Moré"],
    [3469, TALK],
    [3472, ADS],
    [3535, "Mambo Gozón", "Tito Puente and his Orchestra"]
  ],
  "radio/FEVER.mp3": [
    [7, "And the Beat Goes On", "The Whispers"],
    [269, TALK],
    [272, "Act Like You Know", "Fat Larry's Band"],
    [520, TALK],
    [527, ADS],
    [560, "Get Down Saturday Night", "Oliver Cheatham"],
    [889, TALK],
    [899, ADS],
    [963, "Automatic", "The Pointer Sisters"],
    [1232, TALK],
    [1240, "I'll Be Good", "René & Angela"],
    [1477, TALK],
    [1486, "All Night Long", "Mary Jane Girls"],
    [1763, TALK],
    [1771, ADS],
    [1822, "Ghetto Life", "Rick James"],
    [2079, "Wanna Be Startin' Somethin'", "Michael Jackson"],
    [2378, TALK],
    [2437, "Shame", "Evelyn \"Champagne\" King"],
    [2709, ADS],
    [2746, "Behind the Groove", "Teena Marie"],
    [2950, TALK],
    [2964, "Juicy Fruit", "Mtume"],
    [3213, TALK],
    [3224, "Summer Madness", "Kool & The Gang"],
    [3473, TALK],
    [3481, ADS],
    [3538, "Last Night a DJ Saved My Life", "Indeep"],
    [3780, TALK]
  ],
  "radio/FLASH.mp3": [
    [23, "Out of Touch", "Hall & Oates"],
    [200, ADS],
    [255, "Dance Hall Days", "Wang Chung"],
    [432, TALK],
    [450, "Billie Jean", "Michael Jackson"],
    [698, "Self Control", "Laura Branigan"],
    [917, ADS],
    [979, "Call Me", "Go West"],
    [1184, TALK],
    [1186, "Kiss the Dirt (Falling Down the Mountain)", "INXS"],
    [1366, TALK],
    [1396, ADS],
    [1473, "Run to You", "Bryan Adams"],
    [1663, TALK],
    [1703, "Four Little Diamonds", "Electric Light Orchestra"],
    [1912, TALK],
    [1922, "Owner of a Lonely Heart", "Yes"],
    [2126, ADS],
    [2186, "Video Killed the Radio Star", "The Buggles"],
    [2382, "Japanese Boy", "Aneka"],
    [2578, TALK],
    [2593, ADS],
    [2661, TALK],
    [2704, "Life's What You Make It", "Talk Talk"],
    [2868, TALK],
    [2885, "Your Love", "The Outfield"],
    [3056, TALK],
    [3064, ADS],
    [3162, "Steppin' Out", "Joe Jackson"],
    [3361, TALK],
    [3369, "One Thing Leads to Another", "The Fixx"],
    [3539, TALK],
    [3550, ADS]
  ],
  "radio/VROCK.mp3": [
    [7, "I Wanna Rock", "Twisted Sister"],
    [186, TALK],
    [191, "Too Young to Fall in Love", "Mötley Crüe"],
    [375, TALK],
    [384, ADS],
    [502, TALK],
    [509, "Cum on Feel the Noize", "Quiet Riot"],
    [764, TALK],
    [785, ADS],
    [865, "She Sells Sanctuary", "The Cult"],
    [1099, TALK],
    [1208, "Bark at the Moon", "Ozzy Osbourne"],
    [1465, TALK],
    [1486, ADS],
    [1548, "Dangerous Bastard", "Love Fist"],
    [1728, TALK],
    [1735, ADS],
    [1789, "2 Minutes to Midnight", "Iron Maiden"],
    [2109, TALK],
    [2161, ADS],
    [2215, TALK],
    [2250, "Working for the Weekend", "Loverboy"],
    [2467, TALK],
    [2524, "God Bless Video", "Alcatrazz"],
    [2731, TALK],
    [2738, "Cumin' Atcha Live", "Tesla"],
    [2950, TALK],
    [2957, "Turn Up the Radio", "Autograph"],
    [3223, "Peace Sells", "Megadeth"],
    [3462, TALK],
    [3475, ADS],
    [3496, TALK],
    [3516, "Madhouse", "Anthrax"],
    [3755, "Raining Blood", "Slayer"],
    [3935, TALK],
    [3958, "You've Got Another Thing Comin'", "Judas Priest"],
    [4206, TALK],
    [4221, "Fist Fury", "Love Fist"],
    [4414, TALK],
    [4421, "Yankee Rose", "David Lee Roth"],
    [4641, TALK]
  ],
  "radio/WAVE.mp3": [
    [7, "Two Tribes", "Frankie Goes to Hollywood"],
    [177, TALK],
    [200, ADS],
    [283, "Love Missile F1-11", "Sigue Sigue Sputnik"],
    [489, TALK],
    [497, "Cars", "Gary Numan"],
    [671, TALK],
    [686, "(Keep Feeling) Fascination", "The Human League"],
    [889, TALK],
    [893, ADS],
    [976, TALK],
    [1017, "Atomic", "Blondie"],
    [1249, "99 Luftballons", "Nena"],
    [1436, TALK],
    [1445, "Kids in America", "Kim Wilde"],
    [1630, TALK],
    [1643, "Pale Shelter", "Tears for Fears"],
    [1869, TALK],
    [1879, ADS],
    [1942, "Sunglasses at Night", "Corey Hart"],
    [2165, "Poison Arrow", "ABC"],
    [2330, TALK],
    [2369, "I Ran (So Far Away)", "A Flock of Seagulls"],
    [2592, TALK],
    [2598, ADS],
    [2699, "Love My Way", "The Psychedelic Furs"],
    [2884, TALK],
    [2892, "Obsession", "Animotion"],
    [3116, ADS],
    [3187, "Gold", "Spandau Ballet"],
    [3416, TALK],
    [3424, "Hyperactive!", "Thomas Dolby"],
    [3655, TALK],
    [3666, "Never Say Never", "Romeo Void"],
    [3952, TALK]
  ],
  "radio/WILD.mp3": [
    [35, "Pump Me Up", "Trouble Funk"],
    [275, "One for the Treble", "Davy DMX"],
    [529, "Clear", "Cybotron"],
    [705, "Al-Naafiysh (The Soul)", "Hashim"],
    [974, "Rockit", "Herbie Hancock"],
    [1130, "Looking for the Perfect Beat", "Afrika Bambaataa & the Soulsonic Force"],
    [1538, "Get It Girl", "2 Live Crew"],
    [1771, "Rock Box", "Run-D.M.C."],
    [2035, "Bassline", "Mantronix"],
    [2248, TALK],
    [2254, "The Smurf", "Tyrone Brunson"],
    [2491, TALK],
    [2496, "Magic's Wand", "Whodini"],
    [2788, ADS],
    [2814, "More Bounce to the Ounce", "Zapp"],
    [3105, "The Message", "Grandmaster Flash & the Furious Five"],
    [3475, TALK],
    [3480, "The Breaks", "Kurtis Blow"],
    [3754, TALK],
    [3760, "Hip Hop, Be Bop (Don't Stop)", "Man Parrish"],
    [4099, TALK]
  ]
};
