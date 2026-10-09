#!/bin/sh
# Builds an unsigned binge-tv.ipa for sideloading (Sideloadly etc. sign it
# with your Apple ID when installing). Output: tv-apple/binge-tv.ipa and a
# copy on your Desktop.
set -e
here="$(cd "$(dirname "$0")/.." && pwd)"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
[ -f "$here/Config/Secrets.xcconfig" ] || "$here/scripts/make-secrets.sh"

rm -rf "$here/build/ipa"
xcodebuild -project "$here/BingeTV.xcodeproj" -scheme BingeTV -configuration Release \
  -destination 'generic/platform=tvOS' -derivedDataPath "$here/build/ipa" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" build | grep -E "error:|BUILD (SUCCEEDED|FAILED)" || true

app="$here/build/ipa/Build/Products/Release-appletvos/BingeTV.app"
[ -d "$app" ] || { echo "Build failed (see errors above)."; exit 1; }
mkdir -p "$here/build/ipa/Payload"
cp -R "$app" "$here/build/ipa/Payload/"
rm -f "$here/binge-tv.ipa"
(cd "$here/build/ipa" && zip -qry "$here/binge-tv.ipa" Payload)
cp "$here/binge-tv.ipa" "$HOME/Desktop/binge-tv.ipa"
echo "Done: $HOME/Desktop/binge-tv.ipa"
