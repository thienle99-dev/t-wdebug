import type { CaptureRuntimeMessage, CaptureStatus, PageHookCapturePayload } from '../shared/types';
import { normalizePageHookCapture } from '../core/capture/page-hook';
import { saveRequest } from '../storage/indexed-db';
import { getPreferences } from '../storage/preferences';

const HEARTBEATS_KEY = 'devtoolsCaptureHeartbeats';
const HOOK_SESSIONS_KEY = 'pageHookCaptureSessions';
const HEARTBEAT_TTL_MS = 15_000;
type Heartbeats = Record<string, number>;
type HookSessions = Record<string, string>;

chrome.runtime.onMessage.addListener((rawMessage: unknown, sender, sendResponse) => {
  if (!isObject(rawMessage) || sender.id !== chrome.runtime.id) return;
  const message = rawMessage as CaptureRuntimeMessage;

  if (message.type === 'capture:hook:record') {
    const tabId = sender.tab?.id;
    if (tabId === undefined || sender.frameId !== 0 || !isPageCapturePayload(message.payload)) return;
    void persistHookCapture(message.payload, tabId, sender.tab?.url).catch(() => undefined);
    return;
  }

  if (!Number.isInteger(message.tabId) || message.tabId < 0) return;
  if (message.type === 'capture:heartbeat' && typeof message.active === 'boolean') {
    void updateHeartbeat(message.tabId, message.active)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'capture:status') {
    void readCaptureStatus(message.tabId)
      .then((status) => sendResponse(status))
      .catch(() => sendResponse({ state: 'unknown' satisfies CaptureStatus, active: false, pageHookActive: false, devtoolsActive: false }));
    return true;
  }

  if (message.type === 'capture:hook:start' && typeof message.origin === 'string') {
    void startPageHook(message.tabId, message.origin)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: safeError(error) }));
    return true;
  }

  if (message.type === 'capture:hook:stop' && typeof message.origin === 'string') {
    void stopPageHook(message.tabId, message.origin)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: safeError(error) }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => { void updateHookTab(tabId, undefined); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading' && changeInfo.status !== 'complete') return;
  void refreshHookForNavigation(tabId, tab.url);
});

async function startPageHook(tabId: number, requestedOrigin: string): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const page = parseHttpUrl(tab.url);
  const originUrl = parseHttpUrl(requestedOrigin);
  if (!page || !originUrl || page.origin !== originUrl.origin) throw new Error('The active tab changed. Reopen API Lens on the site you want to capture.');
  const origin = page.origin;
  const pattern = permissionPattern(origin);
  if (!await chrome.permissions.contains({ origins: [pattern] })) throw new Error('Site access was not granted.');

  await updateHookTab(tabId, origin);
  try {
    await injectPageHook(tabId);
  } catch {
    await updateHookTab(tabId, undefined);
    throw new Error('Could not inject the API capture hook into this page. Protected Chrome pages cannot be instrumented.');
  }
}

async function stopPageHook(tabId: number, requestedOrigin: string): Promise<void> {
  const originUrl = parseHttpUrl(requestedOrigin);
  if (!originUrl) throw new Error('Invalid site origin.');
  const origin = originUrl.origin;
  const stored = await chrome.storage.session.get(HOOK_SESSIONS_KEY);
  const sessions = isHookSessions(stored[HOOK_SESSIONS_KEY]) ? stored[HOOK_SESSIONS_KEY] : {};
  if (sessions[String(tabId)] !== origin) return;
  await chrome.tabs.sendMessage(tabId, { type: 'capture:hook:set-enabled', enabled: false }).catch(() => undefined);
  await updateHookTab(tabId, undefined);
}

async function refreshHookForNavigation(tabId: number, url?: string): Promise<void> {
  const stored = await chrome.storage.session.get(HOOK_SESSIONS_KEY);
  const sessions = isHookSessions(stored[HOOK_SESSIONS_KEY]) ? stored[HOOK_SESSIONS_KEY] : {};
  const origin = sessions[String(tabId)];
  if (!origin) return;
  if (parseHttpUrl(url)?.origin !== origin) { await updateHookTab(tabId, undefined); return; }
  try { await injectPageHook(tabId); } catch { /* Protected pages or browser restrictions can prevent reinjection. */ }
}

async function injectPageHook(tabId: number): Promise<void> {
  // Start the isolated bridge first so early page requests can be queued and drained.
  await chrome.scripting.executeScript({ target: { tabId }, files: ['capture/hook-bridge.js'], world: 'ISOLATED', injectImmediately: true });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['capture/main-world.js'], world: 'MAIN', injectImmediately: true });
}

async function persistHookCapture(payload: PageHookCapturePayload, tabId: number, tabUrl?: string): Promise<void> {
  const stored = await chrome.storage.session.get(HOOK_SESSIONS_KEY);
  const sessions = isHookSessions(stored[HOOK_SESSIONS_KEY]) ? stored[HOOK_SESSIONS_KEY] : {};
  const origin = sessions[String(tabId)];
  const page = parseHttpUrl(tabUrl);
  if (!origin || !page || page.origin !== origin) return;
  if (!await chrome.permissions.contains({ origins: [permissionPattern(origin)] })) return;
  const preferences = await getPreferences();
  if (!preferences.captureEnabled) return;
  const record = normalizePageHookCapture(payload, tabId, tabUrl);
  if (record) await saveRequest(record, preferences.maxRequests);
}

async function updateHeartbeat(tabId: number, active: boolean): Promise<void> {
  const stored = await chrome.storage.session.get(HEARTBEATS_KEY);
  const heartbeats = isHeartbeats(stored[HEARTBEATS_KEY]) ? { ...stored[HEARTBEATS_KEY] } : {};
  if (active) heartbeats[String(tabId)] = Date.now();
  else delete heartbeats[String(tabId)];
  await chrome.storage.session.set({ [HEARTBEATS_KEY]: heartbeats });
}

async function readCaptureStatus(tabId: number): Promise<{ state: CaptureStatus; active: boolean; pageHookActive: boolean; devtoolsActive: boolean }> {
  const stored = await chrome.storage.session.get([HEARTBEATS_KEY, HOOK_SESSIONS_KEY]);
  const heartbeats = isHeartbeats(stored[HEARTBEATS_KEY]) ? stored[HEARTBEATS_KEY] : {};
  const heartbeat = heartbeats[String(tabId)];
  const devtoolsActive = typeof heartbeat === 'number' && Date.now() - heartbeat <= HEARTBEAT_TTL_MS;
  if (typeof heartbeat === 'number' && !devtoolsActive) await updateHeartbeat(tabId, false);
  const sessions = isHookSessions(stored[HOOK_SESSIONS_KEY]) ? stored[HOOK_SESSIONS_KEY] : {};
  const origin = sessions[String(tabId)];
  if (!origin) return { state: devtoolsActive ? 'active' : 'inactive', active: devtoolsActive, pageHookActive: false, devtoolsActive };
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  const pageHookActive = parseHttpUrl(tab?.url)?.origin === origin;
  const active = devtoolsActive || pageHookActive;
  return { state: active ? 'active' : 'inactive', active, pageHookActive, devtoolsActive };
}

async function updateHookTab(tabId: number, origin: string | undefined): Promise<void> {
  const stored = await chrome.storage.session.get(HOOK_SESSIONS_KEY);
  const sessions = isHookSessions(stored[HOOK_SESSIONS_KEY]) ? { ...stored[HOOK_SESSIONS_KEY] } : {};
  if (origin) sessions[String(tabId)] = origin;
  else delete sessions[String(tabId)];
  await chrome.storage.session.set({ [HOOK_SESSIONS_KEY]: sessions });
}

function permissionPattern(origin: string): string {
  const parsed = new URL(origin);
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

function parseHttpUrl(value?: string): URL | undefined {
  try { const url = new URL(value ?? ''); return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined; }
  catch { return undefined; }
}

function isPageCapturePayload(value: unknown): value is PageHookCapturePayload {
  if (!isObject(value) || !isObject(value.request) || !isObject(value.response)) return false;
  if (value.source !== 'fetch-hook' && value.source !== 'xhr-hook') return false;
  if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) return false;
  if (typeof value.request.method !== 'string' || value.request.method.length > 32 || typeof value.request.url !== 'string' || value.request.url.length > 16_384) return false;
  if (value.request.body !== undefined && (typeof value.request.body !== 'string' || value.request.body.length > 1_100_000)) return false;
  if (value.response.body !== undefined && (typeof value.response.body !== 'string' || value.response.body.length > 1_100_000)) return false;
  if (typeof value.response.status !== 'number' || !Number.isFinite(value.response.status)) return false;
  return true;
}

function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function isHeartbeats(value: unknown): value is Heartbeats { return isObject(value); }
function isHookSessions(value: unknown): value is HookSessions { return isObject(value); }
function safeError(error: unknown): string { return error instanceof Error ? error.message.slice(0, 280) : 'Capture could not be started.'; }
