# binge. for Android phones

The binge. website's phone layout in a full-screen WebView (`MainActivity.kt`), plus what a browser can't do for it:

- **Every pop-up and tab redirect from the video servers' players is refused**, as in the TV apps. On the website only VidRift and CineSrc can be sandboxed.
- **binge. links open in the app**, from messages, email or the browser: a verified App Link. The site's `public/.well-known/assetlinks.json` lists the SHA-256 of the key the APK is signed with, so a build signed with another key opens them in the browser instead.
- **Links to other sites open in the phone's browser.**
- **Files the site saves go to Downloads:** Download my data, the calendar's `.ics`, the Wrapped card. A calendar file or picture also opens straight away. (`PageScript.kt` reads them, because a WebView can't download `blob:` links itself.)
- **Video servers see plain Chrome.** The WebView drops `; wv` and `X-Requested-With`, as the Fire TV app does, so players don't refuse it.

Not in the app: **web push** (WebViews don't get it, so alerts only show inside the site). It also has its own sign-in, separate from Chrome's.

## Build

```sh
scripts/build-apk.sh        # → ../dist/mobile/binge.apk
```

Needs JDK 17+, the Android SDK (`ANDROID_HOME` or `sdk.dir` in `local.properties`) and Gradle 9.8+. The versions match `tv-android/`.
- **Another site:** `BINGE_URL=https://… scripts/build-apk.sh`.
- **A local dev server:** debug builds may load `http://` (`gradle assembleDebug -Pbinge.url=http://10.0.2.2:3000` from the emulator).
- **Signing:** release builds are signed with this Mac's debug key, so a new APK installs over the old one.

## Install

Download the newest build on the phone from https://github.com/Runningbird20/binge./releases/download/mobile-latest/binge.apk (CI publishes it when a `mobile-v*` tag is pushed, `.github/workflows/mobile-apps.yml`), open it, and allow installing from your browser when Android asks. Or copy a `binge.apk` you built to the phone and open it the same way, or `adb install -r binge.apk`.
