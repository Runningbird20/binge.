import { useState, useEffect, useRef } from 'react';
import Navbar from '../components/Navbar';
import { FALLBACK_CHANNELS, fetchClientLiveTvChannels } from '../utils/liveTvCatalog';

const CATEGORY_ICONS = {
  'News': '📰', 'Movies': '🎬', 'Comedy': '😂', 'Drama': '🎭',
  'Horror': '👻', 'Thriller': '😱', 'Action': '💥', 'Sports': '🏆',
  'Kids': '🎠', 'Anime': '⛩', 'Documentary': '🔭', 'Reality': '⭐',
  'Classic': '📺', 'Music': '🎵', 'Entertainment': '🎉', 'Science': '🔬',
  'Nature': '🌿', 'History': '🏛', 'Crime': '🔍', 'Food': '🍕',
  'Travel': '✈️', 'Lifestyle': '🌟', 'Spanish': '🇪🇸', 'Latino': '🌎',
  'International': '🌍', 'General': '📡',
};

function getCategoryIcon(cat) {
  if (!cat) return '📺';
  for (const [k, v] of Object.entries(CATEGORY_ICONS)) {
    if (cat.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return '📺';
}

export default function LiveTV() {
  // Start with hardcoded channels immediately — no loading spinner on first render
  const [channels, setChannels]           = useState(FALLBACK_CHANNELS);
  const [selected, setSelected]           = useState(FALLBACK_CHANNELS[0]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [search, setSearch]               = useState('');
  const [sidebarOpen, setSidebarOpen]     = useState(true);
  const [isFullscreen, setIsFullscreen]   = useState(false);
  const iframeRef = useRef(null);
  const playerRef = useRef(null);

  // Try to upgrade to the full channel list in the background
  useEffect(() => {
    fetchClientLiveTvChannels().then(list => {
      if (list && list.length > FALLBACK_CHANNELS.length) {
        setChannels(list);
        // Keep the currently selected channel if it's in the new list
        setSelected(cur => list.find(c => c.id === cur?.id) || cur);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const fn = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', fn);
    return () => document.removeEventListener('fullscreenchange', fn);
  }, []);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      (iframeRef.current || playerRef.current)?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  function selectChannel(ch) {
    setSelected(ch);
    if (window.innerWidth < 768) setSidebarOpen(false);
  }

  const categories = ['All', ...Array.from(
    new Set(channels.map(c => c.category).filter(Boolean))
  ).sort()];

  const filtered = channels.filter(c => {
    const matchCat    = activeCategory === 'All' || c.category === activeCategory;
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div className="app-layout">
      <Navbar />
      <div className="livetv-shell">

        {/* ── Category filter, along the top like the Sports/genre bar ── */}
        <div className="genre-bar-wrap">
          <div className="genre-bar" role="tablist" aria-label="Channel categories">
            {categories.map(cat => (
              <button
                key={cat}
                type="button"
                className={`genre-chip${activeCategory === cat ? ' active' : ''}`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat !== 'All' ? getCategoryIcon(cat) + ' ' : ''}{cat}
              </button>
            ))}
          </div>
        </div>

        <div className="livetv-main">

          {/* ── Channels, on the left ── */}
          <aside className={`livetv-sidebar ${sidebarOpen ? '' : 'livetv-sidebar--hidden'}`}>
            <div className="livetv-sidebar-header">
              <h2>Channels</h2>
              <div className="livetv-sidebar-header-actions">
                <span className="livetv-count">{channels.length}</span>
                <button
                  className="livetv-refresh-btn"
                  onClick={() => {
                    fetchClientLiveTvChannels().then(list => {
                      if (list?.length) setChannels(list);
                    }).catch(() => {});
                  }}
                  title="Refresh"
                  type="button"
                >↻</button>
                <button className="livetv-sidebar-toggle" onClick={() => setSidebarOpen(false)} type="button">‹</button>
              </div>
            </div>

            <div className="livetv-search-row">
              <input
                className="search-input"
                placeholder="Search channels..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <div className="livetv-sidebar-divider" />

            <div className="livetv-channel-list">
              {filtered.length === 0 ? (
                <p className="livetv-empty">No channels found.</p>
              ) : (
                filtered.map(ch => (
                  <button
                    key={ch.id}
                    className={`livetv-channel-btn ${selected?.id === ch.id ? 'active' : ''}`}
                    onClick={() => selectChannel(ch)}
                    type="button"
                  >
                    {ch.thumbnail ? (
                      <img src={ch.thumbnail} alt={ch.name} className="livetv-channel-poster"
                        onError={e => { e.target.style.display = 'none'; }} />
                    ) : (
                      <div className="livetv-channel-poster livetv-channel-poster--placeholder">
                        {getCategoryIcon(ch.category)}
                      </div>
                    )}
                    <div className="livetv-channel-info">
                      <span className="livetv-channel-name">{ch.name}</span>
                      {ch.nowPlaying ? (
                        <span className="livetv-channel-tag">▶ {ch.nowPlaying}</span>
                      ) : (
                        <span className="livetv-channel-tag">{ch.category}</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          {/* ── Player, on the right ── */}
          <main className="livetv-player-area" ref={playerRef}>
            {!sidebarOpen && (
              <button className="livetv-sidebar-show-btn" onClick={() => setSidebarOpen(true)} type="button">
                ☰ Channels
              </button>
            )}

            {selected && (
              <>
                <div className="livetv-now-playing">
                  <div className="livetv-now-info">
                    <span className="livetv-live-badge">● LIVE</span>
                    <span className="livetv-now-name">{selected.name}</span>
                    {selected.nowPlaying && <span className="livetv-now-tag">— {selected.nowPlaying}</span>}
                    <span className="livetv-now-cat">
                      {getCategoryIcon(selected.category)} {selected.category}
                    </span>
                  </div>
                  <button className="livetv-fullscreen-btn" onClick={toggleFullscreen} type="button"
                    title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                    {isFullscreen ? '↙' : '↗'}
                  </button>
                </div>

                <div className="livetv-frame-wrap">
                  <iframe
                    key={selected.id}
                    ref={iframeRef}
                    src={selected.embedUrl}
                    className="livetv-frame"
                    allowFullScreen
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                    referrerPolicy="no-referrer-when-downgrade"
                    title={`Watch ${selected.name} live`}
                  />
                </div>
              </>
            )}
          </main>

        </div>
      </div>
    </div>
  );
}
