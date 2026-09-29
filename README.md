# API Lens

API Lens is a local-first Chrome extension for capturing and inspecting authenticated API traffic. Chrome DevTools owns live capture; the toolbar popup and API Lens DevTools panel read the same persisted request history.

## Features

- Automatic API traffic capture through `chrome.devtools.network` while Chrome DevTools is open.
- Imports current requests with `getHAR()` and captures completed requests with `onRequestFinished` / `getContent()`.
- Shared request history for the popup and DevTools panel, stored in local IndexedDB.
- Request and response headers, bodies, timing, failure details, pinning, and deletion.
- Copy and export as cURL, fetch, Axios, Python `requests`, Postman item JSON, debug bundle, Markdown report, or plain request/response text.
- Secret detection and redacted copy output by default, including AI prompt text for manual use.
- Local preferences for capture behavior, history size, body limits, appearance, and DevTools request-list width.

No backend or automatic AI transmission is used.

## Requirements

- Node.js 20 or newer
- npm
- Google Chrome 120 or newer

## Development

Install dependencies and build the extension:

```sh
npm install
npm run build
```

Available commands:

```sh
npm run dev        # Start the Vite development server
npm run build      # Type-check and build the extension into dist/
npm test           # Run the Vitest suite
npm run test:watch # Run tests in watch mode
npm run typecheck  # Run TypeScript project checks
npm run check:capture-architecture # Assert DevTools Network is the only default capture path
```

To load the built extension, open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the `dist/` directory. Open the target page and its Chrome DevTools once; API Lens starts capturing automatically from the DevTools page. The API Lens panel does not need to be selected. Use the toolbar popup for quick actions or open the API Lens panel for inspection.

## Download a ZIP from GitHub Actions

Every push and pull request runs the build and uploads a ZIP artifact named `api-lens-v<version>-YYYYMMDD-HHmmss`, for example `api-lens-v0.1.0-20260929-043015`. The timestamp uses UTC and includes year, month, day, hour, minute, and second. Open the completed workflow run on GitHub and download the artifact with that name. Extract the ZIP once; its root contains `manifest.json`. Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted directory. Chrome's **Load unpacked** flow needs the extracted folder; it does not install the ZIP directly. Artifacts are retained for 30 days.

## Architecture

```text
Page traffic → Chrome DevTools → chrome.devtools.network
                                      ↓
                         capture adapter → HAR normalizer
                                      ↓
                         IndexedDB RequestRecord
                              ↙             ↘
                     Toolbar popup     DevTools panel
                              ↑
                 service worker heartbeat
```

The DevTools page owns capture, imports the current HAR, listens for completed requests, reads response content, normalizes records, and writes directly to shared IndexedDB. The background service worker tracks an expiring DevTools heartbeat so the popup can report whether live capture is available. Shared core modules provide formatters and secret handling; the popup and panel use the same request store.

## Screenshots

- Toolbar popup: _screenshot placeholder_
- DevTools API Lens panel: _screenshot placeholder_

## Permissions and privacy

- `storage`: stores local preferences and short-lived DevTools capture heartbeats.
- `devtools_page`: registers the API Lens panel in Chrome DevTools.

Captured traffic can include authentication values and is stored in the browser's local IndexedDB, subject to the configured history limit or user deletion. Nothing is sent to an external server automatically. The AI prompt feature generates redacted text for manual copying; it does not call an AI service. Enable secret inclusion only when you intentionally want sensitive values in a local copy.

The popup and DevTools panel share the saved System/Light/Dark appearance preference. The DevTools panel also remembers its draggable request-list width. The Sensitive menu controls whether detected secret values are included in local copy actions; AI prompts remain redacted.

## AI prompt workflow

Choose **AI prompt (redacted)** in the **Copy as** selector and press **Copy** to copy a structured prompt into ChatGPT, Claude, Cursor, or another assistant yourself. This MVP has no provider API key or endpoint settings and makes no AI network requests.

## Limitations

- Live capture is available only while DevTools is open. Closing DevTools stops new capture; the popup keeps showing saved history and indicates that live capture is unavailable. Reopening DevTools resumes capture automatically.
- Chrome may omit request bodies or evict response content from HAR. Binary and oversized bodies are not fully retained.
- AI support is limited to manually copying a generated prompt. Request retry, response diffing, session capture, environment export, and advanced filtering are not currently implemented.

## Manual capture check

1. Load `dist/` unpacked and open a web app.
2. Open Chrome DevTools and trigger API traffic. Confirm API Lens records requests without a debugger warning; the API Lens panel does not need to be selected.
3. Inspect response bodies and headers, then try copy and Postman export.
4. Close DevTools. Open the toolbar popup and confirm saved history remains while it says **Live capture unavailable**.
5. Reopen DevTools and confirm capture resumes.
