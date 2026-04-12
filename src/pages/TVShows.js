import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import MediaCard from '../components/MediaCard';
import MediaDetailsModal from '../components/MediaDetailsModal';
import MediaRow from '../components/MediaRow';
import { api } from '../api';
<<<<<<< HEAD
import {
  addSupabaseWatchlistItem,
  fetchSupabaseRatingMap,
  saveSupabaseRating,
} from '../utils/supabaseData';
import {
  buildMediaGenreFacets,
  filterMediaItems,
  loadFallbackTvShows,
} from '../catalogFallback';
=======
>>>>>>> 97120556004ade45ab99628f3a5b200c1931e915

const PAGE_SIZE = 48;

function BrowseView({ onItemClick, onWatchlist, userRatings, initialGenre, initialSearch, initialSort }) {
  const [shows, setShows]             = useState([]);
  const [search, setSearch]           = useState(initialSearch || '');
  const [debouncedSearch, setDebSearch] = useState(initialSearch || '');
  const [genre, setGenre]             = useState(initialGenre || '');
  const [sortOrder, setSortOrder]     = useState(initialSort || 'title-asc');
  const [facets, setFacets]           = useState({ genres: [] });
  const [loading, setLoading]         = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage]               = useState(1);
  const [total, setTotal]             = useState(0);
  const [totalPages, setTotalPages]   = useState(1);
  const loadMoreRef = useRef(null);

  useEffect(() => { const t = setTimeout(() => setDebSearch(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); setShows([]); }, [debouncedSearch, genre, sortOrder]);

  const fetchShows = useCallback(async (pageNum) => {
    if (pageNum === 1) setLoading(true); else setLoadingMore(true);
    try {
      const params = new URLSearchParams({ page: pageNum, page_size: PAGE_SIZE, sort: sortOrder });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (genre) params.set('genre', genre);
      const data = await api.get(`/media/tv-shows?${params}`);
      const items = Array.isArray(data?.items) ? data.items : [];
      setShows(prev => pageNum === 1 ? items : [...prev, ...items]);
      setTotal(data?.total || 0); setTotalPages(data?.totalPages || 1);
      if (data?.facets?.genres?.length) setFacets({ genres: data.facets.genres });
    } catch { if (pageNum === 1) setShows([]); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [debouncedSearch, genre, sortOrder]);

  useEffect(() => { fetchShows(page); }, [page, fetchShows]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || loadingMore || page >= totalPages) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setPage(p => p + 1); }, { rootMargin: '300px' });
    obs.observe(node); return () => obs.disconnect();
  }, [loadingMore, page, totalPages]);

  return (
    <div className="browse-view">
      <div className="browse-view-filters">
        <input className="search-input" type="text" placeholder="Search TV shows..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-input" value={genre} onChange={e => setGenre(e.target.value)}>
          <option value="">All Genres</option>
          {facets.genres.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select className="filter-input" value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
          <option value="title-asc">Title A–Z</option>
          <option value="title-desc">Title Z–A</option>
          <option value="year-desc">Newest First</option>
          <option value="year-asc">Oldest First</option>
        </select>
        {(search || genre || sortOrder !== 'title-asc') && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => { setSearch(''); setGenre(''); setSortOrder('title-asc'); }}>Clear</button>
        )}
        <span className="browse-view-count">{loading ? '...' : `${total.toLocaleString()} shows`}</span>
      </div>
      {loading ? <div className="loading-state">Loading...</div>
      : shows.length === 0 ? <div className="empty-state"><p>No shows found.</p></div>
      : (
        <>
          <div className="media-grid">
            {shows.map(s => <MediaCard key={s.id} item={s} mediaType="tv_show" userRating={userRatings[s.id]} onWatchlist={onWatchlist} onOpenDetails={onItemClick} />)}
          </div>
          <div className="infinite-scroll-footer">
            {loadingMore && <span>Loading more…</span>}
            {!loadingMore && page >= totalPages && <span>All {total.toLocaleString()} shows loaded</span>}
            {page < totalPages && !loadingMore && <div ref={loadMoreRef} style={{ height: 1 }} />}
          </div>
        </>
      )}
    </div>
  );
}

function CuratedView({ onItemClick, onSeeAll, userRatings }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/media/tv-shows/curated')
      .then(d => setRows(d.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="curated-loading"><div className="curated-loading-shimmer" /></div>;

  return (
    <div className="curated-view">
      {rows.map((row, i) => (
        <div key={row.id} style={{ animationDelay: `${i * 0.06}s` }} className="curated-row-appear">
          <MediaRow row={row} mediaType="tv_show" onItemClick={onItemClick} onSeeAll={onSeeAll} userRatings={userRatings} />
        </div>
      ))}
    </div>
  );
}

export default function TVShows() {
  const [searchParams] = useSearchParams();
  const openId = Number(searchParams.get('open'));

  const [view, setView]                   = useState('curated');
  const [browseGenre, setBrowseGenre]     = useState('');
  const [browseSearch, setBrowseSearch]   = useState('');
  const [browseSort, setBrowseSort]       = useState('title-asc');
  const [selectedItem, setSelectedItem]   = useState(null);
  const [detailMessage, setDetailMessage] = useState('');
  const [isAddingWatchlist, setIsAddingWatchlist] = useState(false);
  const [userRatings, setUserRatings]     = useState({});

  useEffect(() => {
<<<<<<< HEAD
    fetchSupabaseRatingMap('tv_show')
      .then(setUserRatings)
=======
    api.get('/ratings/my?media_type=tv_show')
      .then(r => { const n = {}; r.forEach(x => { n[x.media_id] = x; }); setUserRatings(n); })
>>>>>>> 97120556004ade45ab99628f3a5b200c1931e915
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!openId) return;
    api.get(`/media/tv-shows/${openId}`).then(d => { if (d?.id) { setSelectedItem(d); setDetailMessage(''); } }).catch(() => {});
  }, [openId]);

  function handleSeeAll(row) {
    const url = row.seeAll || '';
    const params = new URLSearchParams(url.split('?')[1] || '');
    setBrowseGenre(params.get('genre') || '');
    setBrowseSearch(params.get('search') || '');
    setBrowseSort(params.get('sort') || 'title-asc');
    setView('browse');
  }

  function switchToDiscover() {
    setBrowseGenre(''); setBrowseSearch(''); setBrowseSort('title-asc');
    setView('curated');
  }

  async function handleRate(item, categories, review) {
    try {
<<<<<<< HEAD
      await saveSupabaseRating({ mediaType: 'tv_show', mediaId: item.id, categories, review });
      setUserRatings((cur) => ({ ...cur, [item.id]: { ...categories, media_id: item.id, review } }));
=======
      await api.post('/ratings', { media_type: 'tv_show', media_id: item.id, categories, review });
      setUserRatings(c => ({ ...c, [item.id]: { ...categories, media_id: item.id, review } }));
>>>>>>> 97120556004ade45ab99628f3a5b200c1931e915
      setDetailMessage('Rating saved!');
    } catch (e) { setDetailMessage(e.message); }
  }

  async function handleWatchlist(item) {
<<<<<<< HEAD
    setIsAddingWatchlist(true);
    setDetailMessage('');
    try {
      await addSupabaseWatchlistItem({ mediaType: 'tv_show', mediaId: item.id });
      setDetailMessage(`"${item.title}" added to your watchlist.`);
    } catch (error) {
      setDetailMessage(error.message);
    } finally {
      setIsAddingWatchlist(false);
    }
=======
    setIsAddingWatchlist(true); setDetailMessage('');
    try { await api.post('/watchlist', { media_type: 'tv_show', media_id: item.id }); setDetailMessage(`"${item.title}" added.`); }
    catch (e) { setDetailMessage(e.message); }
    finally { setIsAddingWatchlist(false); }
>>>>>>> 97120556004ade45ab99628f3a5b200c1931e915
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content curated-page">
        <div className="curated-page-header">
          <h1 className="curated-page-title">TV Shows</h1>
          <div className="curated-view-toggle">
            <button className={`curated-toggle-btn ${view === 'curated' ? 'active' : ''}`} onClick={switchToDiscover} type="button">✦ Discover</button>
            <button className={`curated-toggle-btn ${view === 'browse' ? 'active' : ''}`} onClick={() => setView('browse')} type="button">☰ Browse All</button>
          </div>
        </div>
        {view === 'curated'
          ? <CuratedView onItemClick={item => { setSelectedItem(item); setDetailMessage(''); }} onSeeAll={handleSeeAll} userRatings={userRatings} />
          : <BrowseView onItemClick={item => { setSelectedItem(item); setDetailMessage(''); }} onWatchlist={handleWatchlist} userRatings={userRatings} initialGenre={browseGenre} initialSearch={browseSearch} initialSort={browseSort} />
        }
      </main>
      {selectedItem && (
        <MediaDetailsModal item={selectedItem} mediaType="tv_show" onClose={() => { setSelectedItem(null); setDetailMessage(''); setIsAddingWatchlist(false); }} onRate={handleRate} onWatchlist={handleWatchlist} userRating={userRatings[selectedItem.id]} isAddingWatchlist={isAddingWatchlist} detailMessage={detailMessage} />
      )}
    </div>
  );
}
