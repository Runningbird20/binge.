require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000' }));
app.use(express.json());

app.use('/api/auth',      require('./routes/auth'));
app.use('/api/media',     require('./routes/media'));
app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api/ratings',   require('./routes/ratings'));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
