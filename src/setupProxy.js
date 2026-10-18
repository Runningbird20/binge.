// Dev only (CRA loads this automatically): forward /api to the Express
// server on :5001 for *every* request type. The package.json "proxy" field
// skips requests that accept text/html, so iframe page loads like the book
// reader (/api/books/standard/...) got the app's own index.html instead.
// Production is unaffected — Vercel routes /api/* to the serverless API.
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function setupProxy(app) {
  app.use('/api', createProxyMiddleware({ target: 'http://localhost:5001', changeOrigin: true }));
};
