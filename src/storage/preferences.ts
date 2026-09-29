import { DEFAULT_PREFERENCES, type Preferences } from '../shared/types';
const KEY = 'preferences';
export async function getPreferences(): Promise<Preferences> {
  const stored = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_PREFERENCES, ...(stored[KEY] as Partial<Preferences> | undefined) };
}
export async function savePreferences(patch: Partial<Preferences>): Promise<Preferences> {
  const next = { ...(await getPreferences()), ...patch }; await chrome.storage.local.set({ [KEY]: next }); return next;
}
