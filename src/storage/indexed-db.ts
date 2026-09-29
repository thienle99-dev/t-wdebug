import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { RequestRecord } from '../shared/types';

interface ApiLensDB extends DBSchema { requests: { key: string; value: RequestRecord; indexes: { 'by-timestamp': number } } }
let database: Promise<IDBPDatabase<ApiLensDB>> | undefined;
function db() { return database ??= openDB<ApiLensDB>('api-lens', 1, { upgrade(value) { const store = value.createObjectStore('requests', { keyPath: 'id' }); store.createIndex('by-timestamp', 'timestamp'); } }); }
export async function saveRequest(record: RequestRecord, maxRequests = 500): Promise<void> {
  const value = await db(); const tx = value.transaction('requests', 'readwrite'); await tx.store.put(record);
  const records = (await tx.store.getAll()).sort((a, b) => b.timestamp - a.timestamp);
  const overflow = records.slice(Math.max(0, maxRequests));
  for (const old of overflow.filter((item) => !item.flags.pinned)) await tx.store.delete(old.id);
  await tx.done;
}
export async function getRequests(limit = 500): Promise<RequestRecord[]> { const value = await db(); return (await value.getAllFromIndex('requests', 'by-timestamp')).sort((a, b) => b.timestamp - a.timestamp).slice(0, limit); }
export async function updateRequest(record: RequestRecord): Promise<void> { await (await db()).put('requests', record); }
export async function deleteRequest(id: string): Promise<void> { await (await db()).delete('requests', id); }
export async function clearRequests(): Promise<void> { await (await db()).clear('requests'); }
export async function pruneRequests(maxRequests: number): Promise<void> {
  const value = await db(); const items = (await value.getAllFromIndex('requests', 'by-timestamp')).sort((a, b) => b.timestamp - a.timestamp);
  let remaining = items.length; for (const item of items.reverse()) { if (remaining <= maxRequests) break; if (!item.flags.pinned) { await value.delete('requests', item.id); remaining--; } }
}
