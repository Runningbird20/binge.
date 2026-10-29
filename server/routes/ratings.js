// Ratings rows are user data in Supabase; the handlers live in supabaseUserData.js.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { ratings } = require('./supabaseUserData');

const router = express.Router();
router.use(requireAuth);
router.use(ratings);

module.exports = router;
