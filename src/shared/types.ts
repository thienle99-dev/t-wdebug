export type SecretType = 'bearer-token' | 'jwt' | 'cookie' | 'api-key' | 'basic-auth' | 'client-secret' | 'password' | 'unknown';
export interface HeaderEntry { name: string; value: string; sensitive?: boolean; secretType?: SecretType }
export interface CookieEntry { name: string; value: string; domain?: string; path?: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: string }
export interface AuthInfo { type: 'bearer' | 'basic' | 'api-key' | 'cookie' | 'jwt' | 'unknown'; source: string; value?: string; decodedJwt?: { header?: unknown; payload?: unknown } }
export interface BodyContent { mimeType?: string; text?: string; json?: unknown; formData?: Record<string, unknown>; encoding?: string; truncated?: boolean; unavailableReason?: string }
export interface RequestRecord {
  id: string; source?: 'devtools-network' | 'fetch-hook' | 'xhr-hook'; tabId?: number; timestamp: number; page: { url?: string; title?: string };
  request: { method: string; url: string; protocol?: string; host?: string; path?: string; query: Record<string, string | string[]>; headers: HeaderEntry[]; cookies: CookieEntry[]; body?: BodyContent; auth?: AuthInfo; credentials?: string };
  response: { status: number; statusText?: string; headers: HeaderEntry[]; cookies?: CookieEntry[]; mimeType?: string; body?: BodyContent };
  timing?: { startedAt?: number; total?: number; blocked?: number; dns?: number; connect?: number; ssl?: number; send?: number; wait?: number; receive?: number };
  meta?: { resourceType?: string; initiator?: string; fromCache?: boolean; ip?: string; size?: number; httpVersion?: string; serverIPAddress?: string; connection?: string };
  flags: { failed: boolean; hasAuth: boolean; hasSensitiveData: boolean; pinned: boolean };
}
export interface PageHookCapturePayload {
  source: 'fetch-hook' | 'xhr-hook';
  timestamp: number;
  pageUrl?: string;
  request: { method: string; url: string; headers?: Record<string, string>; body?: string; bodyTruncated?: boolean; credentials?: string };
  response: { status: number; statusText?: string; headers?: Record<string, string>; body?: string; bodyTruncated?: boolean; mimeType?: string; unavailableReason?: string };
  timing?: { total?: number };
}
export type AppearanceTheme = 'system' | 'light' | 'dark';
export interface Preferences { captureEnabled: boolean; maxRequests: number; maxBodyBytes: number; includeSecretsInCopy: boolean; redactInAI: boolean; captureStaticAssets: boolean; theme: AppearanceTheme; sidebarWidth: number }
export const DEFAULT_PREFERENCES: Preferences = { captureEnabled: true, maxRequests: 500, maxBodyBytes: 1024 * 1024, includeSecretsInCopy: false, redactInAI: true, captureStaticAssets: false, theme: 'system', sidebarWidth: 34 };
export type CaptureRuntimeMessage =
  | { type: 'capture:heartbeat'; tabId: number; active: boolean }
  | { type: 'capture:status'; tabId: number }
  | { type: 'capture:hook:start'; tabId: number; origin: string }
  | { type: 'capture:hook:stop'; tabId: number; origin: string }
  | { type: 'capture:hook:record'; payload: PageHookCapturePayload };
export type CaptureStatus = 'active' | 'inactive' | 'unknown';
