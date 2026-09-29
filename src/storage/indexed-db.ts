import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { RequestRecord } from '../shared/types';

interface ApiLensDB extends DBSchema { requests: { key: string; value: RequestRecord; indexes: { 'by-timestamp': number } } }
let database: Promise<IDBPDatabase<ApiLensDB>> | undefined;
function db() { return database ??= openDB<ApiLensDB>('api-lens', 1, { upgrade(value) { const store = value.createObjectStore('requests', { keyPath: 'id' }); store.createIndex('by-timestamp', 'timestamp'); } }); }
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
