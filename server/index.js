const path = require('path');
const dotenv = require('dotenv');
const express = require('express');
const cors = require('cors');

const localEnvPath = path.resolve(process.cwd(), '.env.local');
const defaultEnvPath = path.resolve(process.cwd(), '.env');

dotenv.config({ path: localEnvPath });
dotenv.config({ path: defaultEnvPath });

const app = express();
const PORT = Number(process.env.PORT) || Number(process.env.SERVER_PORT) || 5001;

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
