#!/bin/zsh
# Boots an Apple TV simulator for CI and prints its UDID: the first available
# Apple TV 4K device, or one created on the newest installed tvOS runtime.
set -e
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
udid=$(xcrun simctl list devices available | grep -m1 "Apple TV 4K" | grep -oE '[0-9A-F-]{36}' || true)
if [[ -z "$udid" ]]; then
  runtime=$(xcrun simctl list runtimes available | grep -oE 'com\.apple\.CoreSimulator\.SimRuntime\.tvOS-[0-9-]+' | sort -V | tail -1)
  [[ -z "$runtime" ]] && { echo "No tvOS simulator runtime installed." >&2; exit 1; }
  type=$(xcrun simctl list devicetypes | grep -m1 "Apple TV 4K" | grep -oE 'com\.apple\.CoreSimulator\.SimDeviceType\.[A-Za-z0-9-]+')
  udid=$(xcrun simctl create "BingeTV CI" "$type" "$runtime")
fi
xcrun simctl boot "$udid" 2>/dev/null || true   # already booted is fine
xcrun simctl bootstatus "$udid" -b >&2
echo "$udid"
