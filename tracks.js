// Tracklists horodatées par station (titre, artiste), clé = fichier radio.
// Chaque entrée : [début en secondes, titre, artiste], ou [début, ADS] pour
// une coupure pub (publicités fictives de la station, pas les simples
// interventions du DJ) : l'app affiche alors « Publicités ». Le titre suivant
// reprend à son propre début. Avant la première entrée (jingle/intro DJ) :
// pas de titre. Stations parlées (K-Chat, VCPR) absentes = pas d'affichage.
//
// Méthode (recalage nov. 2026, sur les fichiers audio eux-mêmes) :
// - « début » = première note du morceau, même si le DJ parle dessus ;
// - repères : canal stéréo (L-R) — les voix DJ/pub sont mono, la plupart des
//   morceaux stéréo —, énergie et basses par fenêtres de 0,1 s, silences et
//   fondus (ffmpeg astats/silencedetect), ruptures spectrales ;
// - transcription Whisper (small, horodatage au mot) pour identifier les
//   morceaux (paroles), les annonces DJ et les pubs ;
// - précision visée ≈ 1 s ; anciens timecodes (uploads YouTube) gardés quand
//   l'audio les confirme à ±1 s.
//
// Entrées incertaines (±2-5 s, intro fondue sous le DJ ou un jingle) :
// - EMOTION : Broken Wings (1922, intro sous le jingle).
// - FEVER : And the Beat Goes On (7), Automatic (963 ; autre lecture ≈ 992,
//   juste après l'annonce du DJ).
// - FLASH : Self Control (698), Run to You (1473 ; autre lecture ≈ 1487),
//   Steppin' Out (3162, jingle par-dessus le début).
// - VROCK : She Sells Sanctuary (865, peut-être jingle jusqu'à ≈ 872),
//   Bark at the Moon (1208, idem jusqu'à ≈ 1212), Turn Up the Radio (2957 ;
//   autre lecture ≈ 3007, après « let's start off with this one »),
//   Raining Blood (3755).
// - WAVE : Poison Arrow (2165, fondu enchaîné), I Ran (2369, intro en fondu).
// - ESPANT : A Gozar Con Mi Combo (10), dernière pub (3472).
// - WILD : DJ en continu sur les instrumentaux ; Pump Me Up, Clear,
//   Al-Naafiysh, Bassline et The Message gardent les anciens timecodes
//   (ni confirmés ni contredits à mieux que ±3 s).
// - FLASH : « Running with the Night » (Lionel Richie) n'est pas dans le
//   fichier (après One Thing Leads to Another viennent DJ, pub puis la fin) :
//   retiré.
const ADS = 'ads';

const STATION_TRACKS = {
  "radio/EMOTION.mp3": [
    [12, "Waiting for a Girl Like You", "Foreigner"],
    [268, ADS],
    [330, "Wow", "Kate Bush"],
    [571, ADS],
    [623, "Tempted", "Squeeze"],
    [847, "Keep On Loving You", "REO Speedwagon"],
    [1041, "(I Just) Died in Your Arms", "Cutting Crew"],
    [1291, "More Than This", "Roxy Music"],
    [1541, ADS],
    [1665, "Africa", "Toto"],
    [1922, "Broken Wings", "Mr. Mister"],
    [2220, "Missing You", "John Waite"],
    [2444, ADS],
    [2520, "Crockett's Theme", "Jan Hammer"],
    [2718, ADS],
    [2777, "Sister Christian", "Night Ranger"],
    [3078, ADS],
    [3179, "Never Too Much", "Luther Vandross"],
    [3397, ADS]
  ],
  "radio/ESPANT.mp3": [
    [10, "A Gozar Con Mi Combo", "Cachao"],
    [338, "The Bull Is Wrong", "Alpha Banditos"],
    [555, "Yo Te Miré", "Tres Apenas como eso"],
    [767, ADS],
    [873, "Latin Flute", "Deodato"],
    [1108, "Mama Papa Tu", "Mongo Santamaría"],
    [1322, ADS],
    [1402, "Me and You Baby (Picao y Tostao)", "Mongo Santamaría"],
    [1666, "Mambo Mucho Mambo", "Machito and his Afro-Cubans"],
    [1847, "La Vida es Una Lenteja", "Unaesta"],
    [2084, ADS],
    [2155, "Expansions", "Lonnie Liston Smith"],
    [2370, "Aguanile", "Irakere"],
    [2724, "Super Strut", "Deodato"],
    [3059, ADS],
    [3120, "Jamay", "Xavier Cugat and his Orchestra"],
    [3289, "Maracaïbo Oriental", "Beny Moré"],
    [3472, ADS],
    [3535, "Mambo Gozón", "Tito Puente and his Orchestra"]
  ],
  "radio/FEVER.mp3": [
    [7, "And the Beat Goes On", "The Whispers"],
    [272, "Act Like You Know", "Fat Larry's Band"],
    [527, ADS],
    [560, "Get Down Saturday Night", "Oliver Cheatham"],
    [899, ADS],
    [963, "Automatic", "The Pointer Sisters"],
    [1240, "I'll Be Good", "René & Angela"],
    [1486, "All Night Long", "Mary Jane Girls"],
    [1771, ADS],
    [1822, "Ghetto Life", "Rick James"],
    [2079, "Wanna Be Startin' Somethin'", "Michael Jackson"],
    [2437, "Shame", "Evelyn \"Champagne\" King"],
    [2709, ADS],
    [2746, "Behind the Groove", "Teena Marie"],
    [2964, "Juicy Fruit", "Mtume"],
    [3224, "Summer Madness", "Kool & The Gang"],
    [3481, ADS],
    [3538, "Last Night a DJ Saved My Life", "Indeep"]
  ],
  "radio/FLASH.mp3": [
    [23, "Out of Touch", "Hall & Oates"],
    [200, ADS],
    [255, "Dance Hall Days", "Wang Chung"],
    [450, "Billie Jean", "Michael Jackson"],
    [698, "Self Control", "Laura Branigan"],
    [917, ADS],
    [979, "Call Me", "Go West"],
    [1186, "Kiss the Dirt (Falling Down the Mountain)", "INXS"],
    [1396, ADS],
    [1473, "Run to You", "Bryan Adams"],
    [1703, "Four Little Diamonds", "Electric Light Orchestra"],
    [1922, "Owner of a Lonely Heart", "Yes"],
    [2126, ADS],
    [2186, "Video Killed the Radio Star", "The Buggles"],
    [2382, "Japanese Boy", "Aneka"],
    [2593, ADS],
    [2704, "Life's What You Make It", "Talk Talk"],
    [2885, "Your Love", "The Outfield"],
    [3064, ADS],
    [3162, "Steppin' Out", "Joe Jackson"],
    [3369, "One Thing Leads to Another", "The Fixx"],
    [3550, ADS]
  ],
  "radio/VROCK.mp3": [
    [7, "I Wanna Rock", "Twisted Sister"],
    [191, "Too Young to Fall in Love", "Mötley Crüe"],
    [384, ADS],
    [509, "Cum on Feel the Noize", "Quiet Riot"],
    [785, ADS],
    [865, "She Sells Sanctuary", "The Cult"],
    [1208, "Bark at the Moon", "Ozzy Osbourne"],
    [1486, ADS],
    [1548, "Dangerous Bastard", "Love Fist"],
    [1736, ADS],
    [1789, "2 Minutes to Midnight", "Iron Maiden"],
    [2161, ADS],
    [2250, "Working for the Weekend", "Loverboy"],
    [2524, "God Bless Video", "Alcatrazz"],
    [2738, "Cumin' Atcha Live", "Tesla"],
    [2957, "Turn Up the Radio", "Autograph"],
    [3223, "Peace Sells", "Megadeth"],
    [3475, ADS],
    [3516, "Madhouse", "Anthrax"],
    [3755, "Raining Blood", "Slayer"],
    [3958, "You've Got Another Thing Comin'", "Judas Priest"],
    [4221, "Fist Fury", "Love Fist"],
    [4421, "Yankee Rose", "David Lee Roth"]
  ],
  "radio/WAVE.mp3": [
    [7, "Two Tribes", "Frankie Goes to Hollywood"],
    [200, ADS],
    [283, "Love Missile F1-11", "Sigue Sigue Sputnik"],
    [497, "Cars", "Gary Numan"],
    [686, "(Keep Feeling) Fascination", "The Human League"],
    [893, ADS],
    [1017, "Atomic", "Blondie"],
    [1249, "99 Luftballons", "Nena"],
    [1445, "Kids in America", "Kim Wilde"],
    [1643, "Pale Shelter", "Tears for Fears"],
    [1879, ADS],
    [1942, "Sunglasses at Night", "Corey Hart"],
    [2165, "Poison Arrow", "ABC"],
    [2369, "I Ran (So Far Away)", "A Flock of Seagulls"],
    [2598, ADS],
    [2699, "Love My Way", "The Psychedelic Furs"],
    [2892, "Obsession", "Animotion"],
    [3115, ADS],
    [3187, "Gold", "Spandau Ballet"],
    [3424, "Hyperactive!", "Thomas Dolby"],
    [3666, "Never Say Never", "Romeo Void"]
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
    [2254, "The Smurf", "Tyrone Brunson"],
    [2496, "Magic's Wand", "Whodini"],
    [2788, ADS],
    [2814, "More Bounce to the Ounce", "Zapp"],
    [3105, "The Message", "Grandmaster Flash & the Furious Five"],
    [3480, "The Breaks", "Kurtis Blow"],
    [3760, "Hip Hop, Be Bop (Don't Stop)", "Man Parrish"]
  ]
};
