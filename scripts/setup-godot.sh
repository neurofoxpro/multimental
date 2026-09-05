#!/usr/bin/env bash
set -euo pipefail

: "${GODOT_VERSION:=4.7.2}"
: "${GODOT_STATUS:=stable}"
: "${GODOT_BINARY_SHA256:=cadd3204e728a35d3f13adb7fd0d7902636b79f6b95c40c265eb73b6c35329e4}"
: "${GODOT_TEMPLATES_SHA256:=f298490b8d44d934be425a5a65a51bf15f422428b229a06a6e11d9ffea248011}"

VERSION_TAG="${GODOT_VERSION}-${GODOT_STATUS}"
INSTALL_DIR="${GODOT_INSTALL_DIR:-$HOME/.local/share/multimental/godot/${VERSION_TAG}}"
TEMPLATE_DIR="$HOME/.local/share/godot/export_templates/${GODOT_VERSION}.${GODOT_STATUS}"
BASE_URL="https://github.com/godotengine/godot-builds/releases/download/${VERSION_TAG}"
BINARY_ARCHIVE="Godot_v${VERSION_TAG}_linux.x86_64.zip"
TEMPLATE_ARCHIVE="Godot_v${VERSION_TAG}_export_templates.tpz"

mkdir -p "$INSTALL_DIR" "$TEMPLATE_DIR"

if [[ ! -x "$INSTALL_DIR/godot" ]]; then
  curl --fail --location --retry 4 --output /tmp/godot.zip "$BASE_URL/$BINARY_ARCHIVE"
  echo "$GODOT_BINARY_SHA256  /tmp/godot.zip" | sha256sum --check -
  rm -rf /tmp/godot-bin
  mkdir -p /tmp/godot-bin
  unzip -q /tmp/godot.zip -d /tmp/godot-bin
  mv "/tmp/godot-bin/Godot_v${VERSION_TAG}_linux.x86_64" "$INSTALL_DIR/godot"
  chmod +x "$INSTALL_DIR/godot"
fi

if [[ ! -f "$TEMPLATE_DIR/version.txt" ]]; then
  curl --fail --location --retry 4 --output /tmp/templates.tpz "$BASE_URL/$TEMPLATE_ARCHIVE"
  echo "$GODOT_TEMPLATES_SHA256  /tmp/templates.tpz" | sha256sum --check -
  rm -rf /tmp/godot-templates
  mkdir -p /tmp/godot-templates
  unzip -q /tmp/templates.tpz -d /tmp/godot-templates
  cp -a /tmp/godot-templates/templates/. "$TEMPLATE_DIR/"
fi

echo "$INSTALL_DIR" >> "${GITHUB_PATH:-/dev/null}"
"$INSTALL_DIR/godot" --version
