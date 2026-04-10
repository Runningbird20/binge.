require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = Number(process.env.PORT) || Number(process.env.SERVER_PORT) || 5001;

const configuredClientUrl = process.env.CLIENT_URL?.trim();
const localhostOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

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

app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/lists', require('./routes/lists'));
app.use('/api/media', require('./routes/media'));
app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api/ratings', require('./routes/ratings'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/requests', require('./routes/requests'));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
