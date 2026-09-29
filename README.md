# Debug Lens

Debug Lens (formerly API Lens) is a local-first Chrome extension for investigating frontend failures. It brings page UI inspection, fetch/XHR traffic, console signals, performance entries, and nearby changes into one popup and DevTools panel.

## What works today

- **Network:** opt-in MAIN-world `fetch`/XHR capture without DevTools, plus richer `chrome.devtools.network` capture while DevTools is open. Records merge into one IndexedDB history.
- **UI Inspector:** pick an element, inspect a bounded DOM snapshot, computed styles, box model, CSS variables, accessibility heuristics, evidence-backed visibility/clickability/coverage/clipping checks, stacking contexts, scroll ancestors, flex/grid and sticky/fixed diagnostics, plus scoped event/mutation history and snapshot diffs.
- **Component Snapshot:** explicitly capture an element, element with surrounding context, or the visible viewport as PNG; compare before/after pixels, DOM, computed styles, bounds, and accessibility metadata.
- **Console:** records page `console.error`, `console.warn`, uncaught errors, and unhandled rejections while page capture is active.
- **Performance:** captures supported resource, long-task, layout-shift, and paint entries; local insights flag slow/repeated/large requests and nearby errors.
- **Flows:** best-effort timelines group selected-element interactions with nearby requests, console records, and DOM mutations. These are correlations, not proof of causation.
- **Quick actions:** copy debug context, cURL, fetch, Axios, Python, raw HTTP, safe bundle, and bug report; export Postman; generate a redacted AI prompt for manual use.
- **Appearance:** shared System, Light, and Dark preferences in popup and DevTools.

## Screenshots

- Toolbar popup: _screenshot placeholder_
- DevTools panel: _screenshot placeholder_
- UI Inspector overlay: _screenshot placeholder_

## Requirements and setup

- Node.js 20+
- npm
- Chrome 120+

```sh
npm install
npm run build
npm test
```

Load the built extension from `dist/`:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select the `dist/` folder.
3. On first install, review the website-access explanation. Chrome grants HTTP/HTTPS host access as part of installation; there is no per-domain prompt when using UI Inspector or page capture.
4. Open an HTTP/HTTPS page, click Debug Lens, then choose **Pick Element** or explicitly start page fetch/XHR capture.
5. For enhanced wire metadata, open DevTools. UI inspection and page capture do not require DevTools.

The DevTools panel captures through `chrome.devtools.network` and only while DevTools is open. The popup reads shared local history and remains useful after DevTools closes.

## Local demo page

Run `npm run demo`, open `http://127.0.0.1:5173/demo.html`, then start capture. The page includes local 200/401/422/500 and delayed API responses, fetch and XHR requests, a fake bearer value, console errors, DOM mutations, hidden/clipped/covered targets, flex and grid overflow, sticky without an inset, nested stacking contexts, and a long task. The API endpoint is supplied by a Vite development middleware and is not included in the production extension.

## Architecture

```text
Page fetch/XHR + console + PerformanceObserver
        │ MAIN world + isolated bridge
        ├─────────────────────────────────────────┐
        │                                         │
Page UI picker → isolated inspector              │
        │                                         │
        └──────────────→ service worker → IndexedDB
                                      ↑            ├── Popup
DevTools page → chrome.devtools.network ──────────└── DevTools panel
```

Capture adapters normalize browser data before UI/storage use. `RequestRecord` is shared by both network sources. Records are deduplicated by tab, method, normalized URL, near timestamp, and compatible request bodies; DevTools metadata wins for timing/wire headers, while page capture retains call stacks and page-readable body data. UI, console, and performance records use separate typed models in the same local database.

Key areas:

```text
src/background/       MV3 service worker and capture-session lifecycle
src/content/          MAIN-world network hooks, document-start bridge and on-demand UI picker
src/core/capture/     Capture adapters and request normalizers
src/core/debug-insights.ts  Evidence-based local diagnostics and flow grouping
src/storage/          IndexedDB history and chrome.storage preferences
src/ui/               Shared popup/DevTools React application and debug modes
src/devtools/         DevTools page and custom panel bootstrap
public/demo.html      Local debugging fixture page
```

## Permissions and privacy

- `storage`: local preferences and capture-session state.
- `scripting`: inject the MAIN-world fetch/XHR agent after the user explicitly starts page capture.
- `activeTab`: permits explicitly requested visible-tab screenshots. It is not used to start UI inspection or page instrumentation. Chrome requires `activeTab` or `<all_urls>` for `captureVisibleTab`; Debug Lens keeps the narrower permission and does not request `<all_urls>` just for screenshots.
- Required HTTP/HTTPS host access (`http://*/*`, `https://*/*`): makes a small isolated content bridge available at `document_start`, supports selected-element inspection, and lets the extension read matching tab metadata. Chrome presents broad site access during install. There are no runtime `permissions.request()` calls or per-site prompts.
- No `tabs` permission: host access supplies the matching page URL properties and the required tab operations, so the broader tabs permission is unnecessary.
- DevTools APIs are available in the declared `devtools_page`; no host permission is needed for `chrome.devtools.network`.

There is no `debugger` permission and standard operation never calls `chrome.debugger`. Page access is not constant inspection: the content scripts install a lightweight message bridge and picker command listener, while pointer tracking, computed-style reads, observers, and DOM serialization start only after the user activates UI Inspector. The MAIN-world network agent is injected only when the user explicitly starts page capture. Screenshots require an explicit user action. Captured content stays in IndexedDB unless the user copies/exports it. AI is manual prompt generation only; no prompt is sent to an external provider. Secrets are masked in the UI by default and redacted from safe copies, bug reports, and AI prompts. Explicit copy/reveal actions can expose the selected value locally. Never use real credentials in the demo page.

**Chrome Web Store permission justification:** Debug Lens is a developer debugging extension. HTTP/HTTPS host access is required to make its content bridge available, inspect a user-selected DOM element and its computed layout, capture fetch/XHR context when enabled, and correlate page interactions with local debug history. Captured page data remains local by default and is not automatically transmitted. Screenshots are only taken after an explicit user action.

## Capture limits and browser boundaries

- Page hooks are opt-in and begin after injection; earlier requests cannot be recovered by that source. Same-origin navigation reinjection is best effort and early navigation calls may be missed.
- UI Inspector is on-demand. The picker starts from the top frame; although the lightweight bridge is declared for all frames, picking elements inside iframes is not currently supported. Cross-origin frame and closed shadow-root access is constrained by browser/page boundaries.
- Hooks see JavaScript-visible fetch/XHR headers, not every header sent on the wire. Browser-managed Cookie, Origin, Referer, and `Sec-*` headers may be unavailable. DevTools can enrich network metadata while open.
- Requests made internally by a site's service worker and inaccessible/protected Chrome pages are not reliably visible. Cross-origin iframe capture is not enabled by default; closed shadow roots cannot be inspected.
- Streaming/SSE and binary response bodies are omitted. Bodies are limited to 1 MB. Response types such as XHR blob/arraybuffer may not expose readable text.
- Chrome-protected pages (`chrome://`, extension pages, and other restricted contexts) cannot be inspected. `file://` pages require the user to enable **Allow access to file URLs** in the extension details; Debug Lens does not request or bypass this setting. If a page was already open when Debug Lens was installed or reloaded, reload that page once so Chrome installs the declared document-start content scripts.
- The picker blocks the click used to select an element to avoid triggering the application action. Click again after selection to reproduce it. Mutation/event tracking is scoped to the selected element and capped.
- Computed styles and in-scope CSS variables are available, but exact stylesheet source/overridden rule tracing, full WCAG auditing, framework component trees, exact retry, and responsive device emulation are not implemented. Component screenshots cover the currently visible viewport only; offscreen areas are marked partial and are never scrolled/stitched. Capture requires the inspected tab to be active and a user gesture that grants temporary `activeTab` access (for example, clicking the Debug Lens toolbar action before capturing from DevTools). Pixel diffs are best-effort and can include browser anti-aliasing changes. Images are stored locally in IndexedDB, capped at 20 per tab, and removed by Clear history. Copied AI context includes snapshot metadata; because AI is manual prompt-copy mode, attach the saved screenshot manually to the AI tool. Coverage is estimated from nine visible points; clipping and layout messages are geometric/rule-based diagnostics, not proof of root cause. The DOM serializer bounds traversal by depth, node count, attributes, and output length before it emits a snapshot.
- Performance and flow insights are lightweight browser signals and timestamp correlations, not a replacement for Chrome Performance or proof of causality.
- AI provider calls, saved debug sessions, automatic snapshot-on-mutation/watch mode, and broad session-wide value search are not implemented in this MVP.

## Commands

```sh
npm run dev                       # extension UI dev server
npm run demo                      # local page + demo API at 127.0.0.1:5173
npm run typecheck
npm test
npm run check:capture-architecture # asserts no debugger/CDP capture
npm run build                     # type-check and build unpacked extension to dist/
```

## GitHub Actions package

The package workflow creates `api-lens-v<version>-YYYYMMDD-HHmmss.zip` using a UTC timestamp. Download the artifact from a completed Actions run, extract it once, then select the extracted folder using **Load unpacked**. The ZIP itself is not directly installable by Chrome.

## Manual validation

1. Remove an older Debug Lens install if validating the install-time permission prompt, then build and load `dist/` in Chrome.
2. Confirm Chrome shows HTTP/HTTPS website access at install time. Open website A and click **Pick Element**; the picker should start without another permission prompt.
3. Stop inspection, reload website A, and pick again. Open website B and repeat; there should be no per-site or per-session prompt.
4. Capture a component screenshot after invoking Debug Lens from the toolbar; no website-access prompt should appear.
5. Run the local demo, reload its page if it was already open when the extension was loaded, and open the toolbar popup. Trigger fetch/XHR status buttons; verify request, response body, timing, and dummy bearer capture.
6. Pick covered, clipped, hidden, flex/grid overflow, sticky, and stacking-context targets; verify each result includes the measured evidence.
7. Capture Element only, Element + context at multiple padding values, and Full viewport. Compare two captures and verify partial status for a target extending beyond the visible viewport.
8. Select the mutation target, interact with it, and review Events and Changes; choose a later snapshot to compare computed styles and bounds.
9. Trigger console error and long task; verify Console/Performance and related-flow views.
10. Open DevTools and confirm the Network panel enriches history without a Chrome debugging banner; close DevTools and verify history remains.
11. Open a `chrome://` page and confirm inspection is unavailable without a permission loop. Test a `file://` URL with file access disabled and confirm the extension explains how to enable it.
12. Verify default masking, safe cURL/debug copy, Postman export, and manual redacted AI prompt.
