#!/usr/bin/env bash
# Build the release zip from the committed tree (git archive), so only
# tracked, extension-runtime files ship — no tests, docs or local scratch.
#   usage: scripts/package.sh            -> dist/kotoba-bank-v<manifest version>.zip
set -euo pipefail
cd "$(dirname "$0")/.."

if ! git diff --quiet HEAD -- manifest.json background.js content.js reader.js core data icons lib pages; then
  echo "Uncommitted changes in extension files — commit first (the zip is built from HEAD)." >&2
  exit 1
fi

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/kotoba-bank-v${VERSION}.zip"
mkdir -p dist
rm -f "$OUT"

git archive --format=zip --prefix="kotoba-bank-v${VERSION}/" -o "$OUT" HEAD \
  manifest.json background.js content.js reader.js LICENSE core data icons lib pages

echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
unzip -l "$OUT" | tail -1
