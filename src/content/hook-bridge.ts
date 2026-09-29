import type { PageHookCapturePayload } from '../shared/types';

const MAX_BODY_CHARS = 1024 * 1024;
declare global { interface Window { __API_LENS_BRIDGE_READY__?: boolean } }

if (window.__API_LENS_BRIDGE_READY__) {
  window.postMessage({ source: 'API_LENS_BRIDGE', type: 'READY' }, '*');
} else {
window.__API_LENS_BRIDGE_READY__ = true;

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window || !isObject(event.data)) return;
  const message = event.data as { source?: unknown; type?: unknown; payload?: unknown };
  if (message.source === 'API_LENS_HOOK' && message.type === 'HELLO') {
    window.postMessage({ source: 'API_LENS_BRIDGE', type: 'READY' }, '*');
    return;
  }
  if (message.source !== 'API_LENS') return;
  if (message.type === 'CAPTURE' && isValidCapture(message.payload)) {
    try { void chrome.runtime.sendMessage({ type: 'capture:hook:record', payload: message.payload }).catch(() => undefined); }
    catch { /* A disabled extension must not affect the inspected page. */ }
    return;
  }
  if (message.type === 'DEBUG_RECORD' && isValidDebugRecord(message.payload)) {
    try { void chrome.runtime.sendMessage({ type: 'debug:record', payload: message.payload }).catch(() => undefined); }
    catch { /* A disabled extension must not affect the inspected page. */ }
  }
});

chrome.runtime.onMessage.addListener((message: { type?: string; enabled?: boolean }) => {
  if (message?.type === 'capture:hook:set-enabled') {
    window.postMessage({ source: 'API_LENS_BRIDGE', type: 'SET_ENABLED', enabled: message.enabled === true }, '*');
  }
});

window.postMessage({ source: 'API_LENS_BRIDGE', type: 'READY' }, '*');
}

function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function isValidCapture(value: unknown): value is PageHookCapturePayload {
  if (!isObject(value) || !isObject(value.request) || !isObject(value.response)) return false;
  if (value.source !== 'fetch-hook' && value.source !== 'xhr-hook') return false;
  if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) return false;
  if (typeof value.request.method !== 'string' || typeof value.request.url !== 'string' || value.request.url.length > 16_384) return false;
  if (typeof value.response.status !== 'number' || !Number.isFinite(value.response.status)) return false;
  if (typeof value.request.body === 'string' && value.request.body.length > MAX_BODY_CHARS) return false;
  if (typeof value.response.body === 'string' && value.response.body.length > MAX_BODY_CHARS) return false;
  return true;
}
function isValidDebugRecord(value: unknown): value is import('../shared/types').IncomingDebugRecord {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.timestamp !== 'number') return false;
  try { if (JSON.stringify(value).length > 128_000) return false; } catch { return false; }
  if (value.kind === 'console') return (value.level === 'error' || value.level === 'warning') && typeof value.message === 'string' && value.message.length <= 8000;
  if (value.kind === 'performance') return ['resource','longtask','layout-shift','paint'].includes(String(value.entryType)) && typeof value.duration === 'number';
  return false;
}
