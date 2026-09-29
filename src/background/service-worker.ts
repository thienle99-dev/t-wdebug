import { getPreferences } from '../storage/preferences';
import { saveRequest } from '../storage/indexed-db';
import { normalizeRecord, type CDPRequestEvent, type CDPResponseEvent } from '../core/normalize';
import { DEFAULT_PREFERENCES, type Preferences } from '../shared/types';

interface PendingRequest { request: CDPRequestEvent; response?: CDPResponseEvent; requestHeaders?: Record<string, unknown>; responseHeaders?: Record<string, unknown>; startedAtMs: number; requestBody?: string; pageUrl?: string; pageTitle?: string }
const sessions = new Map<number, Map<string, PendingRequest>>();
const earlyExtra = new Map<number, Map<string, { requestHeaders?: Record<string, unknown>; responseHeaders?: Record<string, unknown>; statusCode?: number }>>();
const activeTabs = new Set<number>();
const apiResourceTypes = new Set(['Fetch', 'XHR', 'EventSource']);
let preferences: Preferences = DEFAULT_PREFERENCES;
const restoredSessions = Promise.all([chrome.storage.session.get('captureTabs'), getPreferences()]).then(async ([state, loadedPreferences]) => {
  preferences = loadedPreferences;
  const tabIds = (state.captureTabs as number[] | undefined) ?? [];
  for (const tabId of tabIds) {
    activeTabs.add(tabId); sessions.set(tabId, new Map()); earlyExtra.set(tabId, new Map());
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable', { maxTotalBufferSize: 4_000_000, maxResourceBufferSize: 1_000_000, maxPostDataSize: 1_000_000 });
    } catch {
      activeTabs.delete(tabId); sessions.delete(tabId); earlyExtra.delete(tabId);
    }
  }
  await chrome.storage.session.set({ captureTabs: [...activeTabs] });
}).catch(() => undefined);

async function save(tabId: number, pending: PendingRequest, extra: { responseBody?: string; responseEncoding?: string; totalMs?: number; reason?: string } = {}): Promise<void> {
  const prefs = await getPreferences();
  const record = normalizeRecord({ tabId, pageUrl: pending.pageUrl, pageTitle: pending.pageTitle, request: pending.request, response: pending.response, requestHeaders: pending.requestHeaders, responseHeaders: pending.responseHeaders, requestBody: pending.requestBody, responseBody: extra.responseBody, responseEncoding: extra.responseEncoding, startedAtMs: pending.startedAtMs, totalMs: extra.totalMs, maxBodyBytes: prefs.maxBodyBytes, unavailableReason: extra.reason });
  if (record) await saveRequest(record, prefs.maxRequests);
}

async function startCapture(tabId: number): Promise<void> {
  await restoredSessions;
  if (activeTabs.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  activeTabs.add(tabId); sessions.set(tabId, new Map()); earlyExtra.set(tabId, new Map());
  try { await chrome.debugger.sendCommand({ tabId }, 'Network.enable', { maxTotalBufferSize: 4_000_000, maxResourceBufferSize: 1_000_000, maxPostDataSize: 1_000_000 }); }
  catch (error) { await chrome.debugger.detach({ tabId }).catch(() => undefined); activeTabs.delete(tabId); sessions.delete(tabId); earlyExtra.delete(tabId); throw error; }
  await chrome.storage.session.set({ captureTabs: [...activeTabs] });
}
async function stopCapture(tabId: number): Promise<void> {
  await restoredSessions;
  if (!activeTabs.has(tabId)) return;
  activeTabs.delete(tabId); sessions.delete(tabId); earlyExtra.delete(tabId);
  await chrome.storage.session.set({ captureTabs: [...activeTabs] });
  await chrome.debugger.detach({ tabId });
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  void restoredSessions.then(() => handleDebuggerEvent(source, method, params));
});
function handleDebuggerEvent(source: chrome.debugger.Debuggee, method: string, params?: object): void {
  const tabId = source.tabId; if (tabId === undefined || !activeTabs.has(tabId)) return;
  const table = sessions.get(tabId); if (!table) return;
  const p = params as Record<string, unknown>; const id = String(p.requestId ?? '');
  if (method === 'Network.requestWillBeSent') {
    const req = p as unknown as CDPRequestEvent;
    if (!req.request || !req.request.url) return;
    if (p.redirectResponse) {
      const previous = table.get(id);
      if (previous) { previous.response = p.redirectResponse as CDPResponseEvent; void save(tabId, previous, { reason: 'Redirect response body is unavailable.' }); }
    }
    if (!/^https?:/i.test(req.request.url)) return;
    if (!preferences.captureEnabled || (!preferences.captureStaticAssets && !apiResourceTypes.has(String(req.type ?? '')))) return;
    const current: PendingRequest = { request: req, requestHeaders: req.request.headers as Record<string, unknown>, requestBody: req.request.postData, startedAtMs: (req.wallTime ?? Date.now() / 1000) * 1000, pageUrl: req.documentURL };
    table.set(id, current);
    const extra = earlyExtra.get(tabId)?.get(id);
    if (extra) { current.requestHeaders = extra.requestHeaders ?? current.requestHeaders; current.responseHeaders = extra.responseHeaders; earlyExtra.get(tabId)?.delete(id); }
  } else if (method === 'Network.requestWillBeSentExtraInfo') {
    const pending = table.get(id); if (pending) pending.requestHeaders = p.headers as Record<string, unknown>;
    else { const extras = earlyExtra.get(tabId) ?? new Map(); extras.set(id, { ...extras.get(id), requestHeaders: p.headers as Record<string, unknown> }); earlyExtra.set(tabId, extras); }
  } else if (method === 'Network.responseReceived') {
    const pending = table.get(id); if (pending) { pending.response = p.response as CDPResponseEvent; const extra = earlyExtra.get(tabId)?.get(id); if (extra?.statusCode) pending.response.status = extra.statusCode; }
  } else if (method === 'Network.responseReceivedExtraInfo') {
    const pending = table.get(id); if (pending) { pending.responseHeaders = p.headers as Record<string, unknown>; if (p.statusCode && pending.response) pending.response.status = Number(p.statusCode); }
    else { const extras = earlyExtra.get(tabId) ?? new Map(); extras.set(id, { ...extras.get(id), responseHeaders: p.headers as Record<string, unknown>, statusCode: Number(p.statusCode) }); earlyExtra.set(tabId, extras); }
  } else if (method === 'Network.loadingFinished') {
    const pending = table.get(id); if (!pending) return; table.delete(id);
    const totalMs = Math.max(0, (Number(p.timestamp) - pending.request.timestamp) * 1000);
    void Promise.allSettled([
      chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId: id }),
      chrome.debugger.sendCommand({ tabId }, 'Network.getRequestPostData', { requestId: id }),
    ]).then(async ([responseResult, requestResult]) => {
      if (!pending.requestBody && requestResult.status === 'fulfilled') pending.requestBody = (requestResult.value as { postData?: string }).postData;
      if (responseResult.status === 'rejected') throw responseResult.reason;
      const body = responseResult.value;
      const value = body as { body?: string; base64Encoded?: boolean };
      if (value.base64Encoded) await save(tabId, pending, { responseBody: '[Binary/base64 response body omitted]', responseEncoding: 'base64', totalMs, reason: 'Binary response body was not decoded.' });
      else await save(tabId, pending, { responseBody: value.body ?? '', totalMs });
    }).catch(async () => {
      // Request post data may be omitted from requestWillBeSent for larger bodies.
      let requestBody = pending.requestBody;
      try { const data = await chrome.debugger.sendCommand({ tabId }, 'Network.getRequestPostData', { requestId: id }) as { postData?: string }; requestBody ??= data.postData; } catch { /* Body not retained by Chrome. */ }
      pending.requestBody = requestBody;
      await save(tabId, pending, { totalMs, reason: 'Response body is unavailable or no longer retained by Chrome.' });
    });
  } else if (method === 'Network.loadingFailed') {
    const pending = table.get(id); if (!pending) return; table.delete(id);
    void save(tabId, pending, { reason: String(p.errorText ?? 'Request failed before a response body was available.') });
  }
}

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== undefined) { activeTabs.delete(source.tabId); sessions.delete(source.tabId); earlyExtra.delete(source.tabId); void chrome.storage.session.set({ captureTabs: [...activeTabs] }); }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.preferences?.newValue) preferences = { ...DEFAULT_PREFERENCES, ...(changes.preferences.newValue as Partial<Preferences>) };
});
chrome.tabs.onRemoved.addListener((tabId) => { activeTabs.delete(tabId); sessions.delete(tabId); earlyExtra.delete(tabId); void chrome.storage.session.set({ captureTabs: [...activeTabs] }); });

chrome.runtime.onMessage.addListener((message: { type?: string; tabId?: number }, _sender, sendResponse) => {
  if (message.type === 'capture:status') { void restoredSessions.then(() => sendResponse({ active: message.tabId !== undefined && activeTabs.has(message.tabId) })); return true; }
  if ((message.type === 'capture:start' || message.type === 'capture:stop') && Number.isInteger(message.tabId)) {
    const action = message.type === 'capture:start' ? startCapture(message.tabId!) : stopCapture(message.tabId!);
    action.then(() => sendResponse({ ok: true, active: message.type === 'capture:start' })).catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message.type === 'requests:changed') return;
});
