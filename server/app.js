const path = require('path');
const dotenv = require('dotenv');

const localEnvPath = path.resolve(process.cwd(), '.env.local');
const defaultEnvPath = path.resolve(process.cwd(), '.env');

dotenv.config({ path: localEnvPath });
dotenv.config({ path: defaultEnvPath });

module.exports = require('./standalone/app');
