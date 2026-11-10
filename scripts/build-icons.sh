#!/usr/bin/env bash
# Rebuilds every raster app icon from the SVG masters:
#   apps/desktop/src-tauri/icons/icon.svg        desktop tile, full detail (32 px and up)
#   apps/desktop/src-tauri/icons/icon-small.svg  desktop tile, simplified (16-32 px: no ruled lines)
#   apps/mobile/assets/icon.svg, android-icon-foreground.svg, android-icon-monochrome.svg
#   apps/web/public/favicon.svg is used as is (simplified tile).
# Needs rsvg-convert and ImageMagick (magick). After it, phone icons reach the APK through
# `npx expo prebuild --platform android` (apps/mobile/scripts/build-apk.sh builds from android/).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
icons="$root/apps/desktop/src-tauri/icons"
assets="$root/apps/mobile/assets"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

png() { rsvg-convert -w "$2" -h "$2" "$1" -o "$3"; }

# Desktop: the Tauri set from a 1024 px master, then the small sizes from the simplified drawing.
png "$icons/icon.svg" 1024 "$icons/icon-source-1024.png"
pnpm --dir "$root/apps/desktop" exec tauri icon "$icons/icon-source-1024.png" -o "$tmp/tauri" >/dev/null
for f in "$icons"/*.png "$icons"/icon.icns; do
  name="$(basename "$f")"
  [ "$name" = icon-source-1024.png ] && continue
  cp "$tmp/tauri/$name" "$f"
done
png "$icons/icon-small.svg" 32 "$icons/32x32.png"
for s in 16 24 32; do png "$icons/icon-small.svg" "$s" "$tmp/ico-$s.png"; done
for s in 48 64 256; do png "$icons/icon.svg" "$s" "$tmp/ico-$s.png"; done
magick "$tmp"/ico-{16,24,32,48,64,256}.png "$icons/icon.ico"

# Android / Expo (app.json points at these).
png "$assets/icon.svg" 1024 "$assets/icon.png"
png "$assets/android-icon-foreground.svg" 1024 "$assets/android-icon-foreground.png"
png "$assets/android-icon-monochrome.svg" 1024 "$assets/android-icon-monochrome.png"
magick -size 1024x1024 xc:'#1d1b20' "$assets/android-icon-background.png"
png "$assets/icon.svg" 48 "$assets/favicon.png"

echo "Icons rebuilt."
