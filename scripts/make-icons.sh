#!/usr/bin/env bash
# Rigenera le icone PNG a partire dagli SVG in build/.
# Richiede rsvg-convert (pacchetto librsvg).
set -euo pipefail
cd "$(dirname "$0")/.."

command -v rsvg-convert >/dev/null || { echo "rsvg-convert non trovato (installa librsvg)"; exit 1; }

mkdir -p build/icons assets
for size in 16 24 32 48 64 128 256 512 1024; do
  rsvg-convert -w "$size" -h "$size" build/icon.svg -o "build/icons/${size}x${size}.png"
done
cp build/icons/512x512.png build/icon.png
rsvg-convert -w 512 -h 512 build/icon.svg        -o assets/icon.png
rsvg-convert -w 32  -h 32  build/tray.svg        -o assets/tray.png
rsvg-convert -w 32  -h 32  build/tray-unread.svg -o assets/tray-unread.png
echo "Icone rigenerate."
