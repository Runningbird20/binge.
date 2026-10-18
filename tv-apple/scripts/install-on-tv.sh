#!/bin/sh
# Builds binge. and installs it on your paired Apple TV in one go.
# Needs: Xcode signed in (scripts/setup-signing.sh done) and the Apple TV
# paired once in Xcode → Window → Devices and Simulators.
set -e
here="$(cd "$(dirname "$0")/.." && pwd)"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

[ -f "$here/Config/Secrets.xcconfig" ] || "$here/scripts/make-secrets.sh"
[ -f "$here/Config/Signing.xcconfig" ] || "$here/scripts/setup-signing.sh"

tv="$(xcrun devicectl list devices 2>/dev/null | awk '!/simulated/ && /Apple TV|AppleTV|tvOS/ && /available|connected|paired/ {for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-/) {print $i; exit}}')"
if [ -z "$tv" ]; then
  echo "No paired Apple TV found."
  echo "On the TV: Settings → Remotes and Devices → Remote App and Devices."
  echo "On the Mac: Xcode → Window → Devices and Simulators → pick the Apple TV → Pair, type the code."
  exit 1
fi

echo "Building for Apple TV $tv…"
xcodebuild -project "$here/BingeTV.xcodeproj" -scheme BingeTV -configuration Release \
  -destination "id=$tv" -derivedDataPath "$here/build/device" -allowProvisioningUpdates build | grep -E "error:|BUILD (SUCCEEDED|FAILED)" || true

app="$here/build/device/Build/Products/Release-appletvos/BingeTV.app"
[ -d "$app" ] || { echo "Build failed (see errors above)."; exit 1; }
echo "Installing…"
xcrun devicectl device install app --device "$tv" "$app"
echo "Done. binge. is on your Apple TV."
