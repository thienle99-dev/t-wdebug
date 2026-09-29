# API Lens

API Lens is a local-first Chrome extension for capturing and inspecting authenticated API traffic. Start capture for a tab when needed, then review requests in the toolbar popup or the API Lens panel in Chrome DevTools.

## Features

- Opt-in capture of Fetch, XHR, and EventSource requests through the Chrome DevTools Protocol.
- Shared request history for the popup and DevTools panel, stored in local IndexedDB.
- Request and response headers, bodies, timing, failure details, pinning, and deletion.
- Copy and export as cURL, fetch, Axios, Python `requests`, Postman item JSON, debug bundle, Markdown report, or plain request/response text.
- Secret detection and redacted copy output by default, including AI prompt text for manual use.
- Local preferences for capture behavior, history size, and body limits.

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
```

To load the built extension, open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the `dist/` directory. Open the toolbar popup and select **Capture** for the active tab. Use the page, then open Chrome DevTools and select **API Lens** to inspect the shared request history.

## Download a ZIP from GitHub Actions

Every push and pull request runs the build and uploads a versioned ZIP artifact. Open the completed workflow run on GitHub and download the `api-lens-<commit-sha>` artifact. Extract the downloaded ZIP; its root contains `manifest.json`. Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted directory. Chrome's **Load unpacked** flow needs the extracted folder; it does not install the ZIP directly. Artifacts are retained for 30 days.

## Architecture

```text
Chrome DevTools Protocol
          ↓
Background service worker → normalized RequestRecord → IndexedDB
                                                   ↙           ↘
                                           Toolbar popup    DevTools panel
```

The background service worker handles capture and normalization. Shared core modules provide formatters and secret handling. Popup and DevTools views use the shared Zustand store and IndexedDB storage layer.

## Screenshots

- Toolbar popup: _screenshot placeholder_
- DevTools API Lens panel: _screenshot placeholder_

## Permissions and privacy

- `debugger`: attaches to a tab only after capture is started, to observe network events and retrieve available request and response bodies. Chrome displays a debugger permission warning; restricted pages and competing debugger sessions can prevent capture.
- `storage`: stores local preferences and capture session state.
- `devtools_page`: registers the API Lens panel in Chrome DevTools.

Captured traffic can include authentication values and is stored in the browser's local IndexedDB, subject to the configured history limit or user deletion. Nothing is sent to an external server automatically. The AI prompt feature generates redacted text for manual copying; it does not call an AI service. Enable secret inclusion only when you intentionally want sensitive values in a local copy.

## AI prompt workflow

Choose **Ask AI** to copy a structured, redacted prompt into ChatGPT, Claude, Cursor, or another assistant yourself. This MVP has no provider API key or endpoint settings and makes no AI network requests.

## Limitations

- Chrome does not allow debugger attachment on some internal or protected pages, and another debugger can take ownership of a tab.
- Redirect bodies, streaming or binary content, oversized bodies, and response bodies no longer retained by Chrome may be unavailable. Request metadata is kept where possible.
- AI support is limited to manually copying a generated prompt. Request retry, response diffing, session capture, environment export, and advanced filtering are not currently implemented.
