# API Lens implementation plan

## Architecture

API Lens is a Manifest V3 extension built with React, TypeScript, Vite, Tailwind CSS, Zustand, IndexedDB, and `chrome.storage.local`. A shared `RequestRecord` model and shared capture, secret-handling, storage, formatter, and export modules serve both the toolbar popup and the DevTools panel. The background service worker owns capture; both UIs read the same IndexedDB history.

## Browser capture and permissions

Capture uses Chrome DevTools Protocol through `chrome.debugger`, attached only after the user presses **Capture** for the active tab. The manifest requests `debugger`, `storage`, and `tabs`; `devtools_page` registers the API Lens panel. Capture targets Fetch/XHR/EventSource traffic by default and stores data only in local IndexedDB. Chrome’s debugger warning and attach failures are surfaced to the user. Redirect bodies, streams, binary responses, detached sessions, and unavailable CDP bodies are represented with metadata and a clear unavailable/truncated marker.

## Product milestones

1. Scaffold the MV3 extension and shared request types, preferences, and IndexedDB history.
2. Capture and normalize request/response metadata and text bodies, enforce size caps, mark secrets, and retain pinned history during cleanup.
3. Add popup and DevTools history/details over the shared data layer, with quick copy, safe cURL, request/response copy, pin/delete, and clear history.
4. Add cURL, fetch, Axios, Python requests, Postman item JSON, debug bundle, safe Markdown, and manual AI prompt generation. AI context is redacted by default and is never sent automatically.
5. Add request editing/retry and original-versus-retry diffs only after capture/copy/export are stable. Session grouping and dependency detection remain later extensions.

## Acceptance and verification

- `npm install`, `npm run build`, and `npm test` complete successfully.
- Load `dist/` unpacked in Chrome; verify opt-in capture, popup and DevTools panel, authenticated request inspection, secret-redacted copies, Postman JSON, and history after reload.
- Verify denied debugger attachment produces a useful error, and that empty, malformed JSON, redirects, failed requests, binary responses, and oversized bodies do not crash the UI.

## Assumptions and limits

- Capture is explicit per tab; the default body cap is 1 MB and the history cap is 500 records.
- This MVP has manual AI prompt copy only. No traffic is transmitted to an AI service automatically.
- The debugger permission is needed for the selected capture fidelity and may be unavailable on restricted Chrome pages or while another debugger session owns the tab. CDP may not retain response bodies for every request.
- Sensitive values remain stored locally for the configured history lifetime. Copy controls redact by default; the user may enable secret inclusion for intentional local copies.
