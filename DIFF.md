# Platform differences

What each binge. app has that the others don't. Features that work the same everywhere (sign in, profiles and PIN locks, maturity levels, Continue Watching, My List, Top Picks, Sent to you, Ask binge., outside ratings, Previously on, More Like This, Up Next, server failover, Wrapped, History, Sports schedules) aren't listed.

**The four apps**
- **Computer**: the website on a desktop, laptop or tablet (`src/`).
- **Phone**: the same website on a phone. A phone is a screen whose short side is 768 px or less (`useDeviceType`). The phone layout adds the bottom nav, bottom sheets and swipe gestures. The site can also be installed as a PWA.
  - It also comes as the binge. app (`mobile-android/`, `mobile-ios/`): the same phone website in a native shell.
  - The app refuses every pop-up and redirect from the players, and saves files the site makes.
  - It lacks web push. Where the app differs, the Notes say so.
- **Apple TV**: `tv-apple/`, SwiftUI.
- **Fire TV**: `tv-android/`, Kotlin + Compose for TV.

The website also has a **TV mode** for smart-TV browsers (`?tv=1`, `html.tv-mode`). It's the computer layout driven by a remote. It isn't a separate app, and the TV apps don't use it.

**Key:** ✓ has it · ◐ partly (see note) · — doesn't have it · *by decision* = left out on purpose

Checked against the code on 2026-11-05. **When a feature ships on only some apps, add it here** (and delete its row once every app has it).

---

## Title page

| Feature | Computer | Phone | Apple TV | Fire TV | Notes |
|---|:-:|:-:|:-:|:-:|---|
| Where to watch (legal streaming services row) | ✓ | ✓ | — | — | `WhereToWatch.js`, TMDB `watch/providers`. |
| Cast & crew photo row | ✓ | ✓ | ✓ | ✓ | Both TV apps: the Cast row (`CastRow`), each photo opening the person's page. |
| Actor / director pages (`/person/:id`) | ✓ | ✓ | ✓ | ✓ | `pages/Person.js`, `utils/people.js`; Apple TV `PersonView`, Fire TV `PersonScreen` (`data/People.kt`), same rules. |
| Episode heatmap | ✓ | ✓ | ✓ | — | Fire TV has no `EpisodeHeatmap`. |
| Franchise "Mark all watched" | ✓ | ✓ | — | — | `FranchiseOrder.js`. Story / release order itself is on every app. |
| Mark season watched / Watched up to here | ✓ | ✓ | ✓ | ✓ | TV apps: a pill before the season picker, and "Watched up to here" / "Mark as not watched" when you hold an episode, with Undo. |
| Detailed rating (per category) | ✓ | ✓ | ◐ | ◐ | TV apps: 1–5 stars, copied into every category. |
| Remind me (release reminders) | ✓ | ✓ | ◐ | ◐ | `RemindButton`; delivered in the app and by push. Apple TV: only for what isn't out yet (a movie's release, a series' next episode, at 9 that morning); due reminders show on Home. |

## Home & browsing

| Feature | Computer | Phone | Apple TV | Fire TV | Notes |
|---|:-:|:-:|:-:|:-:|---|
| Spotlight with logo art | ✓ | ✓ | ✓ | — | Apple TV: `HeroLogo`, text after 0.9s without one. Fire TV shows the title as text. |
| Spotlight trailers | ✓ | — | ✓ | — | The website plays them only with a mouse or trackpad (`canAutoplayPreviews`). |
| Trailer previews when hovering a card | ✓ | — | — | — | `HoverPreview.js`, needs a mouse or trackpad. |
| Watched titles left out of every recommendation | ✓ | ✓ | ✓ | ✓ | `utils/watchedTitles.js`; Apple TV and Fire TV `WatchedTitles`. |
| Finished shows leave Continue Watching | ✓ | ✓ | ✓ | ✓ | Newest episode marked watched and nothing saved partway (`Home.js`; the TV apps' `finishedShows` / `EpisodeStore.finished`). |
| Home opens instantly from the last visit | ✓ | ✓ | ✓ | ✓ | The TV apps save Home to disk for 7 days (`HomeSnapshot`); the website keeps Home's and the browse rows the same way (`utils/keptCache.js`, cleared on sign-out). |
| Pull to refresh | — | ✓ | — | — | Touch only. |
| Rows loop back to the start (Netflix-style) | — | — | ✓ | — | Apple TV: rows of 8+ titles carry on past the last one (`RowLoop` in `Components.swift`). |
| Keyboard shortcuts (`/`, `?`, arrow keys) | ✓ | — | n/a | n/a | `KeyboardShortcuts.js`; also drives the website's TV mode. |

## Search

| Feature | Computer | Phone | Apple TV | Fire TV | Notes |
|---|:-:|:-:|:-:|:-:|---|
| Type / decade / language filter chips | ✓ | ✓ | — | — | Results page only (`utils/searchFilters.js`). |
| People in search (with a link to their page) | ✓ | ✓ | ◐ | ◐ | TV apps mix an actor's best-known titles into the results; there's no person result. |
| Recent searches | ✓ | ✓ | ✓ | ✓ | The TV apps keep the last 8 per profile, on that TV. |
| Voice search | — | — | ✓ | ◐ | Apple TV: system dictation. Fire TV: only the Fire TV keyboard's mic. |

## Library, stats & account

| Feature | Computer | Phone | Apple TV | Fire TV | Notes |
|---|:-:|:-:|:-:|:-:|---|
| Watched tab (finished, not rated) | ✓ | ✓ | — | — | Profile page. TV apps have My List and Ratings only. |
| "Time watched" counter (1y 2m 3w 4d …) | ✓ | ✓ | — | — | Profile page. |
| Undo after removing (10-second popup) | ✓ | ✓ | — | — | My List, Continue Watching and History (`UndoToast.js`). |
| Calendar export (.ics) | ✓ | ✓ | — | — | Phones get the share sheet; computers download a file. |
| Ticket book (monthly stubs, passport, achievements) | ✓ | ✓ | — | — | *By decision*: phones and computers only, also hidden in the website's TV mode. |
| Create / edit profiles, choose avatars, set maturity | ✓ | ✓ | — | — | TV apps only read profiles. |
| Autoplay next, previews, data saver, captions first | ✓ | ✓ | — | — | TV apps have no autoplay toggle. |
| Sign up, delete account, download my data, import history | ✓ | ✓ | — | — | TV apps send people to the website. |
| Admin panel | ✓ | ✓ | — | — | TV apps do follow the admin's server on/off switches. |

## Player

| Feature | Computer | Phone | Apple TV | Fire TV | Notes |
|---|:-:|:-:|:-:|:-:|---|
| Switch a video's own audio / subtitle tracks | ◐ | ◐ | ✓ | ✓ | The website can't reach inside the players (cross-origin). It picks a server and passes a subtitle language where the server supports it. |
| Subtitles from OpenSubtitles (timing nudge, other versions) | — | ◐ | ✓ | ✓ | `/api/extras/subtitles`. A timing fix is remembered per file and server and shared with other viewers (`SubtitleSync`, `subtitle_sync`). Phone: only in the binge. app (the frame bridge draws them inside the server's frame; Options › binge. captions). The website in a browser can't shift or draw them: the server's player does. |
| Subtitle size & background | — | — | ✓ | ✓ | |
| Skip intro | ◐ | ◐ | ✓ | ✓ | The website can only jump on some servers (VidRift, or ones that can start at a given second). |
| Best quality / Fastest start, resolution badge | — | — | ✓ | ✓ | Apple TV also learns each server's real resolution (`QualityMemory`). |
| Sleep timer, "Still watching?" | ✓ | ✓ | ✓ | ✓ | The website's sleep timer closes the player when it's time (it can't pause another site's player), keeping your place. |
| Audio description first, Larger text | — | — | ✓ | ✓ | |
| Ambient mode (slideshow when idle) | — | — | ✓ | ✓ | Both have an on/off switch in Settings. |
| Follows an episode change made inside the server's player | ✓ | ✓ | — | — | VidRift's own Next button, Episodes menu or Up Next: the site moves to that episode without reloading (`useServerEpisode`). The TV apps don't read VidRift's episode messages. |
| Fullscreen with landscape lock | ✓ | ◐ | n/a | n/a | Landscape lock works only on Android; iPhones get a "turn your phone" hint. |
| Picture: fill the screen / server's layout | — | — | ✓ | ✓ | TV apps can stretch the server's video over the whole screen. |
| Pop-ups from the video servers blocked | ◐ | ◐ | ✓ | ✓ | The TV apps and the phone apps refuse every pop-up. The website in a browser sandboxes the servers that allow it: VidRift and CineSrc, not Sports (`utils/popupSandbox.js`). |
| Streams play in the TV's own player (native HLS) | — | — | ✓ | ✓ | Once the server's page finds its stream (`HybridEngine`). Apple TV also saves a stream that played for 3 hours, so playing it again skips the page (`StreamCache`). |
| TV switches to the video's frame rate (Match Content) | — | — | ✓ | ✓ | Apple TV: Match Content (`NativeEngine.displayCriteria`). Fire TV: `preferredDisplayModeId` to a mode at the video's rate, when the TV has one (`DisplayMatch`). Native player only. |
| Now Playing in Control Center / the phone's TV remote | — | — | ✓ | — | `NowPlaying.swift`: title, episode, poster, progress, play/pause/skip. |
| Subtitles while skipping back | — | — | ✓ | — | Apple TV: with subtitles off, ◀ turns the server's track on until the video passes where you were. |
| Backup stream for movies and episodes, started only when needed | — | — | ✓ | ✓ | Both TV apps: when the buffer drains (or the picture froze) the next-best server loads silently at that second and takes over if the picture stops. Fire TV loads one page at most, and only with room. |
| Steady quality on a shaky connection | — | — | ✓ | — | Apple TV, Apple's player only: a stall, or a low buffer that downloads don't refill, caps the bitrate a step down until the connection recovers (`NativeEngine.guardQuality`). |
| Playback info (server, resolution, bitrate, download speed, buffer, dropped frames, stalls, audio) | — | — | ✓ | ✓ | TV apps: Options › Playback info, with a one-line diagnosis. |
| Instant resume after leaving the player | — | — | ✓ | ✓ | TV apps: the stream stays loaded and paused for 5 minutes (2 for live). Fire TV keeps only a native stream on a stick. |
| Preload what you rest on (your rows, spotlight) | — | — | ✓ | ✓ | Your own rows after 1s (Apple TV also the spotlight). Both TVs preload Continue Watching cards. |
| Server speed and quality shared between devices | — | — | ✓ | ✓ | `server_stats` per kind of device: a new TV starts from other TVs' measurements (Fire TV shares start times). |
| Swipe to scrub with picture previews | — | — | ✓ | — | Apple TV: swipe on the Siri Remote's touch surface; previews from a second low-bitrate player when Apple's player is on (`Scrub.swift`). |
| Skip intros automatically (per show), binge mode | ◐ | ◐ | ✓ | ✓ | Apple TV: Options › Skip intros automatically (offered after you skip two episodes' intros); Settings › Binge mode starts the next episode at the credits. The website does the same, but can only skip on servers that can jump (VidRift and the resumable ones). Only intros with a known timing are skipped. |
| Movies and episodes in a corner while you browse | — | — | ✓ | — | Apple TV: Options › Keep watching in the corner; Home's bar goes back to full screen without a reload. Live games could already. |
| Surround sound and Spatial Audio | — | — | ✓ | — | Apple TV: multichannel passes to the receiver, Spatial Audio for AirPods (`allowedAudioSpatializationFormats`). |

## Sports

| Feature | Computer | Phone | Apple TV | Fire TV | Notes |
|---|:-:|:-:|:-:|:-:|---|
| Multiview | ✓ | — | ✓ | ✓ | *By decision* not on phones (too small). Apple TV: up to 4 games (2 on an Apple TV HD). Fire TV: up to 4, and it learns the device's limit. |
| Multiview layout (one big + others) | — | — | ✓ | ✓ | The website uses an equal grid. |
| Followed teams & game alerts | ✓ | ✓ | ◐ | — | Website: push alerts. Apple TV: in-app banners only, with a "Your teams" row. |
| Live score panel (second screen, line score) | ✓ | ✓ | ◐ | ◐ | TV apps show score chips and a Scores row. |
| Fantasy roster | ✓ | ✓ | — | — | `FantasyRoster`, ESPN Fantasy. |
| Hide scores | ✓ | ✓ | ✓ | ✓ | TV apps: the pill before the sport chips; Apple TV's game alerts leave the score out too. |
| Previous / next live game from the player (◀ ▶) | n/a | n/a | ✓ | — | |
| A live game in a corner window over other video | — | — | ✓ | — | `Player/Overlay.swift`. |

## Reading, notifications & the rest

| Feature | Computer | Phone | Apple TV | Fire TV | Notes |
|---|:-:|:-:|:-:|:-:|---|
| Books & manga (reader, Where to read) | ✓ | ✓ | — | — | |
| Push notifications (new episodes, reminders, admin broadcasts) | ✓ | ✓ | — | — | iPhones need the site installed to the Home Screen. |
| Announcements banner | ✓ | ✓ | ◐ | ◐ | TV apps: Home, Movies, Series and Sports; links are shown as text (a TV can't open them). |
| Error reporting to the admin panel | ✓ | ✓ | ✓ | ✓ | TV apps: crashes (sent on the next launch) and "no server could play" (Apple TV `CrashReporter.swift`, Fire TV `data/Ops.kt`). |
| Offline banner, app shortcuts, share to binge. | ✓ | ✓ | — | — | PWA features. Sharing links to binge. is mostly used on phones. |

---

## Only on one app

**Computer**: hover trailer previews, keyboard shortcuts.

**Phone**:
- Bottom nav (Home · Sports · Browse · Search · Me) with Browse and Me as bottom sheets.
- Swipe down to close title and book pages, plus a sticky Play bar.
- Server, audio and subtitle pickers as bottom sheets.
- Pull to refresh and haptics.
- An Install button at the top right of the header: Add to Home Screen, or download the Android / iPhone app.

**Apple TV**:
- Top Shelf (Continue Watching / Top Picks) and `binge://` deep links.
- Spotlight trailers on TV.
- Episode heatmap on TV.
- Followed teams with in-app alerts.
- A live game in a corner window, and ◀ ▶ to change game.
- Multiview engine setting (all games in one page).
- Low-memory mode for the Apple TV HD.
- QR handoff to a phone (fallback).

**Fire TV**:
- Home snapshot (opens straight onto the last Home).
- "Lighter effects" (no focus zoom; on by default below 2.5 GB RAM).
- Multiview playback: Smooth / All games.
- Extra backup servers in the picker (VidLink, Videasy, VidSrc).
- Quit binge. (with a confirmation), and Back twice to leave a video.

## Known mismatches

None right now.

## Biggest gaps, by app

- **TV apps vs website**:
  - Where to watch, search filters, detailed ratings.
  - Creating and editing profiles, and account tools.
  - Fire TV still lacks the spotlight's logo art, Now Playing, swipe to scrub, steady quality, picture in picture for movies and subtitles while skipping back.
- **Website vs TV apps**:
  - OpenSubtitles subtitles and subtitle styling; quality choice.
  - Sleep timer and "Still watching?".
  - Ambient mode; Larger text and audio description.
- **Fire TV vs Apple TV**: episode heatmap, spotlight trailers, followed teams and alerts, ◀ ▶ live game flip, Top Shelf-style launcher rows.
- **Phone vs computer**: Multiview (*by decision*), spotlight and hover trailers.
