const path = require('path');
const dotenv = require('dotenv');
const express = require('express');
const cors = require('cors');

const localEnvPath = path.resolve(process.cwd(), '.env.local');
const defaultEnvPath = path.resolve(process.cwd(), '.env');

dotenv.config({ path: localEnvPath });
dotenv.config({ path: defaultEnvPath });

const helmet = require('helmet');
const rateLimit = require('./middleware/rateLimit');

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // Whitelist every domain we embed so no rogue iframe can be injected
      'frame-src': [
        "'self'",
        // Video providers
        'https://vsembed.ru',
        'https://vsembed.su',
        'https://www.2embed.stream',
        'https://2embed.stream',
        'https://autoembed.co',
        'https://vidlink.pro',
        'https://multiembed.mov',
        // Manga / comics
        'https://mangakatana.com',
        'https://*.mangakatana.com',
        'https://weebcentral.com',
        'https://*.weebcentral.com',
        'https://asurascan.com',
        'https://*.asurascan.com',
        'https://webtoon.com',
        'https://*.webtoon.com',
        'https://bato.to',
        'https://*.bato.to',
        // Books
        'https://archive.org',
        // Sports streams and any other HTTPS embeds (CDN domains vary per provider)
        'https:',
      ],
      'connect-src': ["'self'", 'https://api.themoviedb.org'],
      // Scripts: self + inline needed for React, plus allow data: URIs
      'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      // Upgrade insecure requests where possible
      'upgrade-insecure-requests': [],
    },
  },
}));
const configuredClientUrl = process.env.CLIENT_URL?.trim();
const localhostOriginPattern = /^https?:\/\/localhost(:\d+)?$|^https?:\/\/127\.0\.0\.1(:\d+)?$|^https?:\/\[::1\](:\d+)?$/i;

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (
        (configuredClientUrl && origin === configuredClientUrl) ||
        localhostOriginPattern.test(origin)
      ) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked for origin ${origin}`));
    },
  })
);

app.use(express.json({ limit: '1mb' }));

// Global rate limit: 200 requests / minute per IP (generous for normal use)
app.use(rateLimit({ windowMs: 60_000, max: 200, message: 'Too many requests — slow down.' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Auth endpoints get a strict limit: 10 attempts / 15 min per IP
const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, message: 'Too many login attempts — try again later.' });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);

// Chat and forum: 30 posts / minute per IP
const writeLimiter = rateLimit({ windowMs: 60_000, max: 30 });
app.use('/api/chat', writeLimiter);
app.use('/api/forum', writeLimiter);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/lists', require('./routes/lists'));
app.use('/api/media', require('./routes/media'));
app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api/ratings', require('./routes/ratings'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/livetv',      require('./routes/livetv'));
app.use('/api/sports',      require('./routes/sports'));
app.use('/api/proxy',      require('./routes/proxy'));
app.use('/api/embed-proxy', require('./routes/embedProxy'));
app.use('/api/forum', require('./routes/forum'));
app.use('/api/dev-lab', require('./routes/devLab'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/manga',       require('./routes/manga'));
app.use('/api/weebcentral', require('./routes/weebcentral'));
app.use('/api/bato',        require('./routes/bato'));
app.use('/api/books',       require('./routes/books'));
app.use('/api/search', require('./routes/search'));
app.use('/api/watchroom', require('./routes/watchroom'));
app.use('/api/profile', require('./routes/profile'));

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

app.use((error, _req, res, _next) => {
  if (res.headersSent) {
    return;
  }

  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body.' });
    return;
  }

  const status = Number(error?.status || error?.statusCode) || 500;
  const message = status >= 500
    ? (error?.message || 'Server error.')
    : (error?.message || 'Request failed.');

  console.error('API error:', error);
  res.status(status).json({ error: message });
});

module.exports = app;
