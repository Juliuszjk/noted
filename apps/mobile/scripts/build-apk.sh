#!/usr/bin/env bash
# Builds the signed release APK (arm64) and installs it on a phone connected with USB / Wi-Fi
# debugging, if there is one. Usage: apps/mobile/scripts/build-apk.sh [--no-install]
# The signing key is in ~/.config/noted-android (see plugins/with-release-signing.js).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
# Android's build tools want Java 17-21 (Java 24+ breaks the native CMake step); a JDK 21 from
# mise (`mise install java@temurin-21`) is used when there is one.
jdk21="$(ls -d "$HOME"/.local/share/mise/installs/java/temurin-21* 2>/dev/null | tail -1 || true)"
if [[ -n "$jdk21" ]]; then export JAVA_HOME="$jdk21"; export PATH="$JAVA_HOME/bin:$PATH"; fi
cd "$here/android"
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain \
  -Dorg.gradle.jvmargs="-Xmx3072m -XX:MaxMetaspaceSize=768m"
apk="$here/android/app/build/outputs/apk/release/app-release.apk"
echo "APK: $apk"
if [[ "${1:-}" != "--no-install" ]] && adb get-state >/dev/null 2>&1; then
  adb install -r "$apk"
fi
