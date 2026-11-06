#!/bin/sh
# Builds the binge. phone app for Android as dist/mobile/binge.apk, signed with this
# machine's debug key (like the Fire TV APK), so a new build installs over the old one.
# Needs JDK 17+, the Android SDK (ANDROID_HOME, or sdk.dir in local.properties) and
# Gradle 9.8+ on the PATH. BINGE_URL=https://… builds it for another site.
set -eu
cd "$(dirname "$0")/.."
OUT="$(cd .. && pwd)/dist/mobile"
gradle --no-daemon -q assembleRelease
mkdir -p "$OUT"
cp app/build/outputs/apk/release/app-release.apk "$OUT/binge.apk"
echo "Built $OUT/binge.apk"
