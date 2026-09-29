#!/usr/bin/env bash
set -euo pipefail

manifests=(manifest.json public/manifest.json)
capture_sources=(src)

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

if ! grep -q '"scripting"' manifest.json || ! grep -q '"activeTab"' manifest.json || ! grep -q '"optional_host_permissions"' manifest.json; then
  echo 'Page-hook capture must use scripting, activeTab, and optional site access.' >&2
  exit 1
fi

if grep -R -nE 'chrome\.debugger|Network\.enable|Network\.getResponseBody' src; then
  echo 'The extension must not use debugger/CDP capture APIs.' >&2
  exit 1
fi

echo 'Capture architecture check passed.'
