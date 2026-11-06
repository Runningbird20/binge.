import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen } from '@phosphor-icons/react';
import { posterSrc } from '../../utils/imageQuality';
import { findSourceBooks, splitBookTitle } from '../../utils/adaptations';

// "Read the book behind it" — the novel an adaptation is credited to.
export function SourceBooks({ mediaType, tmdbId, title }) {
  const location = useLocation();
  const [source, setSource] = useState(null);

  useEffect(() => {
    setSource(null);
    if (!tmdbId) return undefined;
    let cancelled = false;
    findSourceBooks({ mediaType, tmdbId, title })
      .then((result) => { if (!cancelled) setSource(result); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mediaType, tmdbId, title]);

  if (!source?.author) return null;
  const background = location.state?.backgroundLocation || location;
  const heading = source.exact ? 'Read the book behind it' : `Based on the work of ${source.author}`;

  return (
    <section className="td-section" aria-label={heading}>
      <div className="td-section-head"><h3>{heading}</h3></div>
      {source.books.length > 0 ? (
        <div className="td-adapt-list">
          {source.books.map((book) => {
            const { main, series, number } = splitBookTitle(book.title);
            return (
              <Link key={book.id} to={`/book/${book.id}`} state={{ backgroundLocation: background }} className="td-adapt">
                {book.cover_url ? <img src={posterSrc(book.cover_url)} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="td-adapt-fallback"><BookOpen size={22} /></span>}
                <span className="td-adapt-body">
                  <span className="td-adapt-title">{main}</span>
                  <span className="td-muted">{[book.author, book.year].filter(Boolean).join(' · ')}</span>
                  {series && <span className="td-muted">{series}{number ? ` · Book ${number}` : ''}</span>}
                  <span className="td-adapt-cta"><BookOpen size={14} weight="bold" /> See the book</span>
                </span>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="td-muted">Based on a book by {source.author}. It isn’t in the binge. library yet.</p>
      )}
    </section>
  );
}
