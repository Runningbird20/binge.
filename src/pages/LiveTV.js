import { useState, useEffect, useRef, useCallback } from 'react';
import Navbar from '../components/Navbar';
import { api } from '../api';

const CATEGORY_ICONS = {
  'News': '📰', 'Movies': '🎬', 'Comedy': '😂', 'Drama': '🎭',
  'Horror': '👻', 'Thriller': '😱', 'Action': '💥', 'Sports': '🏆',
  'Kids': '🎠', 'Anime': '⛩', 'Documentary': '🔭', 'Reality': '⭐',
  'Classic': '📺', 'Music': '🎵', 'Entertainment': '🎉', 'Science': '🔬',
  'Nature': '🌿', 'History': '🏛', 'Crime': '🔍', 'Food': '🍕',
  'Travel': '✈️', 'Lifestyle': '🌟', 'Spanish': '🇪🇸', 'Latino': '🌎',
  'International': '🌍',
};

function getCategoryIcon(category) {
  if (!category) return '📺';
  for (const [key, icon] of Object.entries(CATEGORY_ICONS)) {
    if (category.toLowerCase().includes(key.toLowerCase())) return icon;
  }
  return '📺';
}

export default function LiveTV() {
  const [channels, setChannels]               = useState([]);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState('');
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [activeCategory, setActiveCategory]   = useState('All');
  const [search, setSearch]                   = useState('');
  const [sidebarOpen, setSidebarOpen]         = useState(true);
  const [isFullscreen, setIsFullscreen]       = useState(false);
  const iframeRef = useRef(null);
  const playerRef = useRef(null);

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get('/livetv/channels');
      const list = data.channels || [];
      setChannels(list);
      setSelectedChannel((current) => (list.length > 0 && !current ? list[0] : current));
    } catch (err) {
      setError(err.message || 'Failed to load channels');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  useEffect(() => {
    function onFsChange() { setIsFullscreen(!!document.fullscreenElement); }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      (iframeRef.current || playerRef.current)?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  const categories = ['All', ...Array.from(new Set(channels.map(c => c.category).filter(Boolean))).sort()];

  const filtered = channels.filter(c => {
    const matchCat    = activeCategory === 'All' || c.category === activeCategory;
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div className="app-layout">
      <Navbar />
      <div className="livetv-shell">

        {/* ── Sidebar ── */}
        <aside className={`livetv-sidebar ${sidebarOpen ? '' : 'livetv-sidebar--hidden'}`}>
          <div className="livetv-sidebar-header">
            <div className="livetv-sidebar-title">
              <span>📡</span>
              <h2>Live TV</h2>
              {!loading && <span className="livetv-count">{channels.length}</span>}
            </div>
            <button className="livetv-sidebar-toggle" onClick={() => setSidebarOpen(o => !o)}>‹</button>
          </div>

          <div className="livetv-search-wrap">
            <input
              className="livetv-search"
              placeholder="Search channels..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="livetv-categories">
            {categories.map(cat => (
              <button
                key={cat}
                className={`livetv-cat-btn ${activeCategory === cat ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat !== 'All' ? getCategoryIcon(cat) + ' ' : ''}{cat}
                {cat !== 'All' && (
                  <span className="livetv-cat-count">{channels.filter(c => c.category === cat).length}</span>
                )}
              </button>
            ))}
          </div>

          <div className="livetv-channel-list">
            {loading ? (
              <div className="livetv-loading">
                <div className="livetv-loading-dots"><span /><span /><span /></div>
                <p>Loading channels...</p>
              </div>
            ) : error ? (
              <div className="livetv-sidebar-error">
                <p>⚠️ {error}</p>
                <button className="livetv-retry-btn" onClick={fetchChannels}>Retry</button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="livetv-empty">No channels found.</p>
            ) : (
              filtered.map(channel => (
                <button
                  key={channel.id}
                  className={`livetv-channel-btn ${selectedChannel?.id === channel.id ? 'active' : ''}`}
                  onClick={() => setSelectedChannel(channel)}
                >
                  {channel.thumbnail ? (
                    <img src={channel.thumbnail} alt={channel.name} className="livetv-channel-thumb"
                      onError={e => { e.target.style.display = 'none'; }} />
                  ) : (
                    <span className="livetv-channel-logo">{getCategoryIcon(channel.category)}</span>
                  )}
                  <div className="livetv-channel-info">
                    <span className="livetv-channel-name">{channel.name}</span>
                    <span className="livetv-channel-cat">
                      {channel.nowPlaying ? `▶ ${channel.nowPlaying}` : channel.category}
                    </span>
                  </div>
                  {selectedChannel?.id === channel.id && <span className="livetv-live-dot" />}
                </button>
              ))
            )}
          </div>
        </aside>

        {/* ── Player ── */}
        <main className="livetv-player-area" ref={playerRef}>
          {!sidebarOpen && (
            <button className="livetv-sidebar-show-btn" onClick={() => setSidebarOpen(true)}>
              ☰ Channels
            </button>
          )}

          {selectedChannel ? (
            <>
              <div className="livetv-now-playing">
                <div className="livetv-now-info">
                  <span className="livetv-live-badge">● LIVE</span>
                  {selectedChannel.thumbnail && (
                    <img src={selectedChannel.thumbnail} alt="" className="livetv-now-thumb"
                      onError={e => { e.target.style.display = 'none'; }} />
                  )}
                  <div>
                    <span className="livetv-now-name">{selectedChannel.name}</span>
                    {selectedChannel.nowPlaying && (
                      <span className="livetv-now-show-bar"> — {selectedChannel.nowPlaying}</span>
                    )}
                  </div>
                  <span className="livetv-now-cat-badge">
                    {getCategoryIcon(selectedChannel.category)} {selectedChannel.category}
                  </span>
                </div>
                <button className="livetv-player-btn" onClick={toggleFullscreen}
                  title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                  {isFullscreen ? '↙' : '↗'}
                </button>
              </div>

              <div className="livetv-frame-wrap">
                <iframe
                  key={selectedChannel.id}
                  ref={iframeRef}
                  src={selectedChannel.embedUrl}
                  className="livetv-frame"
                  allowFullScreen
                  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                  referrerPolicy="no-referrer"
                  title={`Watch ${selectedChannel.name} live`}
                />
              </div>

              <div className="livetv-footer">
                <p className="livetv-note">
                  {channels.length} channels · Powered by Pluto TV &amp; free streaming services
                </p>
                <button className="livetv-refresh-btn" onClick={fetchChannels}>↻ Refresh</button>
              </div>
            </>
          ) : !loading && (
            <div className="livetv-no-selection">
              <div style={{ fontSize: '4rem' }}>📡</div>
              <p>Select a channel to start watching</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
