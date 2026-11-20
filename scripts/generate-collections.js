// Writes public/collections.json, the collections both the website and the Apple TV app read
// (node scripts/generate-collections.js public/collections.json). Edit here, then regenerate.
const out = { version: 1, groups: [], collections: [] };
const group = (id, title) => out.groups.push({ id, title });
const add = (g, id, title, subtitle, sources, extra = {}) => out.collections.push({ id, group: g, title, subtitle, sources, ...extra });
const disc = (media, params) => ({ type: 'discover', media, params });
const coll = (...ids) => ({ type: 'collection', media: 'movie', ids });
const list = (media, path) => ({ type: 'list', media, path });
const titles = (media, ids) => ({ type: 'titles', media, ids });
const director = (id) => ({ type: 'person', media: 'movie', id, job: 'Director', minVotes: 50 });
const released = { 'primary_release_date.lte': '{today+30}' };
const aired = { 'first_air_date.lte': '{today+30}' };
const popular = { sort_by: 'popularity.desc' };

group('malayalam', 'Malayalam');
add('malayalam', 'malayalam-popular', 'Malayalam movies', 'The most watched Malayalam films right now', [disc('movie', { with_original_language: 'ml', ...popular, ...released })]);
add('malayalam', 'malayalam-new', 'New Malayalam releases', 'In theatres and just out, newest first', [disc('movie', { with_original_language: 'ml', sort_by: 'primary_release_date.desc', ...released, 'vote_count.gte': '1' })]);
add('malayalam', 'malayalam-top', 'Malayalam all-time greats', 'The highest rated Malayalam films', [disc('movie', { with_original_language: 'ml', sort_by: 'vote_average.desc', 'vote_count.gte': '40' })]);
add('malayalam', 'malayalam-classics', 'Malayalam classics', 'Before 2000: Kireedam, Manichitrathazhu, Sandhesam and more', [disc('movie', { with_original_language: 'ml', sort_by: 'vote_count.desc', 'primary_release_date.lte': '1999-12-31' })]);
add('malayalam', 'malayalam-thrillers', 'Malayalam thrillers', 'Crime, mystery and suspense', [disc('movie', { with_original_language: 'ml', with_genres: '53|80|9648', sort_by: 'vote_count.desc' })]);
add('malayalam', 'malayalam-comedy', 'Malayalam comedies', 'Feel-good and laugh-out-loud', [disc('movie', { with_original_language: 'ml', with_genres: '35', sort_by: 'vote_count.desc' })]);
add('malayalam', 'malayalam-series', 'Malayalam series', 'Shows made in Malayalam', [disc('tv', { with_original_language: 'ml', ...popular, ...aired })]);
for (const [id, name, pid] of [['mohanlal', 'Mohanlal', 82732], ['mammootty', 'Mammootty', 124111], ['fahadh', 'Fahadh Faasil', 1072750], ['dulquer', 'Dulquer Salmaan', 1115225], ['prithviraj', 'Prithviraj Sukumaran', 117690], ['nivin', 'Nivin Pauly', 1071561], ['tovino', 'Tovino Thomas', 1263974]]) {
  add('malayalam', `star-${id}`, name, `${name}'s films, newest first`, [disc('movie', { with_cast: String(pid), sort_by: 'primary_release_date.desc', ...released })]);
}

group('franchises', 'Franchises');
add('franchises', 'marvel', 'Marvel Studios', 'Marvel Studios films and series from Iron Man on, in release order', [disc('movie', { with_companies: '420', without_genres: '16', 'with_runtime.gte': '80', sort_by: 'primary_release_date.asc', 'primary_release_date.gte': '2008-01-01', ...released }), disc('tv', { with_companies: '420', sort_by: 'first_air_date.asc', 'first_air_date.gte': '2021-01-01', ...aired })], { order: 'release' });
add('franchises', 'dc', 'DC', 'Batman, Superman, Wonder Woman and the rest of DC', [disc('movie', { with_companies: '128064|9993', sort_by: 'primary_release_date.asc', ...released }), disc('tv', { with_companies: '128064|9993', sort_by: 'first_air_date.asc', ...aired })], { order: 'release' });
add('franchises', 'star-wars', 'Star Wars', 'The saga and its stories, in release order', [coll(10), titles('movie', [330459, 348350]), disc('tv', { with_companies: '1', with_genres: '10765', sort_by: 'first_air_date.asc', ...aired })], { order: 'release' });
const franchises = [
  ['wizarding-world', 'Harry Potter & the Wizarding World', 'All the Harry Potter and Fantastic Beasts films', [1241, 435259]],
  ['bond', 'James Bond', '007 from Dr. No to today', [645]],
  ['fast', 'Fast & Furious', 'The whole family, in order', [9485]],
  ['mission-impossible', 'Mission: Impossible', 'Every Ethan Hunt mission', [87359]],
  ['middle-earth', 'Middle-earth', 'The Lord of the Rings and The Hobbit', [119, 121938]],
  ['jurassic', 'Jurassic Park & World', 'Every film with the dinosaurs', [328]],
  ['john-wick', 'John Wick', 'The John Wick films', [404609], true],
  ['x-men', 'X-Men', 'The X-Men films', [748]],
  ['pirates', 'Pirates of the Caribbean', 'Captain Jack Sparrow\'s voyages', [295]],
  ['toy-story', 'Toy Story', 'Woody, Buzz and the gang', [10194]],
  ['shrek', 'Shrek', 'The Shrek films', [2150]],
  ['indiana-jones', 'Indiana Jones', 'Every adventure', [84]],
  ['rocky-creed', 'Rocky & Creed', 'From Rocky to Adonis Creed', [1575, 553717]],
  ['monsterverse', 'Godzilla & Kong', 'The MonsterVerse', [535313]],
  ['apes', 'Planet of the Apes', 'The modern saga', [173710]],
  ['alien', 'Alien', 'The Alien films', [8091], true],
  ['terminator', 'The Terminator', 'Every Terminator film', [528], true],
  ['matrix', 'The Matrix', 'Neo\'s story', [2344]],
  ['hunger-games', 'The Hunger Games', 'The Hunger Games films', [131635]],
  ['twilight', 'Twilight', 'The Twilight Saga', [33514]],
  ['despicable-me', 'Despicable Me & Minions', 'Gru and the Minions', [86066]],
  ['kung-fu-panda', 'Kung Fu Panda', 'Po\'s adventures', [77816]],
  ['avatar', 'Avatar', 'The Avatar films', [87096]],
  ['bourne', 'Jason Bourne', 'The Bourne films', [31562]],
  ['mad-max', 'Mad Max', 'The Mad Max films', [8945], true],
  ['conjuring', 'The Conjuring Universe', 'The Conjuring films', [313086], true],
  ['scream', 'Scream', 'Every Scream', [2602], true],
  ['saw', 'Saw', 'The Saw films', [656], true],
  ['godfather', 'The Godfather', 'The trilogy', [230], true],
  ['back-to-the-future', 'Back to the Future', 'The trilogy', [264]],
  ['oceans', 'Ocean\'s', 'The heists', [304]],
  ['men-in-black', 'Men in Black', 'The MIB films', [86055]],
  ['ghostbusters', 'Ghostbusters', 'Who you gonna call?', [2980]],
  ['die-hard', 'Die Hard', 'Every Die Hard', [1570], true],
  ['ice-age', 'Ice Age', 'The Ice Age films', [8354]],
  ['how-to-train-your-dragon', 'How to Train Your Dragon', 'Hiccup and Toothless', [89137]],
  ['spider-verse', 'Spider-Verse', 'Miles Morales\'s films', [573436]],
  ['dark-knight', 'The Dark Knight Trilogy', 'Christopher Nolan\'s Batman', [263]],
];
for (const [id, title, subtitle, ids, mature] of franchises) add('franchises', id, title, subtitle, [coll(...ids)], { order: 'release', ...(mature ? { mature: true } : {}) });

group('holidays', 'Holidays');
add('holidays', 'christmas', 'Christmas', 'Christmas movies and specials', [disc('movie', { with_keywords: '207317|1991', sort_by: 'vote_count.desc' }), disc('tv', { with_keywords: '207317|1991', sort_by: 'vote_count.desc' })]);
add('holidays', 'halloween', 'Halloween', 'Spooky picks for October', [disc('movie', { with_keywords: '3335|3358', sort_by: 'vote_count.desc' })], { mature: true });
add('holidays', 'thanksgiving', 'Thanksgiving', 'Family, food and too much of both', [disc('movie', { with_keywords: '4543', sort_by: 'vote_count.desc' })]);
add('holidays', 'valentines', 'Valentine\'s Day', 'Love stories for the 14th', [disc('movie', { with_keywords: '160404|9840', with_genres: '10749', sort_by: 'vote_count.desc' })]);
add('holidays', 'new-years', 'New Year\'s Eve', 'Count it down', [disc('movie', { with_keywords: '613', sort_by: 'vote_count.desc' })]);
add('holidays', 'easter', 'Easter', 'For the long weekend', [disc('movie', { with_keywords: '9921', sort_by: 'vote_count.desc' })]);

group('languages', 'Around the world');
const langs = [
  ['bollywood', 'Bollywood', 'Hindi films, most watched now', disc('movie', { with_original_language: 'hi', ...popular, ...released })],
  ['tamil', 'Tamil cinema', 'Kollywood, most watched now', disc('movie', { with_original_language: 'ta', ...popular, ...released })],
  ['telugu', 'Telugu cinema', 'Tollywood, most watched now', disc('movie', { with_original_language: 'te', ...popular, ...released })],
  ['kannada', 'Kannada cinema', 'Sandalwood, most watched now', disc('movie', { with_original_language: 'kn', ...popular, ...released })],
  ['indian-series', 'Indian series', 'Hindi, Tamil, Telugu and Malayalam shows', disc('tv', { with_original_language: 'hi|ta|te|ml', ...popular, ...aired })],
  ['k-dramas', 'K-dramas', 'Korean drama series', disc('tv', { with_original_language: 'ko', with_genres: '18', ...popular, ...aired })],
  ['korean-films', 'Korean films', 'From Parasite to the newest hits', disc('movie', { with_original_language: 'ko', sort_by: 'vote_count.desc', ...released })],
  ['anime-series', 'Anime series', 'Japanese animation', disc('tv', { with_original_language: 'ja', with_genres: '16', ...popular, ...aired })],
  ['anime-films', 'Anime films', 'Japanese animated films', disc('movie', { with_original_language: 'ja', with_genres: '16', sort_by: 'vote_count.desc', ...released })],
  ['spanish-series', 'Spanish-language series', 'From Spain and Latin America', disc('tv', { with_original_language: 'es', ...popular, ...aired })],
  ['turkish-dramas', 'Turkish dramas', 'Dizi: Turkish series', disc('tv', { with_original_language: 'tr', ...popular, ...aired })],
  ['c-dramas', 'C-dramas', 'Chinese drama series', disc('tv', { with_original_language: 'zh', with_genres: '18', ...popular, ...aired })],
  ['french-films', 'French films', 'Le cinéma français', disc('movie', { with_original_language: 'fr', sort_by: 'vote_count.desc', ...released })],
  ['japanese-films', 'Japanese films', 'Live-action Japanese cinema', disc('movie', { with_original_language: 'ja', without_genres: '16', sort_by: 'vote_count.desc', ...released })],
];
for (const [id, title, subtitle, source] of langs) add('languages', id, title, subtitle, [source]);

group('top', 'Top lists');
add('top', 'top-100', 'All-time top 100', 'The highest rated films with over 5,000 ratings (TMDB)', [disc('movie', { sort_by: 'vote_average.desc', 'vote_count.gte': '5000' })], { limit: 100 });
add('top', 'top-series', 'Top rated series', 'The highest rated shows with over 1,000 ratings (TMDB)', [disc('tv', { sort_by: 'vote_average.desc', 'vote_count.gte': '1000' })], { limit: 100 });
add('top', 'trending', 'Trending this week', 'What everyone is watching now', [list('movie', '/trending/movie/week'), list('tv', '/trending/tv/week')]);
add('top', 'blockbusters', 'Biggest box office hits', 'The highest grossing films ever', [disc('movie', { sort_by: 'revenue.desc' })], { limit: 100 });
add('top', 'hidden-gems', 'Hidden gems', 'Loved by the few who found them', [disc('movie', { sort_by: 'popularity.desc', 'vote_average.gte': '7.6', 'vote_count.gte': '300', 'vote_count.lte': '2000', 'with_runtime.gte': '70', without_genres: '99,10770', 'primary_release_date.lte': '{today-365}' })]);

group('moods', 'Moods & themes');
const themes = [
  ['superheroes', 'Superheroes', 'Capes, masks and powers', '9715'],
  ['heists', 'Heists', 'The perfect plan', '10051'],
  ['time-travel', 'Time travel', 'Loops, paradoxes and second chances', '4379|10854'],
  ['true-stories', 'Based on a true story', 'It really happened', '9672'],
  ['coming-of-age', 'Coming of age', 'Growing up', '10683'],
  ['survival', 'Survival', 'Against the odds', '10349'],
  ['spies', 'Spies', 'Secret agents and double crosses', '470'],
  ['martial-arts', 'Martial arts', 'Kicks, fists and fight scenes', '779'],
  ['road-trips', 'Road trips', 'Getting there is the point', '7312'],
  ['dinosaurs', 'Dinosaurs', 'Roaring back to life', '12616'],
  ['disaster', 'Disaster movies', 'Earthquakes, storms and the end of the world', '10617'],
  ['space', 'Space', 'Beyond the stars', '9882'],
  ['courtroom', 'Courtroom dramas', 'Order in the court', '33519'],
  ['sports-stories', 'Sports stories', 'Underdogs and big games', '6075'],
  ['twist-endings', 'Twist endings', 'You won\'t see it coming', '326438'],
  ['robots-ai', 'Robots & AI', 'Machines that think', '310'],
  ['post-apocalyptic', 'After the apocalypse', 'What\'s left of the world', '4458|4565'],
  ['cyberpunk', 'Cyberpunk', 'Neon, hackers and megacorps', '12190|2157'],
  ['cooking', 'Food & cooking', 'Kitchens, chefs and feasts', '1918'],
  ['monsters', 'Monsters & kaiju', 'Big things that stomp', '1299|161791'],
  ['zombies', 'Zombies', 'The dead walk', '12377', true],
  ['serial-killers', 'Serial killers', 'Chilling crime thrillers', '10714', true],
  ['revenge', 'Revenge', 'Payback', '9748', true],
  ['found-footage', 'Found footage', 'The tape was never meant to be seen', '163053', true],
  ['haunted', 'Haunted houses', 'Something lives here', '3358', true],
];
for (const [id, title, subtitle, kw, mature] of themes) add('moods', id, title, subtitle, [disc('movie', { with_keywords: kw, sort_by: 'vote_count.desc' })], mature ? { mature: true } : {});
add('moods', 'true-crime', 'True crime', 'Docuseries and dramas about real cases', [disc('tv', { with_keywords: '33722', sort_by: 'vote_count.desc' })], { mature: true });
add('moods', 'musicals', 'Musicals', 'Everybody sing', [disc('movie', { with_keywords: '4344', sort_by: 'vote_count.desc' })]);
add('moods', 'animated-family', 'Animated family films', 'For everyone on the couch', [disc('movie', { with_genres: '16,10751', sort_by: 'vote_count.desc' })]);
add('moods', 'documentaries', 'Documentaries', 'The best non-fiction films', [disc('movie', { with_genres: '99', sort_by: 'vote_count.desc' })]);
add('moods', 'westerns', 'Westerns', 'Saddle up', [disc('movie', { with_genres: '37', sort_by: 'vote_count.desc' })]);
add('moods', 'war', 'War films', 'On the front lines', [disc('movie', { with_genres: '10752', sort_by: 'vote_count.desc' })], { mature: true });

group('studios', 'Studios');
for (const [id, title, subtitle, co, mature] of [
  ['pixar', 'Pixar', 'Every Pixar film', '3'], ['ghibli', 'Studio Ghibli', 'Miyazaki, Takahata and friends', '10342'],
  ['disney-animation', 'Disney Animation', 'Walt Disney Animation Studios', '6125'], ['dreamworks', 'DreamWorks Animation', 'Shrek, Dragons and more', '521'],
  ['illumination', 'Illumination', 'Minions, Sing and Mario', '6704'], ['a24', 'A24', 'Bold, strange and acclaimed', '41077', true],
  ['blumhouse', 'Blumhouse', 'Modern horror', '3172', true], ['aardman', 'Aardman', 'Wallace & Gromit, Shaun the Sheep', '297'], ['laika', 'LAIKA', 'Stop-motion wonders', '11537'],
]) add('studios', id, title, subtitle, [disc('movie', { with_companies: co, sort_by: 'primary_release_date.desc', ...released })], mature ? { mature: true } : {});

group('directors', 'Directors');
for (const [id, name, pid, mature] of [['nolan', 'Christopher Nolan', 525], ['tarantino', 'Quentin Tarantino', 138, true], ['spielberg', 'Steven Spielberg', 488], ['scorsese', 'Martin Scorsese', 1032, true], ['villeneuve', 'Denis Villeneuve', 137427], ['miyazaki', 'Hayao Miyazaki', 608], ['bong', 'Bong Joon Ho', 21684, true]]) {
  add('directors', `director-${id}`, name, `Every film directed by ${name}`, [director(pid)], { order: 'release', ...(mature ? { mature: true } : {}) });
}

group('stars', 'Stars');
for (const [id, name, pid] of [['srk', 'Shah Rukh Khan', 35742], ['rajinikanth', 'Rajinikanth', 91555], ['vijay', 'Vijay', 91547], ['allu-arjun', 'Allu Arjun', 108215], ['tom-cruise', 'Tom Cruise', 500], ['dicaprio', 'Leonardo DiCaprio', 6193], ['denzel', 'Denzel Washington', 5292], ['keanu', 'Keanu Reeves', 6384]]) {
  add('stars', `star-${id}`, name, `${name}'s films, newest first`, [disc('movie', { with_cast: String(pid), sort_by: 'primary_release_date.desc', ...released })]);
}

group('decades', 'Decades');
for (const [id, title, from, to] of [['70s', 'The 70s', 1970, 1979], ['80s', 'The 80s', 1980, 1989], ['90s', 'The 90s', 1990, 1999], ['2000s', 'The 2000s', 2000, 2009], ['2010s', 'The 2010s', 2010, 2019]]) {
  add('decades', `decade-${id}`, title, `The most loved films of ${from}–${to}`, [disc('movie', { 'primary_release_date.gte': `${from}-01-01`, 'primary_release_date.lte': `${to}-12-31`, sort_by: 'vote_count.desc' })]);
}

require('fs').writeFileSync(process.argv[2], `${JSON.stringify(out, null, 1)}\n`);
console.log(out.groups.length, 'groups,', out.collections.length, 'collections');
