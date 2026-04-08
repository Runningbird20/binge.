require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5001;

const configuredClientUrl = process.env.CLIENT_URL?.trim();
const localhostOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (
      origin === configuredClientUrl ||
      localhostOriginPattern.test(origin)
    ) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS blocked for origin ${origin}`));
  },
}));
app.use(express.json({ limit: '5mb' }));

app.use('/api/auth',      require('./routes/auth'));
app.use('/api/media',     require('./routes/media'));
app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api/ratings',   require('./routes/ratings'));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
