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

for manifest in "${manifests[@]}"; do
  if ! grep -q '"host_permissions": \["http://\*/\*", "https://\*/\*"\]' "$manifest"; then
    echo "Missing persistent HTTP/HTTPS host access in $manifest." >&2
    exit 1
  fi
  if grep -q '"optional_host_permissions"' "$manifest"; then
    echo "Per-site optional host access must not be used by the default architecture in $manifest." >&2
    exit 1
  fi
  if ! grep -q '"run_at": "document_start"' "$manifest" || ! grep -q '"all_frames": true' "$manifest"; then
    echo "Content bridges must be declared for document_start and all frames in $manifest." >&2
    exit 1
  fi
done

if grep -R -nE 'chrome\.permissions\.(request|contains)' src; then
  echo 'Runtime permission prompts and per-origin permission checks are not allowed.' >&2
  exit 1
fi
if ! grep -q '"scripting"' manifest.json || ! grep -q '"activeTab"' manifest.json; then
  echo 'Page-hook injection and explicit screenshot capture require scripting and activeTab.' >&2
  exit 1
fi

if grep -R -nE 'chrome\.debugger|Network\.enable|Network\.getResponseBody' src; then
  echo 'The extension must not use debugger/CDP capture APIs.' >&2
  exit 1
fi

for source in src/content/main-world.ts src/content/hook-bridge.ts; do
  if ! grep -q 'API_LENS_HOOK.*HELLO\|API_LENS_BRIDGE.*READY' "$source"; then
    echo "Missing page-hook bridge handshake in $source." >&2
    exit 1
  fi
done

echo 'Capture architecture check passed.'
