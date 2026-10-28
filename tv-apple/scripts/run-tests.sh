#!/bin/zsh
# Runs the Apple TV test suites in the simulator.
#   scripts/run-tests.sh                 unit tests (no network)
#   scripts/run-tests.sh live            + live checks against TMDB, Supabase, the site and every server
#                                        (report: build/live-report.jsonl; BINGE_EMAIL/BINGE_PASSWORD add the
#                                        signed-in round trip; BINGE_LIVE_SUBS=all checks every subtitle language)
#   scripts/run-tests.sh ui              UI tests (navigation and screenshots, saved to build/screenshots)
# BINGE_SIM=<udid> picks the simulator (default: the first booted Apple TV).
set -e
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
SIM=${BINGE_SIM:-$(xcrun simctl list devices booted | grep -m1 "Apple TV" | grep -oE '[0-9A-F-]{36}')}
[[ -z "$SIM" ]] && { echo "Boot an Apple TV simulator first (or set BINGE_SIM)."; exit 1; }
ONLY=(-only-testing:BingeTVTests)
case "$1" in
  live)
    export TEST_RUNNER_BINGE_LIVE=1
    export TEST_RUNNER_BINGE_REPORT="$PWD/build/live-report.jsonl"
    [[ -n "$BINGE_LIVE_SUBS" ]] && export TEST_RUNNER_BINGE_LIVE_SUBS=$BINGE_LIVE_SUBS
    [[ -n "$BINGE_EMAIL" ]] && export TEST_RUNNER_BINGE_EMAIL=$BINGE_EMAIL TEST_RUNNER_BINGE_PASSWORD=$BINGE_PASSWORD
    ;;
  ui)
    ONLY=(-only-testing:BingeTVUITests)
    export TEST_RUNNER_BINGE_SHOTS=${BINGE_SHOTS:-$PWD/build/screenshots}
    ;;
esac
[[ -n "$BINGE_FILTER" ]] && ONLY=(-only-testing:"$BINGE_FILTER")
mkdir -p build
xcodebuild test -project BingeTV.xcodeproj -scheme BingeTV -destination "id=$SIM" -derivedDataPath "build/tests-$SIM" \
  -collect-test-diagnostics never -resultBundlePath "build/results-$(date +%s).xcresult" "${ONLY[@]}" 2>&1 | tee build/test.log \
  | grep -E "^(✘|✔ Test run|✘ Test run)|error:|\[live\]|\[matrix\]|\*\* TEST" || true
