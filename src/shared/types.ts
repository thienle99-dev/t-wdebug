export type SecretType = 'bearer-token' | 'jwt' | 'cookie' | 'api-key' | 'basic-auth' | 'client-secret' | 'password' | 'unknown';
export interface HeaderEntry { name: string; value: string; sensitive?: boolean; secretType?: SecretType }
export interface CookieEntry { name: string; value: string; domain?: string; path?: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: string }
export interface AuthInfo { type: 'bearer' | 'basic' | 'api-key' | 'cookie' | 'jwt' | 'unknown'; source: string; value?: string; decodedJwt?: { header?: unknown; payload?: unknown } }
export interface RequestRecord {
  id: string; tabId?: number; timestamp: number; page: { url?: string; title?: string };
  request: { method: string; url: string; protocol?: string; host?: string; path?: string; query: Record<string, string | string[]>; headers: HeaderEntry[]; cookies: CookieEntry[]; body?: { mimeType?: string; text?: string; json?: unknown; formData?: Record<string, unknown>; truncated?: boolean }; auth?: AuthInfo };
  response: { status: number; statusText?: string; headers: HeaderEntry[]; cookies?: CookieEntry[]; mimeType?: string; body?: { text?: string; json?: unknown; encoding?: string; truncated?: boolean; unavailableReason?: string } };
  timing?: { startedAt?: number; total?: number; dns?: number; connect?: number; ssl?: number; send?: number; wait?: number; receive?: number };
  meta?: { resourceType?: string; initiator?: string; fromCache?: boolean; ip?: string; size?: number };
  flags: { failed: boolean; hasAuth: boolean; hasSensitiveData: boolean; pinned: boolean };
}
export interface Preferences { captureEnabled: boolean; maxRequests: number; maxBodyBytes: number; includeSecretsInCopy: boolean; redactInAI: boolean; captureStaticAssets: boolean }
export const DEFAULT_PREFERENCES: Preferences = { captureEnabled: true, maxRequests: 500, maxBodyBytes: 1024 * 1024, includeSecretsInCopy: false, redactInAI: true, captureStaticAssets: false };
export type CaptureMessage = { type: 'capture:start' | 'capture:stop'; tabId: number };
