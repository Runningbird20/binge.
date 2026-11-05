import { useState, useEffect } from 'react';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { findWhereToRead } from '../../utils/anilist';

// MangaDex's "official English" link, named after the site it points to.
function officialSiteName(url) {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const known = { 'mangaplus.shueisha.co.jp': 'MANGA Plus', 'webtoons.com': 'WEBTOON', 'viz.com': 'VIZ', 'kodansha.us': 'Kodansha', 'yenpress.com': 'Yen Press', 'tapas.io': 'Tapas', 'tappytoon.com': 'Tappytoon', 'comikey.com': 'Comikey', 'azuki.co': 'Azuki', 'sevenseasentertainment.com': 'Seven Seas' };
  return known[host] || host || 'Official English edition';
}

// ─── Where to read (official links via AniList) ───────────────
export function WhereToRead({ comic }) {
  const [links, setLinks] = useState(comic.readLinks || null);
  useEffect(() => {
    if (comic.readLinks?.length) { setLinks(comic.readLinks); return undefined; }
    const ctrl = new AbortController();
    let retry = null;
    const lookup = (attempt) => findWhereToRead(comic, ctrl.signal)
      .then((found) => setLinks(found))
      .catch((e) => {
        if (e.name === 'AbortError') return;
        // AniList allows ~30 requests/min; when it's busy, try once more.
        if (e.status === 429 && attempt === 0) retry = setTimeout(() => lookup(1), 8000);
        else setLinks([]);
      });
    lookup(0);
    return () => { ctrl.abort(); clearTimeout(retry); };
  }, [comic]);
  const all = [...(links || [])];
  if (comic.officialUrl && !all.some((link) => link.url === comic.officialUrl)) {
    all.push({ site: officialSiteName(comic.officialUrl), url: comic.officialUrl, free: /mangaplus|webtoons/.test(comic.officialUrl) });
  }
  if (!all.length) return null;
  return (
    <section className="manga-where" aria-label="Where to read officially">
      <p className="manga-detail-section-label">Where to read officially</p>
      <div className="manga-where-links">
        {all.map((link) => (
          <a key={link.url} className={`manga-where-link${link.free ? ' free' : ''}`} href={link.url} target="_blank" rel="noopener noreferrer">
            {link.site}{link.free && <span>Free</span>}<ArrowSquareOut size={14} weight="bold" aria-hidden="true" />
          </a>
        ))}
      </div>
    </section>
  );
}

// Series from an external-reader provider: open the official reader.
export function ExternalRead({ comic, provider }) {
  const links = provider.readLinks(comic);
  const primary = links[0];
  return (
    <div className="manga-chapter-list manga-external">
      <h3 className="manga-chapter-list-title">Chapters</h3>
      {primary ? (
        <>
          <p className="manga-chapter-empty">
            {comic.title} is published by {primary.site}{primary.free ? ', free to read' : ''}. Chapters open in their official reader.
          </p>
          <a className="btn-watch manga-external-btn" href={primary.url} target="_blank" rel="noopener noreferrer">
            Read on {primary.site} <ArrowSquareOut size={16} weight="bold" aria-hidden="true" />
          </a>
        </>
      ) : (
        <p className="manga-chapter-empty">No official reading link is listed for this series yet.</p>
      )}
    </div>
  );
}
