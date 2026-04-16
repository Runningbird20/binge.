const app = require('../server/app');

function normalizeApiRequestPath(req) {
  const slug = req?.query?.slug;
  if (!slug) {
    return;
  }

  const segments = (Array.isArray(slug) ? slug : [slug])
    .flatMap((value) => String(value || '').split('/'))
    .map((value) => value.trim())
    .filter(Boolean);

  const params = new URLSearchParams();
  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (key === 'slug' || value == null) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, String(entry)));
      return;
    }

    params.append(key, String(value));
  });

  const pathname = `/api/${segments.join('/')}`;
  const query = params.toString();
  req.url = query ? `${pathname}?${query}` : pathname;
  delete req.query.slug;
}

module.exports = (req, res) => {
  normalizeApiRequestPath(req);
  return app(req, res);
};
