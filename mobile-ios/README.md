# binge. for iPhone and iPad

The binge. website's phone layout in a full-screen `WKWebView` (`BingeMobile/BingeWebView.swift`), plus what Safari can't do for it:

- **Every pop-up and tab redirect from the video servers' players is refused**, as in the TV apps. Only binge.'s own page may open new windows or leave the site, and its links to other sites open in Safari. On the website only VidRift and CineSrc can be sandboxed.
- **Files the site saves open the share sheet** (Save to Files, add to Calendar, AirDrop): Download my data, the calendar's `.ics`, the Wrapped card.
- **Alerts from the players' ads are dropped.** The site's own alerts and confirms show as usual.
- **Video servers see Safari.** The user agent ends like Safari's, so players don't refuse an app's web view.

Not in the app: **web push** (only Safari and Home Screen web apps get it, so alerts only show inside the site). It also has its own sign-in, separate from Safari's.

## Build

```sh
scripts/build-ipa.sh        # → ../dist/mobile/binge.ipa (unsigned)
```

Needs Xcode (`DEVELOPER_DIR` defaults to `/Applications/Xcode.app`).
- **Another site:** `BINGE_SITE_URL=https://… scripts/build-ipa.sh`.
- **The project:** `BingeMobile.xcodeproj` is hand-written with a folder-synced `BingeMobile/` group (like `tv-apple/`), so new files need no project edits.

## Install

An unsigned `.ipa` doesn't install as it is. It has to be signed on its way to the phone:

- **Sideloadly or AltStore, with your Apple ID.** They re-sign `binge.ipa`. A free Apple ID's installs expire after 7 days; a paid Apple Developer account's last a year.
- **Xcode.** Open `BingeMobile.xcodeproj`, choose your team under Signing & Capabilities, plug in the iPhone, and press Run.
