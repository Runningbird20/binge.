// Simple in-memory rate limiter — no external dependencies needed.
// Works on persistent servers (local dev, Railway, Render, etc.).
//
// On Vercel serverless each invocation may run in a fresh container, so the
// Map resets between requests and rate limiting has no effect there. Vercel
// provides its own edge-level DDoS protection in that case.
// The middleware detects the serverless environment and passes through cleanly
// so it never causes errors or false 429s on Vercel.

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const store = new Map();

if (!IS_SERVERLESS) {
  setInterval(() => {
    const cutoff = Date.now();
    for (const [key, entry] of store) {
      if (cutoff - entry.start > entry.windowMs) store.delete(key);
    }
  }, 5 * 60 * 1000).unref();
}

function rateLimit({ windowMs = 60_000, max = 30, message = 'Too many requests — try again later.' } = {}) {
  if (IS_SERVERLESS) {
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    const key = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = store.get(key) || { count: 0, start: now, windowMs };

    if (now - entry.start > windowMs) {
      entry.count = 1;
      entry.start = now;
    } else {
      entry.count += 1;
    }

    store.set(key, entry);

    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.start + windowMs - now) / 1000));
      return res.status(429).json({ error: message });
    }

    next();
  };
}

module.exports = rateLimit;
