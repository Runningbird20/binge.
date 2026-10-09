# binge. for Apple TV

A native tvOS app (SwiftUI, no dependencies) that uses the same Supabase
project and TMDB lists as the website:

- **Sign in** with a binge. account (an iPhone nearby can fill it in), and pick a profile ("Who's watching?").
- **Home (Netflix-style):** your whole Continue Watching row (click resumes, hold for details/remove), New Episodes, Top Picks for you, My List, and several "Because you watched/liked…" rows woven between Trending, K-Dramas, Hidden Gems, Anime and Top Rated.
- **Movies / Series:** popular, new, top-rated and genre rows.
- **Title pages:** logo art, details, seasons and episodes, More Like This, and add or remove from My List.
- **Sports:** live games play on the TV. The Live now row covers every live event in the feeds, then come ESPN scoreboards (a ▶ marks games with streams) and Coming up, refreshed every 30 seconds.
- **Search:** titles, plus people's best-known work.
- **Kids profiles:** kids rows only, and the same rating filter as the site.
- **Release window:** titles more than 30 days out are hidden, and titles out within 30 days are marked Coming Soon (same as the site).

## Playback

Videos play on the TV. tvOS ships WebKit but leaves it out of the public
SDK, so `Player/WebEngine.swift` reaches **WKWebView** through the
Objective-C runtime. That only works in a sideloaded app; App Review rejects
it. The legacy UIWebView is kept only as a fallback: any video seek crashes
inside it. The server's own player page loads full screen, and the app
drives its `<video>` from the Siri remote:

| Remote | Does |
| --- | --- |
| Click / Play-Pause | Play or pause |
| ◀ / ▶ | Back or forward 10 seconds |
| Swipe down | Servers and episodes panel |
| Back | Exit (progress is saved) |

**Fast start** (`Player/StreamRace.swift`):

- **Race:** all servers load at once, muted, and the first whose video actually plays wins; the others are torn down. Startup varies a lot by server and title (Vidy 1.8s vs VidRift 26s on one movie), so this waits only for the fastest one.
- **Preload:** a background race starts when a title page opens, when you rest on a Continue Watching card, for the first Continue Watching card on Home, and for the next episode in the last 90 seconds. The winner holds on its first frame (or your resume point), so Play is nearly instant. Unused preloads stop after 3 minutes.

| Measured in the simulator | Before | Now |
| --- | --- | --- |
| Cold start (Play with nothing preloaded) | 6–40s, and 45s per dead server | 2.3–3.3s |
| Warm start (preloaded) | — | 0.8s |

**Live sports** (`Data/SportsFeed.swift`): the app fetches the same three feeds as the website directly (PPV, Streamed, StreamFree), merges them into one entry per game by team nicknames (±3h), and matches games to ESPN scoreboards the same way. A game's feeds, with Streamed sources resolved to their HD embeds first and at most 4 per game, are raced exactly like movie servers. Live embeds keep the video in nested cross-origin iframes, so the engine injects a small bridge into **every frame**. It reports the main video to the app and relays play/pause/mute/seek down through `postMessage`. Measured: the live Celtics–Cavaliers game played 3.6s after Play. Skipping is off for live streams.

**Servers:** tvOS has no Media Source Extensions, so only servers that fall back to native HLS work: **VidRift, Vidy and CineSrc** (`Player/Servers.swift`). VidLink, Videasy and the vidsrc servers never produced a playable video. A server you pick by hand plays alone, from where you were. Progress goes to `continue_watching` every 30 seconds and on exit (same row as the website), and Up Next counts down 10 seconds at the end of an episode. Pop-ups are refused, and the top-level page is locked to the server's host. If no web engine is available, Play falls back to the phone QR handoff. Debug `-BingeLive celtics` auto-plays the first live game matching that text.

Use `-BingeProbe <url>` (plus `-BingeProbeSeek <js>`, `-BingeEngine legacy`) in a Debug build to time another server. `-BingePlayAfter N` opens a title page, waits N seconds, then presses Play, which measures the warm start.

## Run it

```bash
tv-apple/scripts/make-secrets.sh          # writes Config/Secrets.xcconfig from ../.env
open tv-apple/BingeTV.xcodeproj           # pick an Apple TV simulator, ⌘R
```

`make-secrets.sh` takes an optional site URL (default `https://binge-26.vercel.app`),
which is used for the QR links. All keys are the public browser keys the
website already ships. Never put the service-role key here.

Command-line build (no `sudo xcode-select` needed):

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodebuild -project tv-apple/BingeTV.xcodeproj -scheme BingeTV \
  -destination 'platform=tvOS Simulator,name=Apple TV 4K (3rd generation)' build
```

Debug builds accept launch arguments for checking screens without a remote
or an account: `-BingeDemo` (browse without signing in), `-BingeTab sports`,
`-BingeOpen tv_show:58132`, `-BingePlay 1:2` (start the player at S1:E2; `0` for a movie),
`-BingeHandoff YES`, and `-BingeProbe <url>`.

## Put it on your Apple TV

1. On the Apple TV, open Settings → Remotes and Devices → Remote App and Devices. The Apple TV and Mac must be on the same network.
2. In Xcode, open Window → Devices and Simulators. Pair the Apple TV with the code it shows.
3. Under the BingeTV target, open Signing & Capabilities. Choose your team (a free Apple ID works), and change the bundle id if Xcode asks (e.g. `com.<you>.binge.tv`).
4. Select the Apple TV as the run destination and press ⌘R.

A free Apple ID signs the app for 7 days; after that, press ⌘R again to
re-install it. A paid developer account ($99/yr) signs it for a year.

New Swift files only need to go inside `BingeTV/`. The project uses a
folder-synced group, so Xcode picks them up without editing the project file.
