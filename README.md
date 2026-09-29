# API Lens

API Lens is a local-first Chrome extension for capturing and debugging HTTP API traffic. Start capture from the toolbar for the current site without opening DevTools, or open DevTools for richer Chrome Network metadata. The popup and DevTools panel use the same normalized request history.

## Features

- Current-tab `fetch` and `XMLHttpRequest` capture through a MAIN-world page hook.
- Optional enhanced capture through `chrome.devtools.network` while DevTools is open, including current HAR entries and response content when Chrome provides it.
- Request/response headers and bodies, status, timing, authentication hints, secret detection, and local IndexedDB history.
- Response body viewer with MIME detection, JSON tree/code/raw modes, formatting, search, wrapping, copy, JSON paths, and bounded rendering.
- Copy and export as cURL, fetch, Axios, Python `requests`, Postman item JSON, debug bundle, Markdown report, or plain request/response text.
- Redacted copy actions and manual AI prompt generation. API Lens does not send data to an AI provider.
- Shared light/dark/system appearance preference for popup and DevTools panel.

## Requirements

- Node.js 20 or newer
- npm
- Google Chrome 120 or newer

## Development and build

```sh
npm install
npm run build
```

Commands:

```sh
npm run dev        # Start the Vite development server
npm run build      # Type-check and build into dist/
npm test           # Run Vitest
npm run typecheck  # Run TypeScript checks
npm run check:capture-architecture # Verify the capture paths and no debugger usage
```

To load locally, open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose `dist/`. Open a normal HTTP/HTTPS page, click API Lens, then choose **Capture this site**. Chrome asks for access to that site before the hook is injected. You can later stop capture from the popup. The hook follows same-origin navigations in that tab while capture is enabled. For deeper inspection, open Chrome DevTools and select the **API Lens** panel; DevTools capture does not require the panel to stay selected.

## Download a ZIP from GitHub Actions

Push and pull-request workflows build a ZIP artifact named `api-lens-v<version>-YYYYMMDD-HHmmss`, for example `api-lens-v0.1.0-20260929-043015`. The timestamp is UTC. Download the artifact from the completed GitHub Actions run, extract it once, then choose the extracted folder in **Load unpacked**. The ZIP root contains `manifest.json`; Chrome does not install this ZIP directly. Artifacts are retained for 30 days.

## Architecture

```text
Page fetch/XHR
   ↓ MAIN-world hook
Isolated content bridge → service worker → normalizer → IndexedDB
                                                  ↙          ↘
                                         Toolbar popup   DevTools panel
Chrome DevTools Network ── getHAR/onRequestFinished ────────↑
```

The page hook is scoped to the current tab and is injected only after the user chooses **Capture this site** and grants optional access to that origin. It observes JavaScript `fetch` and XHR calls, including request and readable response bodies, without consuming the application's response stream. The isolated content bridge forwards bounded capture messages to the service worker, which validates the sender/session and stores normalized `RequestRecord` values in IndexedDB. DevTools capture enriches the same store with Chrome Network metadata and deduplicates matching hook records.

## Permissions and privacy

- `storage`: preferences and short-lived capture-session state.
- `scripting`: inject the isolated bridge and MAIN-world hook into the selected tab after user action.
- `activeTab`: identify the current tab in the user-invoked popup.
- `optional_host_permissions` for HTTP/HTTPS: requested per site only when the user starts capture.
- `devtools_page`: register the API Lens panel; `chrome.devtools.network` is available only in that DevTools extension context.

The extension does not request `debugger` permission and does not use `chrome.debugger`. Captured request data, which may contain secrets, stays in local IndexedDB until retention cleanup or user deletion. It is never uploaded automatically. The AI feature creates a redacted prompt for manual copy; it makes no AI network calls. Sensitive values are masked in the interface and redacted in safe copy output by default; the Sensitive menu lets the user intentionally include them in local copies.

## Capture behavior and limitations

- Page-hook capture does not require F12/DevTools, but it starts only after the user grants access and enables capture for the current tab/site. It does not retroactively capture requests made before the hook starts.
- On navigation/reload the service worker attempts reinjection as the tab starts and completes loading. The hook resumes after a same-origin navigation, but requests that happen before injection completes can be missed.
- The page hook captures JavaScript-visible fetch/XHR traffic. It cannot read browser-managed `Cookie` request headers, and browser-generated headers such as `Origin`, `Referer`, `Sec-Fetch-*`, or `User-Agent` may be absent. `credentials` is retained when exposed. DevTools capture can provide additional network metadata while DevTools is open.
- Calls made internally by a website service worker, traffic from inaccessible/protected Chrome pages, and non-fetch/XHR protocols are not reliably visible to the page hook. Cross-origin iframe coverage is not enabled by default.
- Streaming/SSE and binary bodies are omitted. Request/response bodies are capped at 1 MB; truncated bodies are marked. Browser APIs and page response types can make some bodies unavailable.
- `chrome.devtools.network` capture is active only while DevTools is open. Existing history remains available from the popup after DevTools closes.
- Chrome's optional site-access prompt and protected-page restrictions apply. No broad host permission is enabled by default.
- AI support is manual prompt copy only. Retry, session capture, advanced dependency detection, and environment export are not implemented.

## Screenshots

- Toolbar popup: _screenshot placeholder_
- DevTools API Lens panel: _screenshot placeholder_

## Manual validation

1. Build and load `dist/` unpacked in Chrome.
2. Open a normal web app and choose **Capture this site** in the popup; grant the site permission.
3. Trigger fetch and XHR calls. Verify request/response content appears in the popup without a debugger banner.
4. Inspect JSON and raw response modes; copy cURL and export a Postman request.
5. Reload/navigate within the same origin and verify capture resumes; note that the earliest navigation requests may be missed.
6. Open DevTools and the API Lens panel. Verify Chrome Network metadata enriches history; switch to another DevTools tab while checking that capture persists.
7. Close DevTools. The popup should continue to show saved history and indicate that DevTools capture is unavailable; page-hook capture remains active if enabled.
8. Stop site capture and verify new page-hook requests stop while saved history remains.
