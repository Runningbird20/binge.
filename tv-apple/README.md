# binge. for Apple TV

A native tvOS app (SwiftUI, no dependencies) that uses the same Supabase
project and TMDB lists as the website:

- **Sign in** with a binge. account (an iPhone nearby can fill it in), and pick a profile ("Who's watching?").
- **Home:** Continue Watching (with progress), My List, "Because you watched…", Trending, K-Dramas, Hidden Gems, Anime, Top Rated.
- **Movies / Series:** popular, new, top-rated and genre rows.
- **Title pages:** logo art, details, seasons and episodes, More Like This, and add or remove from My List.
- **Sports:** live and upcoming scores (ESPN), refreshed every 30 seconds.
- **Search:** titles, plus people's best-known work.
- **Kids profiles:** kids rows only, and the same rating filter as the site.
- **Release window:** titles more than 30 days out are hidden, and titles out within 30 days are marked Coming Soon (same as the site).

## Playback

tvOS has no web view, so the web players binge. streams through can't run
here. **Play** shows a QR code instead. Scan it with your iPhone, binge. opens
and starts that exact episode (resuming where you left off), and you then
AirPlay or Screen Mirror it to the TV. Progress syncs back through
`continue_watching` like on any other device.

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
`-BingeOpen tv_show:58132`, and `-BingeHandoff YES`.

## Put it on your Apple TV

1. On the Apple TV, open Settings → Remotes and Devices → Remote App and Devices. The Apple TV and Mac must be on the same network.
2. In Xcode, open Window → Devices and Simulators. Pair the Apple TV with the code it shows.
3. Under the BingeTV target, open Signing & Capabilities. Choose your team (a free Apple ID works), and change the bundle id if Xcode asks (e.g. `com.<you>.binge.tv`).
4. Select the Apple TV as the run destination and press ⌘R.

A free Apple ID signs the app for 7 days; after that, press ⌘R again to
re-install it. A paid developer account ($99/yr) signs it for a year.

New Swift files only need to go inside `BingeTV/`. The project uses a
folder-synced group, so Xcode picks them up without editing the project file.
