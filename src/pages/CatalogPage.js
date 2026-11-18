import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import BrowseView from '../components/BrowseView';
import MediaDetailsModal from '../components/MediaDetailsModal';
import PullToRefresh from '../components/PullToRefresh';
import CatalogView from '../components/catalog/CatalogView';
import { CATALOGS } from '../components/catalog/catalogs';
import {
  addSupabaseWatchlistItem,
  fetchSupabaseRatingMap,
  fetchSupabaseWatchlistStatusMap,
  updateSupabaseWatchlistStatus,
  saveSupabaseRating,
} from '../utils/supabaseData';

// The Movies and Series pages (Movies.js / TVShows.js): the rows landing
// (BrowseView), the filterable grid (components/catalog/CatalogView) and the
// title popup. What differs between the two is their CATALOGS entry.
export default function CatalogPage({ mediaType }) {
  const catalog = CATALOGS[mediaType];
  const [searchParams] = useSearchParams();
  const openId = Number(searchParams.get('open'));
  const initialGenre = searchParams.get('genre') || '';
  // Rows landing by default (Netflix-style); the filterable grid is one
  // click away via "Browse all" (?view=all) or any ?genre= deep link.
  const showGrid = searchParams.get('view') === 'all' || Boolean(initialGenre);
  const playImmediately = searchParams.get('play') === '1' || searchParams.get('play') === 'true';

  const [selectedItem, setSelectedItem] = useState(null);
  const [detailMessage, setDetailMessage] = useState('');
  const [userRatings, setUserRatings] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [watchlistStatusMap, setWatchlistStatusMap] = useState({});
  const [addingWatchlistIds, setAddingWatchlistIds] = useState(() => new Set());

  function handleRefresh() {
    setRefreshKey((key) => key + 1);
    return new Promise((resolve) => setTimeout(resolve, 500));
  }

  useEffect(() => {
    fetchSupabaseRatingMap(mediaType)
      .then(setUserRatings)
      .catch(() => {});
  }, [mediaType]);

  useEffect(() => {
    let cancelled = false;
    fetchSupabaseWatchlistStatusMap(mediaType)
      .then((map) => { if (!cancelled) setWatchlistStatusMap(map); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mediaType]);

  const handleQuickAdd = useCallback(async (item) => {
    setAddingWatchlistIds((prev) => new Set(prev).add(item.id));
    setDetailMessage('');
    try {
      const saved = await addSupabaseWatchlistItem({ mediaType, mediaId: item.id, media: item });
      setWatchlistStatusMap((prev) => ({ ...prev, [item.id]: { id: saved.id, status: saved.status } }));
      setDetailMessage(`"${item.title}" added to your watchlist.`);
    } catch (error) {
      setDetailMessage(error.message);
    } finally {
      setAddingWatchlistIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }, [mediaType]);

  const handleQuickStatusChange = useCallback((item, entry, nextStatus) => {
    setWatchlistStatusMap((prev) => ({ ...prev, [item.id]: { ...prev[item.id], status: nextStatus } }));
    if (!entry?.id) return;
    updateSupabaseWatchlistStatus(entry.id, nextStatus).catch(() => {
      setWatchlistStatusMap((prev) => ({ ...prev, [item.id]: entry }));
    });
  }, []);

  useEffect(() => {
    if (!openId) return undefined;

    let cancelled = false;

    async function loadOpenItem() {
      try {
        const item = await catalog.fetchById(openId);
        if (!cancelled && item?.id) {
          setSelectedItem(item);
          setDetailMessage('');
        }
      } catch {
        // Nothing to open.
      }
    }

    loadOpenItem();
    return () => {
      cancelled = true;
    };
  }, [catalog, openId]);

  async function openItemDetails(item) {
    setSelectedItem(item);
    setDetailMessage('');

    if (!item?._summary) {
      return;
    }

    try {
      const detailedItem = await catalog.fetchById(item.id);
      if (detailedItem?.id) {
        setSelectedItem((current) => (current?.id === item.id ? detailedItem : current));
      }
    } catch {
      // Keep the summary item if full details are unavailable.
    }
  }

  async function handleRate(item, categories) {
    try {
      await saveSupabaseRating({
        mediaType,
        mediaId: item.id,
        categories,
        media: item,
      });
      setUserRatings((current) => ({
        ...current,
        [item.id]: { ...categories, media_id: item.id },
      }));
      setDetailMessage('Rating saved!');
    } catch (error) {
      setDetailMessage(error.message);
    }
  }

  function closeItemDetails() {
    setSelectedItem(null);
    setDetailMessage('');
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="page-content curated-page">
        <PullToRefresh onRefresh={handleRefresh}>
          {!showGrid ? (
            <BrowseView mediaType={mediaType} refreshKey={refreshKey} />
          ) : (
          <>
          <header className="st-page-head">
            <div>
              <h1 className="st-page-title">{catalog.title}</h1>
            </div>
            <Link className="genre-chip st-pill-link" to={catalog.path}>Back to highlights</Link>
          </header>

          <CatalogView
            mediaType={mediaType}
            onItemClick={openItemDetails}
            initialGenre={initialGenre}
            refreshKey={refreshKey}
            watchlistStatusMap={watchlistStatusMap}
            addingWatchlistIds={addingWatchlistIds}
            onQuickAdd={handleQuickAdd}
            onQuickStatusChange={handleQuickStatusChange}
          />
          </>
          )}
        </PullToRefresh>
      </main>

      {selectedItem && (
        <MediaDetailsModal
          item={selectedItem}
          mediaType={mediaType}
          onClose={closeItemDetails}
          onRate={handleRate}
          onWatchlist={handleQuickAdd}
          watchlistEntry={watchlistStatusMap[selectedItem.id]}
          onStatusChange={handleQuickStatusChange}
          userRating={userRatings[selectedItem.id]}
          isAddingWatchlist={addingWatchlistIds.has(selectedItem.id)}
          detailMessage={detailMessage}
          autoPlay={playImmediately}
          onLibraryChange={() => fetchSupabaseWatchlistStatusMap(mediaType).then(setWatchlistStatusMap).catch(() => {})}
        />
      )}
    </div>
  );
}
