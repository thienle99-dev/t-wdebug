# API Lens implementation plan

## Architecture

API Lens is a Manifest V3 extension built with React, TypeScript, Vite, Tailwind CSS, Zustand, IndexedDB, and `chrome.storage.local`. A DevTools-page capture adapter uses `chrome.devtools.network`, normalizes HAR entries into the shared `RequestRecord` model, and writes directly to IndexedDB. The toolbar popup and DevTools panel read the same persisted history.

## Browser capture and permissions

Live capture works only while Chrome DevTools is open. The DevTools page imports current requests with `getHAR()`, subscribes to `onRequestFinished`, retrieves response content with `getContent()`, deduplicates entries, and persists normalized records. The panel may remain unselected. A service-worker heartbeat lets the popup distinguish active capture from saved history; when DevTools is closed, the popup explains that new traffic is not being captured. The manifest requests only `storage` and no debugger or broad host permissions.

## Product milestones

1. Scaffold the MV3 extension and shared request types, preferences, and IndexedDB history.
2. Capture HAR data from the DevTools page, normalize request/response metadata and text bodies, enforce size caps, mark secrets, and retain pinned history during cleanup.
3. Add popup and DevTools history/details over the shared data layer, with quick copy, safe cURL, request/response copy, pin/delete, and clear history.
4. Add cURL, fetch, Axios, Python requests, Postman item JSON, debug bundle, safe Markdown, and manual AI prompt generation. AI context is redacted by default and is never sent automatically.
5. Add request editing/retry and original-versus-retry diffs only after capture/copy/export are stable. Session grouping and dependency detection remain later extensions.

## Acceptance and verification

- `npm install`, `npm run typecheck`, `npm run build`, and `npm test` complete successfully.
- Load `dist/` unpacked in Chrome; verify automatic capture only while DevTools is open, popup and DevTools panel, authenticated request inspection, secret-redacted copies, Postman JSON, and history after DevTools closes.
- Verify initial HAR import, live event capture, duplicate suppression, page reload, empty/malformed JSON, 204 responses, binary responses, and oversized bodies.

## Assumptions and limits

- Capture starts automatically for the inspected tab while DevTools is open; the default body cap is 1 MB and the history cap is 500 records.
- This MVP has manual AI prompt copy only. No traffic is transmitted to an AI service automatically.
- `chrome.devtools.network` is unavailable outside a DevTools extension page. No requests are captured while DevTools is closed; Chrome may omit request bodies or evict response content from HAR.
- Sensitive values remain stored locally for the configured history lifetime. Copy controls redact by default; the user may enable secret inclusion for intentional local copies.
