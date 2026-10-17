#!/usr/bin/env bash
# Builds Noted (release) and installs it for this user: the binary in ~/.local/bin/noted, the
# icon in the hicolor theme, and a launcher entry (so app launchers find "Noted").
# Usage: apps/desktop/scripts/install-linux.sh [--no-build]
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "${1:-}" != "--no-build" ]]; then
  (cd "$here" && pnpm tauri build --no-bundle)
fi
bin="$HOME/.local/bin"
apps="$HOME/.local/share/applications"
icons="$HOME/.local/share/icons/hicolor"
mkdir -p "$bin" "$apps"
install -m 755 "$here/src-tauri/target/release/noted" "$bin/noted"
for size in 32 64 128; do
  mkdir -p "$icons/${size}x${size}/apps"
  install -m 644 "$here/src-tauri/icons/${size}x${size}.png" "$icons/${size}x${size}/apps/noted.png"
done
mkdir -p "$icons/256x256/apps" "$icons/512x512/apps"
install -m 644 "$here/src-tauri/icons/128x128@2x.png" "$icons/256x256/apps/noted.png"
install -m 644 "$here/src-tauri/icons/icon.png" "$icons/512x512/apps/noted.png"
cat > "$apps/noted.desktop" <<DESKTOP
[Desktop Entry]
Version=1.0
Type=Application
Name=Noted
GenericName=Notes
Comment=Encrypted notes
Exec=$bin/noted
Icon=noted
Terminal=false
Categories=Office;Utility;TextEditor;
Keywords=notes;notatki;markdown;encrypted;
StartupNotify=true
StartupWMClass=noted
DESKTOP
command -v update-desktop-database >/dev/null && update-desktop-database "$apps" || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$icons" 2>/dev/null || true
echo "Installed: $bin/noted and $apps/noted.desktop"
