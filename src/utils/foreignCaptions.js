// Captions for titles in another language (a Malayalam film for an English
// viewer). The player can't reach into a cross-origin server's player, but
// some servers can be told what to show:
//   - VidLink loads a subtitle file we give it (sub_file, documented), so it
//     gets binge.'s own OpenSubtitles file (/api/extras/subtitles, format=vtt,
//     cached once for everyone in subtitle_cache).
//   - VidRift lists its subtitle tracks in vidrift:state and switches with
//     vidrift:set { subtitle } (vidrift.net/docs); it starts with them off.
//   - CineSrc takes the language in its URL (embedServers.js).
// Only for titles whose original language isn't the caption language:
// OpenSubtitles allows a few downloads a day, and an English film doesn't
// need captions forced on.
import { getEmbeddedId } from './embedPlayability';
import { tmdbIdFromItem } from './tmdb';

const baseLang = (code) => String(code || '').toLowerCase().split(/[-_]/)[0];

// The caption language to switch on for this title, or null.
export function foreignCaptionLang(subtitleLang, originalLanguage) {
  if (!subtitleLang || subtitleLang === 'off' || !originalLanguage) return null;
  return baseLang(originalLanguage) === baseLang(subtitleLang) ? null : baseLang(subtitleLang);
}

export function titleTmdbId(item) {
  const fromKey = tmdbIdFromItem(item);
  if (fromKey) return String(fromKey);
  const embedded = getEmbeddedId(item);
  return embedded?.kind === 'tmdb' ? String(embedded.value) : null;
}

// binge.'s subtitle file for a title, as a URL another site's player can load.
export function subtitleFileUrl({ origin, tmdbId, isTV, season, episode, lang }) {
  if (!origin || !tmdbId || !lang) return null;
  const params = new URLSearchParams({ type: isTV ? 'tv' : 'movie', tmdb: String(tmdbId), lang, format: 'vtt' });
  if (isTV) { params.set('season', String(season || 1)); params.set('episode', String(episode || 1)); }
  return `${origin}/api/extras/subtitles?${params}`;
}

// The track in VidRift's subtitle list for a language: its own value first
// ("en", "en-2"), then VidRift's mirrored tracks ("mb-en"), then by name.
export function pickVidriftSubtitle(list, lang, languageName = '') {
  const want = baseLang(lang);
  if (!want || !Array.isArray(list)) return null;
  const options = list.filter((s) => s && s.value && s.value !== 'off');
  const exact = options.find((s) => s.value === want)
    || options.find((s) => s.value.startsWith(`${want}-`))
    || options.find((s) => s.value === `mb-${want}`)
    || (languageName && options.find((s) => String(s.label || '').toLowerCase().startsWith(languageName.toLowerCase())));
  return exact ? exact.value : null;
}
