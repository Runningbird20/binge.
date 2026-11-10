# Apple TV app

The native tvOS app in `tv-apple/`: how it plays video, what only showed up on real hardware, its memory limits, debug launch arguments and tests. Behaviour shared with Fire TV is in [tv-apps.md](tv-apps.md).

## Project and build

Native SwiftUI tvOS app with no dependencies. The project is a hand-written `BingeTV.xcodeproj` with a folder-synced `BingeTV/` group, so new files need no project edits. If Xcode has the project open while you edit `project.pbxproj` by hand, it may re-save the file and drop entries it can't resolve; re-check after editing. Supabase is GoTrue + PostgREST over URLSession, with the session in the Keychain. Keys come from `Config/Secrets.xcconfig` (gitignored; `tv-apple/scripts/make-secrets.sh` builds it from `.env`; public keys only). Build with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.

## Playback

**Playback** is in the app, through tvOS's private **WKWebView** (`Player/WebEngine.swift`, via the Obj-C runtime: sideload-only, never App Store).
- **Legacy fallback.** `UIWebView` is only a fallback: any `<video>` seek crashes inside WebKit there (`canSeek = false`).
- **Servers.** tvOS has no MSE, so only servers with a native-HLS fallback work: VidRift, Vidy, CineSrc (`Player/Servers.swift`). VidRift exposes about 25 dubs; CineSrc has subtitle tracks.
- **Startup.** `StreamRace` runs all servers at once (an Apple TV 4K has the memory for it, which is quicker than the Fire TV's two-at-a-time). `Warmup` runs one background race from the title page, a focused Continue Watching card or the next episode, held on its first frame. Measured 2026-11-09 in the simulator: Parasite 3.8s cold, 0.5s warm.
  - **Planning** (`ServerPlan.servers`): admin switches, original language and audio reports are fetched at once, each capped at 1.5s (`within`).
  - **On screen, the first stream to play shows at once.** With Best quality the others keep loading for 8s and a sharper one takes over at the same second (`upgradeTick`). Only a preload waits for the sharpest server, since nobody is watching it yet.
  - **`ServerSpeed`** remembers how long each server takes to start here (a give-up counts as 40s). An Apple TV HD races only one or two, the quickest first.
  - **Recovery honours the admin's off switches** (`PlayerModel.servers`). It used to race a switched-off server.
- **Native playback** (`HybridEngine` + `NativeEngine`, 2026-11-09, `binge.nativePlayer`). tvOS pages play native HLS, so the bridge reports the stream (`video.currentSrc`), the frame playing it (Referer) and the UA. AVPlayer then opens it with those headers (`AVURLAssetHTTPHeaderFieldsKey`, private API; sideload-only app).
  - **Side by side.** The page keeps playing, muted, while AVPlayer starts hidden, so whichever shows pictures first is on screen. A slow stream server costs no extra time. AVPlayer takes over at the page's second once it has a picture, and the page is closed. If it has none 20s after the page started playing, the page carries on and that stream host stays in the page for a day. The Apple TV HD pauses the page instead (two decoders) and gives AVPlayer 8s.
  - **Buffering.** AVPlayer starts on the playlist's first variant, keeps 60s buffered for movies and episodes, and keeps live 20s behind the edge (`configuredTimeOffsetFromLive`, kept through stalls).
  - **Everywhere:** movies, shows, live games (the standby too) and Multiview tiles (a tile's iframe leaves the shared page once AVPlayer has it). Trailers stay in the page (`WebEngines.make(native: false)`).
  - **Measured** in the simulator: Willow live 5.2s with a standby; 2-tile Multiview at 383 MB, 100% of real time, 0 dropped frames, sound correct across focus swaps.
  - **Crash Landing on You** went from 18–25s to 11.5s. Its floor is CineSrc's page, which takes ~8s to set its stream; Vidy never loads it, and VidRift was switched off in the admin panel on 2026-11-09.
  - **Saved streams** (`StreamCache`). A stream that played is kept for 3 hours under its server page's address (max 40). Playing that server and episode again starts AVPlayer on it at once, with the page loading alongside as the backup (the Apple TV HD loads the page only if the saved stream fails). A saved stream that fails (its token ran out) is dropped without marking the host as failing, and the page's fresh stream gets AVPlayer as usual.
  - **Display mode.** Once AVPlayer is on screen, the player asks the TV for the video's frame rate and range (`NativeEngine.displayCriteria`: the track's measured rate and format, else the playlist's), when Match Content is on. Movies and episodes pause up to 5s while the TV switches; live keeps going. Closing the player clears it. Multiview keeps clearing it every second (its games mix 50 and 60fps).
  - **Now Playing** (`NowPlaying.swift`). Title, episode, poster and progress go to Control Center and the iPhone's Apple TV Remote, and their play/pause/skip/scrub drive the player. A toggle there within 0.6s of a Siri remote press is the same press echoed, and is ignored.
  - **Subtitles when skipping back** (`binge.captionsOnRewind`, on by default). With subtitles off, ◀ turns on the server's track in the profile's subtitle language (else the Apple TV's language) until the video is 1s past where ◀ was pressed.
- **The bridge** is `WebEngines.bridgeScript`. It reports the main `<video>` via `webkit.messageHandlers.binge` and relays commands to child frames with `postMessage`. Progress is saved to `continue_watching`.

## Details found on a real Apple TV

- **Safe area:** `ModernWebView` uses a runtime `BingeWKWebView` subclass that reports zero `safeAreaInsets`. Otherwise the overscan safe area offsets fixed-position video toward the bottom-right.
- **Muting:** goes through WebKit's `_setPageMuted:` (every page starts muted, and only the winner or focused tile is unmuted), because page-level `video.muted` wasn't reliable across frames.
- **Audio and subtitles:** the bridge reports `videoHeight`, `audioTracks` and `textTracks`, and the player panel switches them (`audio:i` / `text:i`). The profile's prefs auto-apply per video. "Original language" falls back to TMDB `original_language` when the catalog's is null.
- **Recovery:**
  - **Triggers.** Once playing, a clock stuck for 20s (12s live), or no video report for 8s (the web process died: `webViewWebContentProcessDidTerminate:`), re-races the other servers from the saved second, up to 3 times. Hand-picked servers only get a notice.
  - **Spinner.** It shows after 1.5s stuck.
  - **Leaving the app** pauses (except live) and saves.
  - **Memory warnings / backgrounding** cancel the Warmup preload and end live upgrade shopping.

## Best quality and live standby

- **Best quality** (2026-10-14).
  - **`QualityMemory`** learns each server's real resolution on this Apple TV. The player records it after 30s on a server, once ABR has climbed. The key is the server id for movie/TV, the label for sports, with a label's "1080p"/"4K"/"HD" as a starting hint.
  - **Sorting.** Best quality sorts movie/TV servers (`ServerPlan`) and sports feeds (the `SportsFeed` ranking, so the sharpest are among the 4 raced) by it.
  - **The race** (warm preloads and live games included) waits up to 6s (4s live) for the sharpest-known server to play before taking the sharpest one playing. The live upgrade window promotes a better-known server too.
  - **Fastest start** takes the first to play. Multiview tiles always take the first.
- **Live sharpness and standby** (2026-10-14).
  - **Upgrade window.** A live race (the player, not Multiview tiles or warm preloads) always gets the 6s window after its first stream plays, and switches to a runner-up at least 1.3× sharper.
  - **Standby.** When the window ends, the sharpest runner-up that's really playing stays as `standby` (muted, hidden, playing).
  - **Swapping.** `standbyTick` swaps them, picture and sound, when the stream on screen hasn't moved for 2.5s (a cushion hold counts) and the standby has. At most every 10s, and the stalled one becomes the standby.
  - **Memory.** Memory warnings drop the standby.
  - **Verifying.** Use `-BingeStallAfter 25 -BingeLive willow`. The stall is a bridge command (`debugfreeze`), so it reaches nested frames, and it fires once.

## Sports

- **Sports** mirrors the website's page: spotlight, category chips, 16:9 thumbnail rows per league (the same `inferLeague` rules), 24/7 channels and an ESPN Scores row.
  - **Art.** `SportArt` is team logos on split team colours, else the provider poster, else a sport icon.
  - **Feeds.** `Data/SportsFeed.swift` fetches PPV/Streamed/StreamFree directly. It merges per game by team nicknames or, failing that, by each side sharing a distinctive word (`sides`/`sameMatchup`, also in Fire TV `Sports.kt`), and matches ESPN events the same way.
  - **The race.** Feeds are interleaved so the 4-page live race (`StreamRace.maxLiveContenders`) spans different feeds; the rest are backups that recovery tries first.
  - **Memory.** `SportsMemory` (UserDefaults `binge.sportsFeed.<family>`) ranks the feed families that played on this Apple TV first.
  - **Preloading.** Focusing a game card for ~0.9s preloads it (live warm races stay running, muted), and stream lookups are cached for 90s.
  - **In the player,** ◀ / ▶ change to the previous / next live game (`flipGame`).

## Multiview

- **Multiview as one page** (2026-10-13, the default). `MultiviewPage` is one WKWebView loading our own HTML (base URL = the site), with one iframe per game: the website's Multiview design.
  - **Slots.** Each tile's race gets a `PageSlotEngine` (via `StreamRace(makeEngine:)`) instead of its own WKWebView, so tiles, failover, sound, fill, the server picker and the cushion work unchanged.
  - **Messages up.** The bridge posts each frame's state to `window.top` (`__bingeState`). The page finds which iframe it came from (recursive `window.frames`) and forwards it to the `bingeMulti` handler, tagged with the slot.
  - **Commands down.** `mvSend` → `postMessage({__binge})`.
  - **Muting.** The page re-mutes every non-audible slot every 500ms (games start with sound).
  - **No stretching.** `window.__bingeMultiviewPage` stops the bridge's fill from stretching a game's iframe over the whole page.
  - **Measured** in the simulator: 3 live games in one 119MB process (separate pages: ~230–320MB each).
  - **Starting.** The shared page starts every tile at once. Settings › Playback › Multiview engine switches back to separate pages, which start one after another (each when the previous plays, 3s at most).
  - **Preloads.** `Warmup.shared.suspended` blocks background preloads while Multiview is open; the Sports page underneath kept preloading its spotlight game (4 servers) during Multiview.
- **Multiview limits** (2026-10-13, after a real Apple TV and its TV crashed with 3–4 games).
  - **How many load.** At most `MultiviewCapacity.games` tiles load at once: 2 on an Apple TV 4K, 1 on the Apple TV HD (`AppleTV5,*`). It's lowered (persisted, `binge.multiviewCapacity`) when a session has to pause one.
  - **Waiting tiles.** Extra tiles wait as "Paused to keep the others smooth". Picking one closes the least recently watched tile's page: `throttle()` unloads, never just pauses, because a paused page kept its whole WebContent process. A memory warning also closes the least recently watched game.
  - **One server page per tile** (`perTile = 1`). Failed servers retry the next ones (3 batches).
  - **Warmup** skips when `WebEngines.liveCount >= 5`.
  - **Fixes from the 2026-11-01 live check.** A live-cushion hold no longer counts as a frozen picture (it made Multiview pause a game for good and save a lower limit). A lowered limit expires after 24h. The shared `MultiviewPage` is made once in `.task`; building it in `init` made a throwaway WKWebView on every Sports redraw (10 in 5 min).
  - **HDMI.** While Multiview is open, `avDisplayManager.preferredDisplayCriteria` is held at nil, so Match Content can't re-sync the TV's HDMI per tile.
  - **Simulator.** With separate pages, the tvOS simulator draws only one web video at a time (unfocused tiles look black). That's not a bug; verify on hardware. WebKit reports dropped == total for muted unfocused tiles, so that pattern is ignored.

## Memory and images

- **Low-memory devices** (2026-10-31). `Device.isLowMemory` is the Apple TV HD, <2.5 GB, or `-BingeLowMemory YES`. It means:
  - smaller TMDB sizes;
  - 2 pages per race (movies retry the un-raced server when a race fails);
  - Warmup preloads 1 server, and only with <2 pages open.
- **Images.** Every Apple TV picture goes through `RemoteImage`/`ImageStore` (ImageIO thumbnails at the view's pixel size, NSCache 128/48 MB, cleared on memory warnings). Never use `AsyncImage`: it decoded full-size posters (Home was 105 MB, now 47 MB in the simulator). Finished pages are ended with WKWebView `_close` (`WebEngines.close`).
- **Artwork for 4K.** `TMDB.fullScreen` (original) for spotlight/ambient/title backdrops, `TMDB.wide` (w1280) for wide cards, `TMDB.poster` (w780); `TMDB.resized` rewrites a stored URL. Ambient prefetches the next picture.

## Other features

- **Player options** are a right-hand sidebar (`PlayerPanel`, `Pane`, `SideRow`, as on Fire TV).
- **Also on the Apple TV:**
  - **Shared with the site:** the server switches (`ServerSwitches`), 1–5★ ratings (uniform criteria), audio/subtitle prefs (`ServerPlan` uses `stream_report_summary`), outside ratings/AI picks, heatmap, franchises, Previously on, and History/Calendar/Wrapped.
  - **Sports:** followed teams + in-app close-game alerts (`TeamCenter`), and a corner PiP + alert banner in a second, non-interactive UIWindow (`Player/Overlay.swift`).
  - **Library and playback extras:** My List & Ratings (`LibraryView`, `ratedTitles()`), spotlight trailers, and skip intro / sleep timer / Still watching.
  - **System:** a Top Shelf extension (`TopShelf/`, App Group `group.$(BINGE_BUNDLE_ID)`, `binge://` deep links).
  - **QR handoff to a phone** remains only as a fallback.

## Debug launch arguments

- **Navigation:** `-BingeDemo`, `-BingeTab`, `-BingeOpen kind:id`, `-BingeOpen page:library` (`-BingeLibraryTab 1` = Ratings), `-BingePanel YES` (opens the player sidebar).
- **Playback:** `-BingePlay s:e`, `-BingePlayAfter N`, `-BingeLive <team>`, `-BingeProbe <url>`, `-BingeHandoff YES`.
- **Failure simulation:** `-BingeStallAfter N`, `-BingeKillAfter N`, `-BingeAmbientAfter N`, `-BingeLowMemory YES`.
- **Subtitles and audio:** `-BingeSubtitlesURL <url>` (a fixed test file), `-BingeAudioTest fr` (switches audio 20s in; verified on VidRift: Korean→French, kept playing).
- **Sign-in:** `-BingeEmail <e> -BingePassword <p>` signs in without the remote keyboard.

## Tests (`tv-apple/BingeTVTests`, `tv-apple/BingeTVUITests`)

`tv-apple/scripts/run-tests.sh` (boot an Apple TV simulator first; `BINGE_SIM=<udid>`, `BINGE_FILTER=BingeTVTests/<Suite>`):
- **No argument: unit suites** (Swift Testing, hosted in the app, no network). Keep these green.
  - They cover models, maturity, the release window, the kids filter, server URLs, subtitle parsing/lookup, season notes, markers, sports merging/leagues/alerts, track-language matching, Personal rows and the Up Next countdown.
  - `BridgeTests` run the real bridge script in tvOS WebKit against a generated video + WebVTT tracks: play/pause/seek/clamp, hidden subtitle tracks and their line, fill, nested-iframe relay, the navigation lock.
- **`live`: real services.** The report goes to `build/live-report.jsonl`.
  - It checks catalog coverage + runtimes for ~56 well-known/new/old/international/obscure/anime titles, and every server playing each title (right length, tracks).
  - It also covers subtitles, search (typos, accents, Korean, people, kids), every row, recs, Ask binge., franchises, AniSkip, and sports feeds/ESPN/live streams.
  - Subtitle checks spend the shared OpenSubtitles quota, so only 6 run unless `BINGE_LIVE_SUBS=all`.
  - `BINGE_EMAIL`/`BINGE_PASSWORD` add a signed-in round trip (undone afterwards).
- **`ui`: XCUITest with the Siri Remote** — every tab, title pages, the player HUD/panel, subtitles on a Korean show, search, the Sports hold menu, Me pages, larger text. Screenshots go to `build/screenshots`.
  - `UserJourneyUITests` is a whole evening (browse → watch → skip/pause → subtitles → next episode → search → live game → settings), each step timed (`[journey]` in `build/test.log`).
  - Run it between `scripts/apple-tv-constraints.sh start [budget-MB]` / `stop` to approximate Apple TV hardware. The app and its WebKit processes go to background priority (efficiency cores), and their combined memory is sampled against a budget (1800 MB ≈ Apple TV 4K; ~900 for the Apple TV HD).
  - It's an approximation: the simulator still uses the Mac's video decoder and doesn't enforce tvOS memory limits.
- **`scripts/multiview-check.sh "team1,team2" [seconds] [budget-MB] [-BingeMultiSwap N] [-BingeMultiExpand N]`**: live Multiview under the same limits. The Debug build logs every tile every 2s (`[mvstat]`: clock, buffer ahead, cushion, muted, resolution, dropped/frozen, held/paused by Multiview), and the script reports each game's share of real time, stalls, holds and wrong-sound samples. Measured 2026-11-01 (2 NFL games, 10 min): 100% / 99% of real time, sound always on the focused game only; the one hold was the Fox feed running dry.
