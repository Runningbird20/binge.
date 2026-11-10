# TV apps: shared behaviour

How the Apple TV app (`tv-apple/`) and the Fire TV / Android TV app (`tv-android/`) work where they behave the same: data, maturity, playback, subtitles, live streams and Multiview. App-specific details are in [apple-tv.md](apple-tv.md) and [fire-tv.md](fire-tv.md); which features exist on which app is in [`DIFF.md`](../DIFF.md).

## Data and maturity

- **Data.** They use the same Supabase tables/RLS as the site, and TMDB rows matched to the catalog by `source_key`; the release window mirrors the site. Rows are scoped by `user_id` + `profile_id`, and the default (or only) profile also sees legacy rows with `profile_id` null. Home is Netflix-style (`Personal.build`): Top Picks scored across recent watches + ≥4★ ratings, "Because you watched/liked", and New Episodes from TMDB `last_episode_to_air`. `/api/extras/*` supplies outside ratings, Ask binge., subtitles and episode ratings.
- **Maturity.** `Maturity` in `Models.swift` / `Models.kt` is decoded leniently from `settings`, so it never fails the profile list.
  - Its ratings filter every catalog match.
  - Toddler/Kids (`isChild`, = `isKids` in AppModel) get the kids-only rows and no Sports tab. Teens get the normal rows and Sports.
  - The profile pickers show the level's pill (Toddler / Kids / Teens).
  - Unrated titles are left out on every restricted level.
  - Fire TV keeps a Home snapshot per level.

## Playback

- **Playback.**
  - **Loading.** The server's player page loads top-level in a hidden web view (WKWebView / Android WebView).
  - **The bridge.** A bridge script injected into every frame drives its `<video>` and reports the main one; that's what makes nested-iframe live-sports embeds controllable.
  - **The race.** `StreamRace` races several servers, muted, and the first to play wins.
  - **Native playback is allowed.** Once the page has found its stream, the app may play that address in its own player (AVPlayer / ExoPlayer through `HybridEngine`), and that path may be changed in any way that improves start time or smoothness.
  - **Recovery** re-races the other servers from the saved second.
  - **Hand-picked servers are never auto-switched.**
- **Wrong video under the right id.** A server can play a different title: Vidy served a 98-min video for the 156-min Demon Slayer: Infinity Castle. `ExpectedRuntime` compares the stream's length with TMDB's runtime, using the same rule as the web. The race rejects a wrong stream, and the player recovers.

## Subtitles

- **Subtitles are drawn by the app.** The bridge keeps the chosen track `hidden` and sends the current line (`cue`, from `activeCues` or by scanning `cues` against `currentTime`). `SubtitleLine` draws it with the Settings size/background (`captionStyle`).
  - **Why.** WebKit doesn't render them reliably on tvOS, and fill mode hides servers' own caption overlays (CineSrc, Vidy).
  - **Empty tracks.** VidRift lists ~150 tracks, and WebKit only loads in-stream ones once enabled, so an empty chosen track cycles through same-language tracks (plain "English" first, 2.5s each).
  - **No tracks at all.** A foreign-language title on a server with no tracks (Vidy) recovers to another server after 8s.
- **Subtitles from OpenSubtitles.**
  - **The route.** `GET /api/extras/subtitles?type=&tmdb=&season=&episode=&lang=&version=` (`server/routes/extras.js`) searches OpenSubtitles by TMDB id. It ranks the files: no AI or machine translations, non-hearing-impaired first, trusted, most downloaded.
  - **Caching.** It downloads the WebVTT once and caches it in `subtitle_cache` (migration `20261015120000`, APPLIED; service role only), because the free API allows only a few downloads a day.
  - **Keys.** Needs `OPENSUBTITLES_API_KEY` (+ optional `OPENSUBTITLES_USERNAME/PASSWORD`) locally and in Vercel. Without it, the route answers `{unavailable}` and the TV falls back to the server's tracks.
  - **On the TV** (`Player/ExternalSubtitles.swift` and the Fire TV twin), the app parses the VTT and draws the line for `t - shift` (+ = later), from a clock run on between polls (Apple TV redraws 20 times a second). The panel offers the language, Earlier/Later (0.5s), back to the file's timing, and "Another version". Until 2026-11-10 the Apple TV had the sign backwards (Earlier made lines later).
- **Timing that sticks** (`SubtitleSync`, both apps). A file made for another cut of the video is off by the same gap throughout, and the servers' own captions (the website's) often are too. A shift is remembered on the TV per file (release name) + server, carried to the show's next episodes on that server, and, once left alone for 20s of playing, shared in `subtitle_sync` (migration `20261110120000`, NOT YET APPLIED; until it is, the shared part quietly does nothing). The next viewer starts from the median, with a notice saying so.
  - **The website can't shift captions:** they're drawn by the server's player inside a cross-origin frame. Only the server's own menu can.

## Live streams

- **Live cushion.**
  - **Start.** The bridge's `cushion:start`, sent when a live stream first plays, holds the video until ~4s is buffered.
  - **While playing.** `cushion:on` (Multiview tiles too) pauses whenever the buffer runs dry (<0.8s) and resumes at ~6s (10s cap). That leaves it a little behind live instead of play-stall-play.
  - **State.** `cb` means holding. Players treat it as buffering and never auto-resume it.
  - **`edge`** lands 8s behind live, and only when it's more than 14s behind.

## Fill

- **Fill** pins the video full screen. It neutralises every containing-block trap on the video's ancestors: `container-type` (Vidy's wrapper uses it), `will-change`, `clip-path`, shadow-root hosts. Picture → "Server's layout" undoes it.

## Multiview

- **Multiview** (up to 4 tiles; hold a game → Add to Multiview).
  - **What limits it.** Measured on a 1.5 GB Android TV emulator, 4 HD tiles grew the shared WebView renderer to ~440 MB, but decoding is the real limit.
  - **Tile lifecycle.**
    - Ad frames are trimmed 8s in.
    - Tiles hidden behind a full-screen game are paused and rejoin at the live edge (`edge`).
    - A stalled clock gets `edge` at 8s and another server at 18s.
    - A tile has a `stopped` flag (a tile whose staggered start came after leaving used to keep its pages alive off-screen, which ran the Apple TV out of memory).
    - A tile restarts itself if its page stops reporting (at most twice) and never keeps spare "upgrade" streams.
    - Warmup is cancelled on entry.
  - **Dropped frames.** Each tile reports `getVideoPlaybackQuality` (`fr`/`dr`). When frames drop (>30% on a tile, or a ≥20% average), Multiview pauses the worst non-focused tile ("Paused to keep the others smooth"; OK resumes it) and defers tiles that haven't started. A frozen picture with others playing counts as overload; a frozen picture alone switches server.
  - **Learned limit.** It's saved (`MultiviewCapacity`): later sessions start that many games and defer the rest.
  - **Audio.** Mute the others first, then unmute the focused tile 150ms later (two audible videos make tvOS pause one). Tiles paused without Play/Pause auto-resume.
  - **Per-game server.** Fire TV: hold OK or ≡ on a tile (`ServerPicker`). Apple TV: hold select (`.contextMenu`). A hand-picked server gets no stall/frozen/failed-batch failover.
  - **Layout** (Settings › Playback › Multiview layout): "Equal tiles" (the default, 2 per row) or "One big, others beside" (2–3 games: a big main tile with the others stacked on the right; click a small one to make it main, click main for full screen).

## Skip intro and TV-only extras

- **Skip intro** sits bottom-right. It lifts above the HUD while the HUD shows, and subtitles move up while it's there. ▼ hides it for the episode, and Settings › Playback can turn it off (`PlaybackPrefs.skipIntroButton`).
- **TV-only extras.**
  - **Best quality vs Fastest start** (`QualityPreference`).
    - For movies, Best waits 1.5s after the first stream plays and keeps the sharpest. It never shops in parallel while one plays, because a second video starting pauses the first on tvOS.
    - Live keeps its 6s upgrade window.
    - A resolution badge (4K/1080p) shows in the HUD.
  - **Pauses** the viewer didn't make are undone (`holdPause()` marks the app's own).
  - **Ambient mode** (`AmbientView`) starts after 4 idle minutes (measured by focus changes), or 3 paused minutes in the player.
  - **Accessibility and display.** Subtitle size/background (`video::cue` CSS; native HLS captions may follow the system caption style instead), audio-description-first (by track labels), and "Larger text" (`dynamicTypeSize`).
  - **Voice search** is the system dictation in `.searchable`; spoken phrasings go to Ask binge.
  - **Not on the TV apps, by decision:** the ticket book.
