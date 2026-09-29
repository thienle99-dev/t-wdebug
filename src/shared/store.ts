import { create } from 'zustand';
import { deleteRequest, getRequests, updateRequest } from '../storage/indexed-db';
import type { RequestRecord } from './types';

interface RequestState { requests: RequestRecord[]; selectedId?: string; loading: boolean; storageError: boolean; refresh: () => Promise<void>; select: (id?: string) => void; remove: (id: string) => Promise<void>; togglePin: (id: string) => Promise<void> }
export const useRequestStore = create<RequestState>((set, get) => ({
  requests: [], loading: true, storageError: false,
  refresh: async () => {
    try {
      const requests = await getRequests();
      const current = get();
      const unchanged = sameVisibleRequests(current.requests, requests);
      const stableRequests = unchanged ? current.requests : requests;
      const selectedId = current.selectedId;
      const nextId = selectedId && stableRequests.some((item) => item.id === selectedId) ? selectedId : (stableRequests.find((item) => item.flags.failed)?.id ?? stableRequests[0]?.id);
      if (!unchanged || current.loading || current.storageError || nextId !== current.selectedId) set({ requests: stableRequests, selectedId: nextId, loading: false, storageError: false });
    } catch { set({ loading: false, storageError: true }); }
  },
  select: (id) => set({ selectedId: id }),
  remove: async (id) => { await deleteRequest(id); await get().refresh(); },
  togglePin: async (id) => { const record = get().requests.find((item) => item.id === id); if (record) { await updateRequest({ ...record, flags: { ...record.flags, pinned: !record.flags.pinned } }); await get().refresh(); } },
}));

function sameVisibleRequests(current: RequestRecord[], next: RequestRecord[]): boolean {
  if (current.length !== next.length) return false;
  return current.every((left, index) => {
    const right = next[index];
    return Boolean(right && left.id === right.id && left.timestamp === right.timestamp && left.request.method === right.request.method && left.request.url === right.request.url && left.response.status === right.response.status && left.flags.pinned === right.flags.pinned && left.flags.failed === right.flags.failed && left.timing?.total === right.timing?.total && left.request.body?.text?.length === right.request.body?.text?.length && left.response.body?.text?.length === right.response.body?.text?.length);
  });
}
