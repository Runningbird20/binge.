// Season and episode pickers. Seasons are marked done/partial from the
// watched set ("season:episode" keys); watched episodes are marked too.

const watchedCountIn = (watched, season) => Array.from(watched).filter((key) => key.startsWith(`${season}:`)).length;
const seasonNumbers = (totalSeasons) => Array.from({ length: totalSeasons }, (_, index) => index + 1);
const episodeNumbers = (episodeCount) => Array.from({ length: episodeCount }, (_, index) => index + 1);

// Phone: a row of season chips and a row of episode chips.
export function MobileEpisodeRows({
  totalSeasons, season, episode, watched, seasonEpisodeCounts, episodeCount,
  episodeLabel, chipsRef, onPickSeason, onPickEpisode,
}) {
  return (
    <>
      <div className="mp-row">
        <span className="mp-row-label">Season</span>
        <div className="mp-chips">
          {seasonNumbers(totalSeasons).map((s) => {
            const wc = watchedCountIn(watched, s);
            const tc = seasonEpisodeCounts[s];
            return (
              <button
                key={s}
                className={`mp-chip ${season === s ? 'active' : ''} ${tc && wc === tc ? 'mp-chip-done' : wc > 0 ? 'mp-chip-partial' : ''}`}
                onClick={() => onPickSeason(s)}
                type="button"
              >{s}</button>
            );
          })}
        </div>
      </div>

      <div className="mp-row">
        <span className="mp-row-label">{episodeLabel}</span>
        <div className="mp-chips" ref={chipsRef}>
          {episodeCount === undefined ? (
            <span className="mp-loading">Loading episodes…</span>
          ) : (
            episodeNumbers(episodeCount).map((ep) => {
              const isWatched = watched.has(`${season}:${ep}`);
              const isCurrent = episode === ep;
              return (
                <button
                  key={ep}
                  className={`mp-chip ${isCurrent ? 'active' : ''} ${isWatched && !isCurrent ? 'mp-chip-watched' : ''}`}
                  onClick={() => onPickEpisode(ep)}
                  type="button"
                >{ep}</button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

// Desktop: an "S1 · E1" button opening a season/episode popover.
export function EpisodeSelector({
  selectorRef, open, onToggle, totalSeasons, season, episode, watched, seasonEpisodeCounts,
  episodeCount, watchedInSeason, onPickSeason, onPickEpisode,
}) {
  return (
    <div className="player-ep-selector" ref={selectorRef}>
      <button
        type="button"
        className="player-ep-trigger"
        onClick={onToggle}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span>S{season} · E{episode}</span>
        <span className={`player-ep-trigger-caret${open ? ' open' : ''}`}>⌄</span>
      </button>

      {open && (
        <div className="player-ep-popover" role="dialog" aria-label="Season and episode selector">
          <div className="player-ep-section">
            <span className="player-ep-section-label">Season</span>
            <div className="player-ep-season-row">
              {seasonNumbers(totalSeasons).map((value) => {
                const watchedCount = watchedCountIn(watched, value);
                const totalEpisodes = seasonEpisodeCounts[value];
                const isDone = totalEpisodes && watchedCount === totalEpisodes;

                return (
                  <button
                    key={value}
                    type="button"
                    className={`player-ep-season-chip${season === value ? ' active' : ''}${isDone ? ' done' : watchedCount > 0 ? ' partial' : ''}`}
                    onClick={() => onPickSeason(value)}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="player-ep-section">
            <span className="player-ep-section-label">
              Episode{episodeCount !== undefined ? ` · ${episodeCount} total${watchedInSeason > 0 ? `, ${watchedInSeason} watched` : ''}` : ''}
            </span>
            <div className="player-ep-grid">
              {episodeCount === undefined ? (
                <span className="player-ep-loading">Loading episodes…</span>
              ) : (
                episodeNumbers(episodeCount).map((value) => {
                  const isWatchedEp = watched.has(`${season}:${value}`);
                  const isCurrent = episode === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      className={`player-ep-chip${isCurrent ? ' active' : ''}${isWatchedEp && !isCurrent ? ' watched' : ''}`}
                      onClick={() => onPickEpisode(value)}
                    >
                      {isWatchedEp ? '✓ ' : ''}{value}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
