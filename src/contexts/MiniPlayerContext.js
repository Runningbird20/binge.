import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import MiniPlayerWidget from '../components/MiniPlayerWidget';

const MiniPlayerContext = createContext(null);

export function MiniPlayerProvider({ children }) {
  const [nowPlaying, setNowPlaying] = useState(null);
  const [minimized, setMinimized] = useState(true);

  const showMini = useCallback((payload) => {
    setNowPlaying(payload);
    setMinimized(true);
  }, []);

  const expand = useCallback(() => setMinimized(false), []);
  const minimize = useCallback(() => setMinimized(true), []);
  const closeMini = useCallback(() => {
    setNowPlaying(null);
    setMinimized(true);
  }, []);

  const value = useMemo(() => ({ nowPlaying, minimized, showMini, expand, minimize, closeMini }), [
    nowPlaying, minimized, showMini, expand, minimize, closeMini,
  ]);

  return (
    <MiniPlayerContext.Provider value={value}>
      {children}
      {nowPlaying && (
        <MiniPlayerWidget
          nowPlaying={nowPlaying}
          minimized={minimized}
          onExpand={expand}
          onMinimize={minimize}
          onClose={closeMini}
        />
      )}
    </MiniPlayerContext.Provider>
  );
}

export function useMiniPlayer() {
  const ctx = useContext(MiniPlayerContext);
  return ctx ?? {
    nowPlaying: null,
    minimized: true,
    showMini: () => {},
    expand: () => {},
    minimize: () => {},
    closeMini: () => {},
  };
}
