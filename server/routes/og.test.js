const test = require('node:test');
const assert = require('node:assert');
const { page } = require('./og');

test('a title card carries the title, description and image', () => {
  const html = page({ title: 'Parasite', year: 2019, description: 'All unemployed, Ki-taek’s family…', image: 'https://image.tmdb.org/t/p/w1280/x.jpg', kind: 'Movie' },
    'https://binge-26.vercel.app/movie/221056', 'https://binge-26.vercel.app');
  assert.match(html, /<meta property="og:title" content="Parasite \(2019\)">/);
  assert.match(html, /og:type" content="video.movie"/);
  assert.match(html, /og:image" content="https:\/\/image.tmdb.org\/t\/p\/w1280\/x.jpg"/);
  assert.match(html, /twitter:card" content="summary_large_image"/);
  assert.match(html, /og:description" content="Movie on binge. All unemployed/);
});

test('text is escaped and long descriptions are trimmed', () => {
  const html = page({ title: 'Tom & "Jerry" <3', year: null, description: 'x'.repeat(400), image: null, kind: 'Series' }, 'https://s/tv-show/1', 'https://s');
  assert.match(html, /Tom &amp; &quot;Jerry&quot; &lt;3/);
  assert.doesNotMatch(html, /<3/);
  const description = /og:description" content="([^"]*)"/.exec(html)[1];
  assert.ok(description.length <= 200 && description.endsWith('…'));
  assert.match(html, /og:image" content="https:\/\/s\/logo512.png"/);
});

test('an unknown title gets the site card', () => {
  assert.match(page(null, 'https://s', 'https://s'), /og:title" content="binge."/);
});
