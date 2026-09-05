#!/usr/bin/env bash
set -euo pipefail

SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "$SDK_ROOT" ]]; then
  echo "ANDROID_SDK_ROOT or ANDROID_HOME is required" >&2
  exit 1
fi

if [[ -z "${JAVA_HOME:-}" ]]; then
  echo "JAVA_HOME is required" >&2
  exit 1
fi

mkdir -p "$HOME/.config/godot" "$HOME/.android"

if [[ ! -f "$HOME/.android/debug.keystore" ]]; then
  keytool -genkeypair \
    -keystore "$HOME/.android/debug.keystore" \
    -storepass android \
    -alias androiddebugkey \
    -keypass android \
    -dname "CN=Android Debug,O=Android,C=US" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -noprompt
fi

cat > "$HOME/.config/godot/editor_settings-4.7.tres" <<EOF
[gd_resource type="EditorSettings" format=3]

[resource]
export/android/android_sdk_path = "$SDK_ROOT"
export/android/java_sdk_path = "$JAVA_HOME"
EOF

test -x "$SDK_ROOT/platform-tools/adb"
test -f "$HOME/.android/debug.keystore"
echo "Godot Android export configured for $SDK_ROOT"
