# binge. for Fire TV / Android TV

A native Android TV app (Kotlin + Compose for TV), a port of the Apple TV
app in `tv-apple/`: the same Supabase account, profiles, rows, lists and
progress as the website, with its own TV interface and its own player.

## What's in it

- **Home / Movies / Series**: spotlight + rows from live TMDB lists matched to
  the catalog, Continue Watching (hold OK for details / remove), Top Picks,
  "Because you watched…", New Episodes, Sent to you, My List.
- **Title pages**: resume, My List, 1–5★ rating, send to another profile,
  seasons + episodes, Previously on…, franchise order, More Like This.
- **Player** (`player/`): every server's page loads in a hidden WebView with a
  script in every frame (`Bridge.kt`, the Apple TV bridge). Several servers race
  at once and the first to play wins (`StreamRace.kt`); the video is pinned full
  screen and the server's own buttons/ads are hidden; frames that aren't the
  video are unloaded once it plays. Pop-up windows never open and the page can't
  navigate away (ad redirects). Players that wait for a click on their own Play
  button get it pressed for you. Subtitles come from OpenSubtitles (through the
  site) and are drawn by the app; audio tracks, server subtitles, fill/server
  layout, quality, sleep timer and episodes are on ▼. Skip intro (▲ skip,
  ▼ hide), Up Next, wrong-video check, stall recovery, progress sync.
- **Sports**: the website's feeds (PPV, Streamed, StreamFree) merged per game,
  ESPN scores, category chips, Multiview (equal tiles or one big + others,
  Settings → Playback). The feeds that work on this TV are remembered and tried
  first.
- **Search** (OK opens the keyboard; the remote's microphone works there) with
  Ask binge., **Me**: History, Calendar, Wrapped tickets, Playback &
  accessibility settings, profile switch. Ambient mode after 4 idle minutes.

## Build

The build reads the public keys from the repo's `.env`
(`REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_PUBLISHABLE_KEY`,
`REACT_APP_TMDB_API_KEY`); the site URL defaults to https://binge-26.vercel.app
(`-Pbinge.url=…` to change it).

```bash
gradle -p tv-android assembleRelease   # app/build/outputs/apk/release/app-release.apk
```

Release builds are signed with this machine's Android debug key, so each new
APK installs over the previous one. An APK from another machine (or CI) can't —
uninstall the app first in that case.

Debug builds take launch extras for testing, e.g.
`adb shell am start -n com.binge.tv/.MainActivity --ez demo true --es tab sports`
(`demo`, `tab`, `open kind:id`, `play s:e`, `server`, `live team`, `multi "a,b"`,
`embed <url>`), and allow Chrome DevTools on the player's pages.

## Install on a Fire TV

1. Settings → My Fire TV → About → click the device name 7 times, then
   My Fire TV → Developer options → **ADB debugging** on.
2. Settings → My Fire TV → About → Network: note the IP address.
3. From the Mac (same Wi-Fi): `adb connect <ip>:5555`, accept the prompt on
   the TV, then `adb install -r binge-firetv.apk`.

## Notes

- The Android emulator gets flagged as a bot by some sports pages (PPV shows
  "Remove sandbox attributes"), so sports feeds should be checked on a real
  Fire TV. StreamFree played in the emulator.
- Servers: VidRift, Vidy and CineSrc race first (the Apple TV's set); VidLink,
  Videasy and VidSrc are backups, tried when those fail. In the Android 12
  emulator (WebView = Chrome 91) only VidRift and Vidy played, so check the
  others on a real Fire TV, whose WebView is much newer.
