// Watchlist rows are user data in Supabase; the handlers live in supabaseUserData.js.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { watchlist } = require('./supabaseUserData');

const router = express.Router();
router.use(requireAuth);
router.use(watchlist);

module.exports = router;
