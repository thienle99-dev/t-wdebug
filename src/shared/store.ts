import { create } from 'zustand';
import { deleteRequest, getRequests, updateRequest } from '../storage/indexed-db';
import type { RequestRecord } from './types';

interface RequestState { requests: RequestRecord[]; selectedId?: string; loading: boolean; refresh: () => Promise<void>; select: (id?: string) => void; remove: (id: string) => Promise<void>; togglePin: (id: string) => Promise<void> }
export const useRequestStore = create<RequestState>((set, get) => ({
  requests: [], loading: true,
  refresh: async () => {
    try {
      const requests = await getRequests();
      const selectedId = get().selectedId;
      const nextId = selectedId && requests.some((item) => item.id === selectedId) ? selectedId : (requests.find((item) => item.flags.failed)?.id ?? requests[0]?.id);
      set({ requests, selectedId: nextId, loading: false });
    } catch { set({ loading: false }); }
  },
  select: (id) => set({ selectedId: id }),
  remove: async (id) => { await deleteRequest(id); await get().refresh(); },
  togglePin: async (id) => { const record = get().requests.find((item) => item.id === id); if (record) { await updateRequest({ ...record, flags: { ...record.flags, pinned: !record.flags.pinned } }); await get().refresh(); } },
}));
