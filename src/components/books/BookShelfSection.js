// The book popup's shelves: more by this author, and similar books.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { sampleCatalogForRecommendations } from '../../utils/catalogQueries';
import { posterSrc } from '../../utils/imageQuality';
import { isSupabaseConfigured, supabase } from '../../utils/supabase';
import { getCoverUrl } from './BookCover';

export async function fetchBooksByAuthor(book) {
  if (!book.author || !isSupabaseConfigured || !supabase) return [];
  const { data } = await supabase
    .from('books')
    .select('id, title, author, year, genre, cover_url')
    .ilike('author', book.author)
    .neq('id', book.id)
    .not('cover_url', 'is', null)
    .limit(12);
  return data || [];
}

export async function fetchSimilarBooks(book) {
  const genre = String(book.genre || '').split(',')[0].trim();
  if (!genre) return [];
  const rows = await sampleCatalogForRecommendations('book', { genre, limit: 16 });
  return rows.filter((row) => row.id !== book.id && row.cover_url).slice(0, 12);
}

// Small cover shelf inside the book modal; each cover opens that book.
export function BookShelfSection({ title, load }) {
  const location = useLocation();
  const [items, setItems] = useState(null);

  useEffect(() => {
    let cancelled = false;
    load().then((rows) => { if (!cancelled) setItems(rows); }).catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
    // load is a new function every render; the row reloads when its title changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  if (!items || items.length === 0) return null;
  const background = location.state?.backgroundLocation || location;

  return (
    <section className="td-section" aria-label={title}>
      <div className="td-section-head"><h3>{title}</h3></div>
      <div className="td-shelf">
        {items.map((entry) => (
          <Link
            key={entry.id}
            to={`/book/${entry.id}`}
            state={{ backgroundLocation: background }}
            replace={Boolean(location.state?.backgroundLocation)}
            className="td-shelf-item"
            title={entry.title}
          >
            <img src={posterSrc(getCoverUrl(entry))} alt="" loading="lazy" referrerPolicy="no-referrer" />
            <span>{entry.title}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
