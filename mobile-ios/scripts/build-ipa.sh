#!/bin/sh
# Builds the binge. phone app for iPhone and iPad as dist/mobile/binge.ipa, unsigned.
#
# An unsigned .ipa doesn't install as it is: it gets signed on its way to the phone,
#   - with Sideloadly or AltStore and your Apple ID (a free Apple ID's installs expire
#     after 7 days; a paid developer account's after a year), or
#   - from Xcode: open BingeMobile.xcodeproj, pick your team under Signing &
#     Capabilities, plug in the iPhone and Run.
# BINGE_SITE_URL=https://… builds it for another site.
set -eu
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
OUT="$(cd .. && pwd)/dist/mobile"
rm -rf build/ipa
xcodebuild -quiet -project BingeMobile.xcodeproj -scheme BingeMobile -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath build/device \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  BINGE_SITE_URL="${BINGE_SITE_URL:-https://binge-26.vercel.app}" build
mkdir -p build/ipa/Payload "$OUT"
cp -R build/device/Build/Products/Release-iphoneos/Binge.app build/ipa/Payload/
rm -f "$OUT/binge.ipa"
(cd build/ipa && zip -qry "$OUT/binge.ipa" Payload)
echo "Built $OUT/binge.ipa (unsigned)"
