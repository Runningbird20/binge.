#!/bin/zsh
# Multiview check: two (or more) live games on the Apple TV simulator under
# Apple TV limits (apple-tv-constraints.sh), with each tile's state logged
# every 2s by the Debug build ("[mvstat]") and summed up at the end:
# share of real time each game's clock advanced, stalls, buffering holds,
# sound on the wrong game, dropped frames, restarts, games paused by
# Multiview.
#
#   scripts/multiview-check.sh "ravens,vikings" [seconds=300] [budget-MB=1800] [launch args…]
#   … -BingeMultiSwap 45       move focus (and sound) to the next game every 45s
#   … -BingeMultiExpand 120    focused game full screen at 120s, back to the grid 30s later
#
# Games are matched by a word of their title among the games live right now.
# The app is reinstalled first (a clean Multiview limit). BINGE_SIM=<udid>
# picks the simulator (default: the first booted Apple TV).
cd "$(dirname "$0")/.."
GAMES=$1; SECS=${2:-300}; BUDGET=${3:-1800}; shift 3 2>/dev/null
[[ -z $GAMES ]] && { echo "usage: $0 \"team1,team2\" [seconds] [budget-MB] [launch args…]"; exit 1; }
SIM=${BINGE_SIM:-$(xcrun simctl list devices booted | grep -i "apple tv" | grep -oE '[0-9A-F-]{36}' | head -1)}
[[ -z $SIM ]] && { echo "Boot an Apple TV simulator first."; exit 1; }
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
LOG=build/multiview-check.log

xcodebuild build -project BingeTV.xcodeproj -scheme BingeTV -configuration Debug -destination "id=$SIM" \
  -derivedDataPath build/multiview -quiet 2>&1 | grep -E "\.swift:[0-9]+:[0-9]+: error" && exit 1
APP=$(ls -d build/multiview/Build/Products/Debug-appletvsimulator/*.app | head -1)
ID=$(/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "$APP/Info.plist")
xcrun simctl uninstall $SIM $ID 2>/dev/null
xcrun simctl install $SIM "$APP"

scripts/apple-tv-constraints.sh start $BUDGET
( xcrun simctl launch --console-pty --terminate-running-process $SIM $ID -BingeDemo -BingeTab sports \
    -BingeMulti "$GAMES" "$@" > $LOG 2>&1 & )
sleep $SECS
xcrun simctl io $SIM screenshot build/multiview-check.png >/dev/null 2>&1
scripts/apple-tv-constraints.sh stop
xcrun simctl terminate $SIM $ID 2>/dev/null

python3 - "$LOG" <<'EOF'
import re, sys, collections
rows = collections.defaultdict(list)
pattern = re.compile(r'\[mvstat\] (\d+)s focused=(\w+) (.+?) \| (.+?) started=(\w+) t=([\d.]+) paused=(\w+) cushion=(\w+) ahead=([\d.]+) '
                     r'muted=(\w+) audible=(\w+) h=(\d+) drop=(\d+)% frozen=(\d+) held=(\w+) throttled=(\w+) restarts=(\d+)')
for line in open(sys.argv[1], errors='ignore'):
    m = pattern.search(line)
    if m: rows[m.group(3)].append(m.groups())
if not rows: print('No [mvstat] lines: did Multiview open? (are both games live?)'); sys.exit(1)
for game, r in rows.items():
    played = [x for x in r if x[4] == 'true']
    if not played: print(f'{game}: never started ({r[-1][3]})'); continue
    stalls, holds, wrong_audio, max_drop, max_frozen = [], 0, 0, 0, 0
    for a, b in zip(played, played[1:]):
        if 'true' in (a[14], b[14]): continue  # paused on purpose: the other game is full screen
        dt, dv = int(b[0]) - int(a[0]), float(b[5]) - float(a[5])
        if dt > 0 and b[6] == 'false' and dv < dt * 0.6: stalls.append(f'{b[0]}s')
    for x in played:
        if x[14] == 'true': continue
        holds += x[7] == 'true'
        wrong_audio += (x[10] == 'true') == (x[9] == 'true')  # the focused game has sound, the others don't
        max_drop, max_frozen = max(max_drop, int(x[12])), max(max_frozen, int(x[13]))
    span = int(played[-1][0]) - int(played[0][0])
    advanced = float(played[-1][5]) - float(played[0][5])
    print(f'{game}: {played[-1][3]}, {played[-1][11]}p, {span}s watched, clock {advanced / max(span, 1) * 100:.0f}% of real time, '
          f'stalls {stalls or "none"}, buffering-hold samples {holds}, wrong-sound samples {wrong_audio}, '
          f'max dropped {max_drop}%, max frozen {max_frozen}s, restarts {played[-1][16]}, paused by Multiview: {played[-1][15]}')
print('A stall at the same second in every game is the 2s sampling, not playback.')
EOF
