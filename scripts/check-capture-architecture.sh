#!/usr/bin/env bash
set -euo pipefail

manifests=(manifest.json public/manifest.json)
capture_sources=(src/background src/core/capture src/devtools)

if grep -q '"debugger"' "${manifests[@]}"; then
  echo 'The default manifest must not request debugger permission.' >&2
  exit 1
fi

if grep -R -nE 'chrome\.debugger|Network\.enable|Network\.requestWillBeSent|Network\.responseReceived|Network\.loadingFinished|Network\.getResponseBody' "${capture_sources[@]}"; then
  echo 'Legacy debugging capture APIs are not allowed in the default capture path.' >&2
  exit 1
fi

adapter=src/core/capture/devtools-network.ts
for api in getHAR onRequestFinished getContent; do
  if ! grep -q "$api" "$adapter"; then
    echo "Missing DevTools Network capture API: $api" >&2
    exit 1
  fi
done

for manifest in "${manifests[@]}"; do
  if ! grep -q '"devtools_page": "devtools.html"' "$manifest"; then
    echo "Missing DevTools page in $manifest" >&2
    exit 1
  fi
done

echo 'Capture architecture check passed.'
