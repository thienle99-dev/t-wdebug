import type { CaptureRuntimeMessage, CaptureStatus } from '../shared/types';

const HEARTBEATS_KEY = 'devtoolsCaptureHeartbeats';
const HEARTBEAT_TTL_MS = 15_000;

type Heartbeats = Record<string, number>;

chrome.runtime.onMessage.addListener((rawMessage: unknown, _sender, sendResponse) => {
  const message = rawMessage as CaptureRuntimeMessage;
  if (!message || !Number.isInteger(message.tabId) || message.tabId < 0) return;

  if (message.type === 'capture:heartbeat' && typeof message.active === 'boolean') {
    void updateHeartbeat(message.tabId, message.active)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'capture:status') {
    void readCaptureStatus(message.tabId)
      .then((state) => sendResponse({ state, active: state === 'active' }))
      .catch(() => sendResponse({ state: 'unknown' satisfies CaptureStatus, active: false }));
    return true;
  }
});

async function updateHeartbeat(tabId: number, active: boolean): Promise<void> {
  const stored = await chrome.storage.session.get(HEARTBEATS_KEY);
  const heartbeats = isHeartbeats(stored[HEARTBEATS_KEY]) ? { ...stored[HEARTBEATS_KEY] } : {};
  if (active) heartbeats[String(tabId)] = Date.now();
  else delete heartbeats[String(tabId)];
  await chrome.storage.session.set({ [HEARTBEATS_KEY]: heartbeats });
}

async function readCaptureStatus(tabId: number): Promise<CaptureStatus> {
  const stored = await chrome.storage.session.get(HEARTBEATS_KEY);
  const heartbeats = isHeartbeats(stored[HEARTBEATS_KEY]) ? stored[HEARTBEATS_KEY] : {};
  const heartbeat = heartbeats[String(tabId)];
  if (typeof heartbeat !== 'number') return 'inactive';
  if (Date.now() - heartbeat <= HEARTBEAT_TTL_MS) return 'active';
  await updateHeartbeat(tabId, false);
  return 'inactive';
}

function isHeartbeats(value: unknown): value is Heartbeats {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
