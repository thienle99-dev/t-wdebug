# API Lens implementation plan

## Architecture

Debug Lens uses a shared `RequestRecord` model and IndexedDB request history. The MV3 manifest grants persistent `http://*/*` and `https://*/*` host access once during installation. Lightweight isolated content bridges load at `document_start`; UI inspection stays idle until explicitly started. Page fetch/XHR instrumentation is still explicitly enabled by the user and injects a MAIN-world agent without asking for another site grant. When DevTools is open, a DevTools-page adapter uses `chrome.devtools.network` (`getHAR`, `onRequestFinished`, and `getContent`) to add Chrome Network metadata. Both sources normalize into the shared model and are deduplicated before popup and panel display.

## Permissions and privacy

The MV3 manifest uses `storage`, `scripting`, `activeTab`, and required HTTP/HTTPS host permissions. `activeTab` is retained only for explicit visible-tab screenshot capture because Chrome requires it or `<all_urls>` for `captureVisibleTab`. `devtools_page` registers the deeper inspector. The default capture architecture does not request or call `chrome.debugger`. Data remains local; AI prompt generation is manual and redacted by default.

## Browser limitations

- Page instrumentation sees JavaScript `fetch` and XHR, but not all browser-generated headers or raw Cookie headers. Calls made from a site's own service worker, other protocols, protected Chrome pages, and some iframe contexts are outside its reliable coverage.
- Hooks are installed after the user enables capture, so earlier traffic is not recovered. Same-origin navigation/reload triggers reinjection at load start/completion, though the earliest requests can be missed.
- DevTools Network capture is available only while DevTools is open. Its HAR data can add wire-level metadata and response content when Chrome retains it.
- Bodies are limited to 1 MB; streaming/SSE and binary data are omitted. Some request/response bodies may be unavailable from browser APIs.

## Product milestones

1. Manifest V3 scaffold, shared model, preferences, and IndexedDB history.
2. DevTools HAR capture, normalization, body limits, secret marking, and dedupe.
3. Toolbar popup and DevTools inspection panel over shared history.
4. cURL, fetch, Axios, Python requests, Postman, safe bundles, and manual AI prompt generation.
5. Current-tab MAIN-world fetch/XHR capture behind an explicit user toggle, normalized into shared history; website access is persistent at install time.
6. MIME-aware response viewer with JSON tree/code/raw modes, search, JSON paths, and bounded rendering.
7. Future: retry, request/response diff, sessions, and dependency detection after capture/copy/export are stable.

## Acceptance and verification

Run `npm install`, `npm run typecheck`, `npm test`, `npm run check:capture-architecture`, and `npm run build`. In Chrome, validate opt-in site capture, fetch/XHR bodies, the DevTools panel, history persistence, no debugger warning, permissions, safe copy, Postman export, reload behavior, and the capture-paused status after DevTools closes.
