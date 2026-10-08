# binge. for Fire TV / Android TV

A thin Android TV app: the binge. website in a full-screen WebView. The site
turns on **TV mode** when it sees the app (`BingeTV` in the user agent):
bigger 10-foot layout, everything reachable with the d-pad, a clear focus
highlight, the video takes the remote once it loads, and **Back** steps out of
the video → closes the player/sheet → goes back a page → leaves the app.

You can preview TV mode in any browser with `?tv=1` (and `?tv=0` to turn it
off again on that device).

## Build the APK

**Without Android Studio (GitHub Actions):**
1. GitHub repo → Settings → Secrets and variables → Actions → **Variables** →
   add `BINGE_URL` = your site, e.g. `https://your-site.vercel.app`.
2. Actions tab → **Build TV app** → Run workflow.
3. When it finishes, download the `binge-tv-apk` artifact (a zip containing
   `app-debug.apk`).

**With Android Studio:** open the `tv-android/` folder, set `binge.url` in
`gradle.properties`, then Build → Build APK(s).

## Install on a Fire TV (sideload)

The app isn't on the Amazon Appstore (embedded streams can't pass store
review), so it's installed directly:

1. Fire TV → Settings → My Fire TV → Developer options → turn on
   **Apps from Unknown Sources** (or allow it for the Downloader app) and
   **ADB debugging**. If Developer options is hidden: Settings → My Fire TV →
   About → click the device name 7 times.
2. Either:
   - **Downloader app** (free on the Appstore): put the APK somewhere with a
     direct download link (e.g. attach it to a GitHub Release), enter that
     URL in Downloader, install.
   - **adb from your computer** (same Wi-Fi): find the TV's IP in Settings →
     My Fire TV → About → Network, then
     `adb connect <ip>:5555` and `adb install -r app-debug.apk`.
3. It appears under **Your Apps & Channels** with the binge. banner.

Updating: build again and install the new APK over the old one (`-r`).

## Notes

- Remote: d-pad moves, OK selects, Back goes back, and once a video is
  playing the remote controls that player (OK = play/pause on most servers).
- Pop-up/redirect ads from the embedded players are blocked: the app only
  lets the main window navigate within the binge. site.
- Works on Android TV / Google TV devices the same way.
