# Platform differences

What each binge. app has that the others don't. Features that work the same everywhere (sign in, profiles and PIN locks, maturity levels, Continue Watching, My List, Top Picks, Sent to you, Ask binge., outside ratings, Previously on, More Like This, Up Next, server failover, Wrapped, History, Sports schedules) aren't listed.

**The four apps**
- **Computer**: the website on a desktop, laptop or tablet (`src/`).
- **Phone**: the same website on a phone. A phone is a screen whose short side is 768 px or less (`useDeviceType`). The phone layout adds the bottom nav, bottom sheets and swipe gestures. The site can also be installed as a PWA.
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
| Cast & crew photo row | ✓ | ✓ | ◐ | ◐ | The TV apps show a text "Starring …" line only, no photos. |
| Actor / director pages (`/person/:id`) | ✓ | ✓ | — | — | `pages/Person.js`, `utils/people.js`. |
| Episode heatmap | ✓ | ✓ | ✓ | — | Fire TV has no `EpisodeHeatmap`. |
| Franchise "Mark all watched" | ✓ | ✓ | — | — | `FranchiseOrder.js`. Story / release order itself is on every app. |
| Mark season watched / Watched up to here | ✓ | ✓ | — | — | TV apps only mark an episode watched automatically, at 90% played. |
| Detailed rating (per category) | ✓ | ✓ | ◐ | ◐ | TV apps: 1–5 stars, copied into every category. |
| Remind me (release reminders) | ✓ | ✓ | — | — | `RemindButton`; delivered in the app and by push. |

## Home & browsing

| Feature | Computer | Phone | Apple TV | Fire TV | Notes |
|---|:-:|:-:|:-:|:-:|---|
| Spotlight with logo art | ✓ | ✓ | — | — | TV spotlights show the title as text. |
| Spotlight trailers | ✓ | — | ✓ | — | The website plays them only with a mouse or trackpad (`canAutoplayPreviews`). |
| Trailer previews when hovering a card | ✓ | — | — | — | `HoverPreview.js`, needs a mouse or trackpad. |
| "Surprise me with a movie / a series" | ✓ | ✓ | — | — | Home, above Continue Watching (`utils/surprise.js`). |
| Watched titles left out of every recommendation | ✓ | ✓ | ◐ | ◐ | `utils/watchedTitles.js`. The TV apps leave them out of Top Picks and Because you watched only; their Trending, genre and seasonal rows still show them. |
| Finished shows leave Continue Watching | ✓ | ✓ | — | — | Newest episode marked watched and nothing saved partway (`Home.js`). The TV apps keep them. |
| Home opens instantly from the last visit | ◐ | ◐ | — | ✓ | Fire TV saves Home to disk for 7 days (`HomeSnapshot`). The website keeps it only for the open tab (`sessionCache`). |
| Pull to refresh | — | ✓ | — | — | Touch only. |
| Keyboard shortcuts (`/`, `?`, arrow keys) | ✓ | — | n/a | n/a | `KeyboardShortcuts.js`; also drives the website's TV mode. |

## Search

| Feature | Computer | Phone | Apple TV | Fire TV | Notes |
|---|:-:|:-:|:-:|:-:|---|
| Type / decade / language filter chips | ✓ | ✓ | — | — | Results page only (`utils/searchFilters.js`). |
| People in search (with a link to their page) | ✓ | ✓ | ◐ | ◐ | TV apps mix an actor's best-known titles into the results; there's no person result. |
| Recent searches | ✓ | ✓ | — | — | TV apps show "Trending searches" instead. |
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
| Subtitles from OpenSubtitles (timing nudge, other versions) | — | — | ✓ | ✓ | `/api/extras/subtitles`. |
| Subtitle size & background | — | — | ✓ | ✓ | |
| Skip intro | ◐ | ◐ | ✓ | ✓ | The website can only jump on some servers (VidRift, or ones that can start at a given second). |
| Best quality / Fastest start, resolution badge | — | — | ✓ | ✓ | Apple TV also learns each server's real resolution (`QualityMemory`). |
| Sleep timer, "Still watching?" | — | — | ✓ | ✓ | On the website's TODO. |
| Audio description first, Larger text | — | — | ✓ | ✓ | |
| Ambient mode (slideshow when idle) | — | — | ✓ | ✓ | Fire TV has an on/off switch; on Apple TV it's always on. |
| Mini player | ✓ | ✓ | ◐ | — | Computer: a draggable corner window. Phone: a dock. Apple TV: only a live game in the corner. |
| Fullscreen with landscape lock | ✓ | ◐ | n/a | n/a | Landscape lock works only on Android; iPhones get a "turn your phone" hint. |
| Picture: fill the screen / server's layout | — | — | ✓ | ✓ | TV apps can stretch the server's video over the whole screen. |

## Sports

| Feature | Computer | Phone | Apple TV | Fire TV | Notes |
|---|:-:|:-:|:-:|:-:|---|
| Multiview | ✓ | — | ✓ | ✓ | *By decision* not on phones (too small). Apple TV: up to 4 games (2 on an Apple TV HD). Fire TV: up to 4, and it learns the device's limit. |
| Multiview layout (one big + others) | — | — | ✓ | ✓ | The website uses an equal grid. |
| Followed teams & game alerts | ✓ | ✓ | ◐ | — | Website: push alerts. Apple TV: in-app banners only, with a "Your teams" row. |
| Live score panel (second screen, line score) | ✓ | ✓ | ◐ | ◐ | TV apps show score chips and a Scores row. |
| Fantasy roster | ✓ | ✓ | — | — | `FantasyRoster`, ESPN Fantasy. |
| Hide scores | ✓ | ✓ | — | — | |
| Previous / next live game from the player (◀ ▶) | n/a | n/a | ✓ | — | |
| A live game in a corner window over other video | — | — | ✓ | — | `Player/Overlay.swift`. |

## Reading, notifications & the rest

| Feature | Computer | Phone | Apple TV | Fire TV | Notes |
|---|:-:|:-:|:-:|:-:|---|
| Books & manga (reader, Where to read) | ✓ | ✓ | — | — | |
| Push notifications (new episodes, reminders, admin broadcasts) | ✓ | ✓ | — | — | iPhones need the site installed to the Home Screen. |
| Announcements banner | ✓ | ✓ | — | — | |
| Error reporting to the admin panel | ✓ | ✓ | — | — | |
| Offline banner, app shortcuts, share to binge. | ✓ | ✓ | — | — | PWA features. Sharing links to binge. is mostly used on phones. |

---

## Only on one app

**Computer**: hover trailer previews, keyboard shortcuts, the draggable mini player.

**Phone**:
- Bottom nav (Home · Sports · Browse · Search · Me) with Browse and Me as bottom sheets.
- Swipe down to close title and book pages, plus a sticky Play bar.
- Server, audio and subtitle pickers as bottom sheets.
- The player dock, pull to refresh, and haptics.

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

- **Apple TV Settings** says playback settings are "saved to your profile, so the website uses them too". Only audio and subtitle language are; everything else stays on that Apple TV.
- **Apple TV ambient mode** has no on/off switch (`binge.ambient` is read but never written).
- **Fire TV leftover code**: `PlaybackPrefs.trailers`, `AppModel.deepLink` and `QrCode` exist but nothing uses them.
- **Fire TV sign-in screen** still mentions books, which the TV apps don't have.
- **Website search** doesn't apply maturity levels, so a Kids profile can find R-rated titles by searching. The browse rows and title matches elsewhere do apply them.

## Biggest gaps, by app

- **TV apps vs website**:
  - Where to watch, cast & crew photos with person pages, and logo art in the spotlight.
  - Mark season watched, and hiding finished shows from Continue Watching.
  - Search filters and recent searches; Surprise me; detailed ratings.
  - Creating and editing profiles, and account tools.
- **Website vs TV apps**:
  - OpenSubtitles subtitles and subtitle styling; quality choice.
  - Sleep timer and "Still watching?".
  - Ambient mode; Larger text and audio description.
- **Fire TV vs Apple TV**: episode heatmap, spotlight trailers, followed teams and alerts, ◀ ▶ live game flip, Top Shelf-style launcher rows.
- **Phone vs computer**: Multiview (*by decision*), spotlight and hover trailers.
