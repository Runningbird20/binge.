// Book covers: the cover URL a book row carries, the cover image (with a text
// fallback) and the grid's poster tile.
import { useEffect, useState } from 'react';
import GridTitleTile from '../GridTitleTile';
import { findReadableEditionQueued, isFreeToRead } from '../../utils/bookAccess';

export function getCoverUrl(book) {
  const rawUrl = book.cover_url || book.coverUrl || '';
  if (!rawUrl) return '';
  if (rawUrl.startsWith('//')) return `https:${rawUrl}`;
  if (rawUrl.startsWith('http://')) return rawUrl.replace(/^http:\/\//i, 'https://');
  return rawUrl;
}

export function BookCoverImage({ book, imageClassName, placeholderClassName, priority }) {
  const [coverUrl, setCoverUrl] = useState(() => getCoverUrl(book));

  useEffect(() => {
    setCoverUrl(getCoverUrl(book));
  }, [book]);

  if (!coverUrl) {
    return (
      <div className={placeholderClassName}>
        <span>{book.title?.charAt(0)}</span>
      </div>
    );
  }

  return (
    <img
      src={coverUrl}
      alt={book.title}
      className={imageClassName}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setCoverUrl('')}
    />
  );
}

export function BookPosterTile({ book, onClick, watchlistEntry, addingWatchlist, onAddWatchlist, onStatusChange, priority }) {
  const [freeEdition, setFreeEdition] = useState(false);

  useEffect(() => {
    let cancelled = false;
    findReadableEditionQueued(book).then((access) => {
      if (!cancelled) setFreeEdition(isFreeToRead(access));
    });
    return () => { cancelled = true; };
    // The same book arrives as a new object on every catalog refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.title, book.author]);

  return (
    <GridTitleTile
      item={book}
      mediaType="book"
      onClick={onClick}
      watchlistEntry={watchlistEntry}
      addingWatchlist={addingWatchlist}
      onAddWatchlist={onAddWatchlist}
      onStatusChange={onStatusChange}
      priority={priority}
      subtitle={book.author || ''}
      badge={freeEdition ? 'Free to read' : null}
    />
  );
}
