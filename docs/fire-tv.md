# Fire TV / Android TV app

The native Kotlin + Compose for TV app in `tv-android/`: build setup, player, what was measured on a Fire Stick, stability fixes, focus handling and testing. Behaviour shared with Apple TV is in [tv-apps.md](tv-apps.md).

Native Kotlin + Compose for TV (`androidx.tv:tv-material`), a port of the Apple TV app.

## Build and keys

- **Build** (2026-11-04):
  - Android Gradle plugin 9.5 with built-in Kotlin. The app applies no `org.jetbrains.kotlin.android`; the root `apply false` entry only pins Kotlin 2.4.x (keep it equal to the compose/serialization plugins). Compiler flags go in `kotlin { compilerOptions }`.
  - Gradle 9.8.2 (`tv-apk.yml`; no wrapper), Compose BOM 2026.09.00, compileSdk 37.
  - minSdk 23, because Compose 1.12 needs it, so Fire OS 5 sticks are no longer supported.
- **Data and keys.** Supabase goes over OkHttp (`data/Supabase.kt`, session in SharedPreferences). Wrapped tickets use fonts in `res/font`, with the OFL texts in `assets/licenses`. Public keys come from the repo `.env` at build time (`app/build.gradle.kts`; CI reads repo variables). Release APKs are signed with the Mac's debug key so new builds install over old ones.
- **`/api/extras/*` answers in camelCase.** Decode it with `plainJson`, never the snake_case `json`. Ask binge. silently failed on Fire TV until 2026-10-10 because of this.

## Player

- **Player** (`player/`). Each server page loads top-level in a hidden `WebView`. `Bridge.kt` (the Apple TV bridge, injected into every frame with `WebViewCompat.addDocumentStartJavaScript`, reporting through a `BingeBridge` JS interface) drives the `<video>`.
  - **Muting.** Android has no page mute, so the bridge keeps every frame muted until told otherwise, and the app re-sends the wanted state each second.
  - **Fill** hides the rest of the page with `body{visibility:hidden}` + `.__bf-el{visibility:visible}`. It avoids `:has()`, which older WebViews lack.
  - **Ad frames.** `trim` unloads non-video frames 8s into playback.
  - **Pop-ups and navigation.** `setSupportMultipleWindows(true)` + `onCreateWindow` → false, and `window.open` is stubbed. Main-frame navigation is locked to the server's host.
  - **Never crash.** `onRenderProcessGone` returns true.
  - **Click-to-play players.** Players waiting for a click on their own Play button (JW/Clappr/Video.js/Plyr) get it pressed (`startPlayer`).
  - **Headers.** The UA drops `; wv`/`Version/x`, and `X-Requested-With` is turned off where the WebView supports it.
- **Race.** VOD races 3 servers (VidRift, Vidy, CineSrc first; VidLink/Videasy/VidSrc are backups). Live races 3 and gives up after 20s, so recovery tries the next batch. `SportsMemory` (Prefs `sportsFeed.<family>`) ranks the feed families that played on this TV first.

## Measured on a Fire Stick, and stability

- **Fire Stick 4K Max (measured 2026-10-10).**
  - **Decoding.** Its WebView reports 720p/1080p60 decode as not smooth. One 60fps game drops ~17–20% alone, and a second HD game falls to ~2–3 fps, because only one video gets the hardware overlay (the others go through GPU composition).
  - **Screenshots.** `adb screencap` can't capture the overlay, so playing tiles look black in screenshots.
  - **Multiview rules on Fire TV.** A side tile pauses when it's a slideshow (>60% dropped) or frozen, or when the focused game drops >45%. Failed server batches retry the next servers (3×). The learned limit is Prefs `multiviewCapacity`. Settings › Multiview playback is Smooth (default) or All games (no pausing).
- **Stability** (2026-10-10, from the stick's ANR/crash logs).
  - **The ANRs.** 9 of 10 "random crashes" were ANRs in `SportsFeed.merge` on the main thread: a pairwise compare of ~300 listings, recompiling a Regex and re-splitting names each time. The Sports screen also rebuilt ESPN event tokens per card per frame.
  - **The fix.** Now `SportsFeed.load` runs on `Dispatchers.Default`, `SportGame.teamTokens/sides/titleKey` are lazy, Regexes are hoisted and events are indexed once per refresh.
  - **Refresh stalls.** The Sports refresh pauses while a page or the player is on top. It was stalling video every 30s: the picture froze while audio played, then caught up.
  - **The other crash** was Compose's `focusRestorer` pinning bug ("Release should only be called once"), fixed since Compose 1.9.
  - **Measured after:** a live game at a steady 60 fps, 0 dropped frames over 2 minutes.
  - **Keep heavy work off the main thread: a Fire Stick ANRs after 5s.**
- **Low memory.**
  - **Images.** The Coil memory cache is 8%, cleared on `onTrimMemory`.
  - **Lighter effects.** `Performance.light` ("Lighter effects" in Settings; on by default when the device is low-RAM/<2.5 GB) turns off focus zoom and makes ambient mode default off.
  - **Home snapshot.** Home opens on its last snapshot (`HomeSnapshot`, per profile and maturity level, ≤ 7 days, deleted on sign-out).

## Focus

- **Tab bar.** Tabs are a `TabRow` that switches on focus. ▼ from the tab bar is routed by hand (`onPreviewKeyEvent`), because focus search out of the row fails, and the bar restores to the selected tab.
- **Scrolling.** `PivotScroll` (`Theme.kt`) is the `BringIntoViewSpec`. Rows keep focus at the left margin. Pages don't move for items already on screen, and otherwise land them 22% down.
- **Text fields** are read-only until OK; otherwise the keyboard opens on focus and takes the OK press. While typing, Back closes the keyboard, not the page.
- **The Amazon keyboard.** On a real Fire Stick it's a separate window, not reported through IME insets, and it eats the first Back to close itself; Compose's text field then clears focus. So `TvTextField` ends typing on focus loss / Back / any IME action (Fire's keyboard has Next, no Enter) and calls `onDone`. Search uses that to move focus to the first result, retrying while Fire hands focus back.
- **Back.** Back on a non-Home tab bar goes to Home; only Home's bar exits. The generic BackHandler is registered before pages, so a page's own handler wins. Screens that are one focusable `Box` (Wrapped, Multiview, Ambient) must handle Back in `onKeyEvent`, because it never reaches `BackHandler`.
- **Page focus.** A tab page must never request focus while `TabChrome.tabsFocused`, or ▼ would skip its first item. A layout the shell's restore can't enter correctly (Me's two columns enter at Sign out) sets `TabChrome.pageEntry`.
- **Focus traps.** Pages trap focus (`focusGroup` + `exit = Cancel`) so it can't fall onto the hidden tab bar. `FocusMemory`/`rememberFocus()` puts focus back on the card that opened a page.
- **Player options** are a right-hand sidebar (`PlayerPanel`, `Pane`).
- **Me tab.** Me → My List & Ratings is `LibraryScreen`. Quit (last, with a confirmation) leaves the app.

## Testing

- **Testing.** There's an Android TV emulator in the scratchpad (`$S/android`, AVD `firetv`).
  - **Debug launch extras:** `--ez demo true --es tab sports --es open tv_show:58132 --es play 1:1 --es server vidrift --es live <team> --es multi "a,b" --es embed <url>`.
  - **DevTools.** Debug builds enable WebView DevTools (`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`).
  - **Use real hardware for sports and the backup servers.** embed.st flags the emulator as a bot (PPV/Streamed sources show "Remove sandbox attributes"), and its Android 12 WebView is Chrome 91.
