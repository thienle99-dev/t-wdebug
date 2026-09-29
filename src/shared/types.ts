export type SecretType = 'bearer-token' | 'jwt' | 'cookie' | 'api-key' | 'basic-auth' | 'client-secret' | 'password' | 'unknown';
export interface HeaderEntry { name: string; value: string; sensitive?: boolean; secretType?: SecretType }
export interface CookieEntry { name: string; value: string; domain?: string; path?: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: string }
export interface AuthInfo { type: 'bearer' | 'basic' | 'api-key' | 'cookie' | 'jwt' | 'unknown'; source: string; value?: string; decodedJwt?: { header?: unknown; payload?: unknown } }
export interface BodyContent { mimeType?: string; text?: string; json?: unknown; formData?: Record<string, unknown>; encoding?: string; truncated?: boolean; unavailableReason?: string }
export interface RequestRecord {
  id: string; source?: 'devtools-network' | 'fetch-hook' | 'xhr-hook'; tabId?: number; frameId?: number; timestamp: number; page: { url?: string; title?: string };
  request: { method: string; url: string; protocol?: string; host?: string; path?: string; query: Record<string, string | string[]>; headers: HeaderEntry[]; cookies: CookieEntry[]; body?: BodyContent; auth?: AuthInfo; credentials?: string };
  response: { status: number; statusText?: string; headers: HeaderEntry[]; cookies?: CookieEntry[]; mimeType?: string; body?: BodyContent };
  timing?: { startedAt?: number; total?: number; blocked?: number; dns?: number; connect?: number; ssl?: number; send?: number; wait?: number; receive?: number };
  stack?: StackFrame[];
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
  stack?: StackFrame[];
}
export interface StackFrame { functionName?: string; url?: string; line?: number; column?: number }
export interface UIElementRecord {
  kind: 'ui-snapshot'; id: string; tabId: number; frameId?: number; timestamp: number;
  selector: string; simpleSelector: string; domPath: string; tagName: string; idAttribute?: string; classList: string[];
  text?: string; html?: string; attributes: Record<string, string>;
  bounds: { x: number; y: number; width: number; height: number; top: number; right: number; bottom: number; left: number };
  styles: { computed: Record<string, string>; box: { margin: string; border: string; padding: string; content: string }; variables: Record<string, string> };
  ancestry: Array<{ selector: string; tagName: string; id?: string; classes: string[] }>;
  accessibility: { role?: string; name?: string; label?: string; labelledBy?: string; describedBy?: string; tabindex?: string; disabled: boolean; checks: string[] };
  visibility: { display: string; visibility: string; opacity: number; inViewport: boolean; clipped: boolean; covered: boolean; coveringSelector?: string };
  diagnostics: Array<{ severity: 'info' | 'warning' | 'error'; title: string; evidence: string }>;
  page: { url: string; viewportWidth: number; viewportHeight: number };
}
export interface EventRecord { kind: 'event'; id: string; tabId: number; timestamp: number; type: string; targetSelector?: string; key?: string; value?: string; stack?: StackFrame[] }
export interface ConsoleRecord { kind: 'console'; id: string; tabId: number; timestamp: number; level: 'error' | 'warning'; message: string; stack?: StackFrame[]; pageUrl?: string }
export interface MutationDebugRecord { kind: 'mutation'; id: string; tabId: number; timestamp: number; targetSelector?: string; change: 'attribute' | 'text' | 'child'; name?: string; before?: string; after?: string }
export interface PerformanceRecord { kind: 'performance'; id: string; tabId: number; timestamp: number; entryType: 'resource' | 'longtask' | 'layout-shift' | 'paint'; name?: string; duration: number; value?: number; size?: number }
export type DebugRecord = UIElementRecord | EventRecord | ConsoleRecord | MutationDebugRecord | PerformanceRecord;
export type IncomingDebugRecord = DebugRecord extends infer T ? T extends { tabId: number } ? Omit<T, 'tabId'> : never : never;
export interface DebugInsight { id: string; category: 'network' | 'auth' | 'ui' | 'css' | 'console' | 'performance' | 'accessibility'; severity: 'info' | 'warning' | 'error'; title: string; description: string; evidence: string[]; relatedRecordIds: string[] }
export interface RelatedFlow { id: string; startedAt: number; trigger?: { type: string; selector?: string }; events: Array<{ id: string; timestamp: number; type: string; label: string; recordId?: string }> }
export type AppearanceTheme = 'system' | 'light' | 'dark';
export interface Preferences { captureEnabled: boolean; maxRequests: number; maxBodyBytes: number; includeSecretsInCopy: boolean; redactInAI: boolean; captureStaticAssets: boolean; theme: AppearanceTheme; sidebarWidth: number }
export const DEFAULT_PREFERENCES: Preferences = { captureEnabled: true, maxRequests: 500, maxBodyBytes: 1024 * 1024, includeSecretsInCopy: false, redactInAI: true, captureStaticAssets: false, theme: 'system', sidebarWidth: 34 };
export type CaptureRuntimeMessage =
  | { type: 'capture:heartbeat'; tabId: number; active: boolean }
  | { type: 'capture:status'; tabId: number }
  | { type: 'capture:hook:start'; tabId: number; origin: string }
  | { type: 'capture:hook:stop'; tabId: number; origin: string }
  | { type: 'capture:hook:record'; payload: PageHookCapturePayload }
  | DebugRuntimeMessage;
export type DebugRuntimeMessage =
  | { type: 'debug:record'; payload: IncomingDebugRecord }
  | { type: 'debug:ui:pick'; tabId: number }
  | { type: 'debug:ui:stop'; tabId: number }
  | { type: 'debug:ui:picker'; enabled: boolean };
export type CaptureStatus = 'active' | 'inactive' | 'unknown';
