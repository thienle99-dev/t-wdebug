import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { DebugRecord, RequestRecord, UIComponentSnapshot } from '../shared/types';

interface ApiLensDB extends DBSchema {
  requests: { key: string; value: RequestRecord; indexes: { 'by-timestamp': number } };
  debugRecords: { key: string; value: DebugRecord; indexes: { 'by-timestamp': number; 'by-kind': string } };
  componentSnapshots: { key: string; value: UIComponentSnapshot; indexes: { 'by-timestamp': number; 'by-tab': number } };
  componentImages: { key: string; value: { id: string; dataUrl: string } };
}
let database: Promise<IDBPDatabase<ApiLensDB>> | undefined;
function db() { return database ??= openDB<ApiLensDB>('api-lens', 3, { upgrade(value, oldVersion) {
  if (oldVersion < 1) { const store = value.createObjectStore('requests', { keyPath: 'id' }); store.createIndex('by-timestamp', 'timestamp'); }
  if (oldVersion < 2) { const store = value.createObjectStore('debugRecords', { keyPath: 'id' }); store.createIndex('by-timestamp', 'timestamp'); store.createIndex('by-kind', 'kind'); }
  if (oldVersion < 3) { const store = value.createObjectStore('componentSnapshots', { keyPath: 'id' }); store.createIndex('by-timestamp', 'timestamp'); store.createIndex('by-tab', 'tabId'); value.createObjectStore('componentImages', { keyPath: 'id' }); }
} }); }
export async function saveRequest(record: RequestRecord, maxRequests = 500): Promise<void> {
  const value = await db(); const tx = value.transaction('requests', 'readwrite');
  const existingRecords = await tx.store.getAll();
  const matching = existingRecords.find((item) => isSameNetworkRequest(item, record));
  let normalized = record;
  if (matching) {
    const preferred = sourcePriority(record) >= sourcePriority(matching) ? record : matching;
    const fallback = preferred === record ? matching : record;
    normalized = {
      ...fallback,
      ...preferred,
      id: preferred.id,
      source: preferred.source,
      page: { ...fallback.page, ...preferred.page },
      request: { ...fallback.request, ...preferred.request, headers: preferred.request.headers.length ? preferred.request.headers : fallback.request.headers, cookies: preferred.request.cookies.length ? preferred.request.cookies : fallback.request.cookies, body: preferred.request.body ?? fallback.request.body, auth: preferred.request.auth ?? fallback.request.auth },
      response: { ...fallback.response, ...preferred.response, headers: preferred.response.headers.length ? preferred.response.headers : fallback.response.headers, cookies: preferred.response.cookies?.length ? preferred.response.cookies : fallback.response.cookies, body: preferred.response.body?.text !== undefined ? preferred.response.body : fallback.response.body ?? preferred.response.body },
      timing: mergeDefined(fallback.timing, preferred.timing),
      meta: mergeDefined(fallback.meta, preferred.meta),
      flags: { ...fallback.flags, ...preferred.flags, pinned: fallback.flags.pinned || preferred.flags.pinned },
    };
    if (matching.id !== normalized.id) await tx.store.delete(matching.id);
  }
  await tx.store.put(normalized);
  const records = (await tx.store.getAll()).sort((a, b) => b.timestamp - a.timestamp);
  const overflow = records.slice(Math.max(0, maxRequests));
  for (const old of overflow.filter((item) => !item.flags.pinned)) await tx.store.delete(old.id);
  await tx.done;
}

function sourcePriority(record: RequestRecord): number { return record.source === 'devtools-network' ? 2 : 1; }

function mergeDefined<T extends object>(fallback?: T, preferred?: T): T | undefined {
  if (!fallback && !preferred) return undefined;
  return { ...(fallback ?? {} as T), ...Object.fromEntries(Object.entries(preferred ?? {}).filter(([, value]) => value !== undefined)) } as T;
}

function isSameNetworkRequest(left: RequestRecord, right: RequestRecord): boolean {
  if (left.tabId === undefined || left.tabId !== right.tabId || left.source === right.source) return false;
  if (Math.abs(left.timestamp - right.timestamp) > 750 || left.request.method !== right.request.method) return false;
  try { if (new URL(left.request.url).href !== new URL(right.request.url).href) return false; } catch { return false; }
  const leftBody = left.request.body?.text; const rightBody = right.request.body?.text;
  return leftBody === undefined || rightBody === undefined || leftBody === rightBody;
}
export async function getRequests(limit = 500): Promise<RequestRecord[]> { const value = await db(); return (await value.getAllFromIndex('requests', 'by-timestamp')).sort((a, b) => b.timestamp - a.timestamp).slice(0, limit); }
export async function updateRequest(record: RequestRecord): Promise<void> { await (await db()).put('requests', record); }
export async function deleteRequest(id: string): Promise<void> { await (await db()).delete('requests', id); }
export async function clearRequests(): Promise<void> { await (await db()).clear('requests'); }
export async function pruneRequests(maxRequests: number): Promise<void> {
  const value = await db(); const items = (await value.getAllFromIndex('requests', 'by-timestamp')).sort((a, b) => b.timestamp - a.timestamp);
  let remaining = items.length; for (const item of items.reverse()) { if (remaining <= maxRequests) break; if (!item.flags.pinned) { await value.delete('requests', item.id); remaining--; } }
}
export async function saveDebugRecord(record: DebugRecord, maxRecords = 500): Promise<void> {
  const value = await db(); const tx = value.transaction('debugRecords', 'readwrite');
  await tx.store.put(record);
  const limit = Math.min(maxRecords, record.kind === 'ui-snapshot' ? 50 : 500);
  const items = (await tx.store.index('by-kind').getAll(record.kind)).sort((a, b) => b.timestamp - a.timestamp);
  for (const item of items.slice(limit)) await tx.store.delete(item.id);
  await tx.done;
}
export async function getDebugRecords<T extends DebugRecord['kind']>(kind: T, tabId?: number, limit = 500): Promise<Extract<DebugRecord, { kind: T }>[]> {
  const value = await db(); const items = await value.getAllFromIndex('debugRecords', 'by-kind', kind);
  return items.filter((item) => tabId === undefined || item.tabId === tabId).sort((a, b) => b.timestamp - a.timestamp).slice(0, limit) as Extract<DebugRecord, { kind: T }>[];
}
export async function clearDebugRecords(tabId?: number): Promise<void> {
  const value = await db(); const tx = value.transaction(['debugRecords', 'componentSnapshots', 'componentImages'], 'readwrite');
  if (tabId === undefined) { await tx.objectStore('debugRecords').clear(); await tx.objectStore('componentSnapshots').clear(); await tx.objectStore('componentImages').clear(); }
  else {
    for (const item of (await tx.objectStore('debugRecords').getAll()).filter((record) => record.tabId === tabId)) await tx.objectStore('debugRecords').delete(item.id);
    for (const item of (await tx.objectStore('componentSnapshots').index('by-tab').getAll(tabId))) { await tx.objectStore('componentSnapshots').delete(item.id); await tx.objectStore('componentImages').delete(item.id); }
  }
  await tx.done;
}

export async function saveComponentSnapshot(record: UIComponentSnapshot, maxPerTab = 20): Promise<void> {
  if (!record.screenshot.dataUrl || record.screenshot.dataUrl.length > 4_000_000) throw new Error('Component screenshot is missing or exceeds the local image limit.');
  const value = await db(); const tx = value.transaction(['componentSnapshots', 'componentImages'], 'readwrite');
  const { dataUrl, ...screenshot } = record.screenshot;
  await tx.objectStore('componentSnapshots').put({ ...record, screenshot });
  await tx.objectStore('componentImages').put({ id: record.id, dataUrl });
  const items = (await tx.objectStore('componentSnapshots').index('by-tab').getAll(record.tabId)).sort((a, b) => b.timestamp - a.timestamp);
  for (const old of items.slice(Math.max(1, maxPerTab))) { await tx.objectStore('componentSnapshots').delete(old.id); await tx.objectStore('componentImages').delete(old.id); }
  await tx.done;
}

export async function getComponentSnapshots(tabId?: number, limit = 20): Promise<UIComponentSnapshot[]> {
  const value = await db(); const items = await value.getAllFromIndex('componentSnapshots', 'by-timestamp');
  return items.filter((item) => tabId === undefined || item.tabId === tabId).sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

export async function getComponentScreenshot(id: string): Promise<string | undefined> {
  return (await (await db()).get('componentImages', id))?.dataUrl;
}
