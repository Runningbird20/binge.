import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SquaresFour } from '@phosphor-icons/react';
import BrowseHero from './BrowseHero';
import TitleRow from './TitleRow';
import { BOOK_GENRE_ROWS, fetchBookGenreRow, fetchTrendingBooks } from '../utils/bookRows';
import { generateSupabaseTypeRecommendations } from '../utils/recommendations';
import { fetchSupabaseWatchlist } from '../utils/supabaseData';

async function loadBooksForYou() {
  const result = await generateSupabaseTypeRecommendations('book');
  return (result.recommendations || []).map((rec) => ({
    id: rec.id,
    title: rec.title,
    media_type: 'book',
    year: rec.year,
    genre: rec.genre,
    cover_url: rec.posterUrl,
    _reason: rec.reason,
  }));
}

async function loadContinueReading() {
  const list = await fetchSupabaseWatchlist({ mediaType: 'book' });
  return (list || [])
    .filter((entry) => entry.status === 'reading' || entry.status === 'plan_to_read')
    .sort((a, b) => (a.status === 'reading' ? -1 : 0) - (b.status === 'reading' ? -1 : 0))
    .map((entry) => ({
      ...entry,
      id: entry.media_id,
      media_type: 'book',
      cover_url: entry.image_url,
      _progressLabel: entry.status === 'reading' ? (entry.current_chapter ? `Ch ${entry.current_chapter}` : entry.current_page ? `Pg ${entry.current_page}` : 'Reading') : null,
    }));
}

// Books landing: trending spotlight + rows, mirroring Movies/Series.
export default function BookBrowseView({ refreshKey = 0 }) {
  const [trending, setTrending] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setTrending(null);
    fetchTrendingBooks()
      .then((items) => { if (!cancelled) setTrending(items); })
      .catch(() => { if (!cancelled) setTrending([]); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const genreLoader = useCallback((genre) => () => fetchBookGenreRow(genre), []);

  return (
    <div className="st-browse">
      <BrowseHero
        // Books with a description first, but any book with a cover can lead
        // the spotlight (it used to require one and often showed nothing).
        items={trending === null ? null : [...trending]
          .filter((book) => book.cover_url || book.poster_url || book.image_url)
          .sort((a, b) => Number(Boolean(b.synopsis && b.synopsis !== 'No description available yet.')) - Number(Boolean(a.synopsis && a.synopsis !== 'No description available yet.')))
          .slice(0, 6)}
        kicker="Trending this week"
        emptyTitle="Find your next great read"
        playLabel="Read"
      />

      <div className="st-browse-toolbar">
        <Link className="st-btn st-btn--ghost" to="/books?view=all">
          <SquaresFour size={18} weight="bold" /> Browse all books
        </Link>
      </div>

      <div className="st-rows">
        <TitleRow key={`continue-${refreshKey}`} title="Continue Reading" load={loadContinueReading} minItems={1} />
        <TitleRow
          key={`trending-${refreshKey}`}
          title="Trending This Week"
          subtitle="What readers are opening right now"
          items={trending ? trending.slice(0, 10) : undefined}
          loading={!trending}
          ranked
        />
        <TitleRow key={`foryou-${refreshKey}`} title="Books for You" load={loadBooksForYou} minItems={3} />
        <TitleRow key={`classics-${refreshKey}`} title="Classics — Free to Read" load={genreLoader('Classic Literature')} minItems={5} />
        {BOOK_GENRE_ROWS.map((row) => (
          <TitleRow key={`${row.id}-${refreshKey}`} title={row.title} load={genreLoader(row.genre)} minItems={5} />
        ))}
      </div>
    </div>
  );
}
