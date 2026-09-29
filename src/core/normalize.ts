import type { AuthInfo, HeaderEntry, RequestRecord } from '../shared/types';
import { markHeaders } from './secrets';

export interface CDPRequestEvent { requestId: string; request: { url: string; method: string; headers?: Record<string, unknown>; postData?: string }; timestamp: number; wallTime?: number; type?: string; initiator?: { url?: string; type?: string } }
export interface CDPResponseEvent { status?: number; statusText?: string; headers?: Record<string, unknown>; mimeType?: string; fromDiskCache?: boolean; remoteIPAddress?: string; encodedDataLength?: number }
export function headersFromObject(raw?: Record<string, unknown>): HeaderEntry[] {
  if (!raw) return [];
  return Object.entries(raw).flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map((v) => ({ name, value: String(v) })));
}
function parseBody(text?: string, mimeType?: string, maxBytes = 1024 * 1024) {
  if (!text) return undefined;
  const truncated = new TextEncoder().encode(text).byteLength > maxBytes;
  const safeText = truncated ? new TextDecoder().decode(new TextEncoder().encode(text).slice(0, maxBytes)) : text;
  const body: NonNullable<RequestRecord['request']['body']> = { text: safeText, mimeType, ...(truncated ? { truncated: true } : {}) };
  if (/json/i.test(mimeType ?? '')) { try { body.json = JSON.parse(safeText); } catch { /* Keep malformed JSON as text. */ } }
  return body;
}
function getAuth(headers: HeaderEntry[]): AuthInfo | undefined {
  const auth = headers.find((header) => /^authorization$/i.test(header.name));
  if (auth) {
    const value = auth.value;
    if (/^Bearer\s+/i.test(value)) return { type: /^Bearer\s+eyJ/i.test(value) ? 'jwt' : 'bearer', source: auth.name, value };
    if (/^Basic\s+/i.test(value)) return { type: 'basic', source: auth.name, value };
    return { type: 'unknown', source: auth.name, value };
  }
  const key = headers.find((header) => /api[-_]?key/i.test(header.name));
  return key ? { type: 'api-key', source: key.name, value: key.value } : undefined;
}
export function normalizeRecord(input: { tabId: number; pageUrl?: string; pageTitle?: string; request: CDPRequestEvent; response?: CDPResponseEvent; requestHeaders?: Record<string, unknown>; responseHeaders?: Record<string, unknown>; requestBody?: string; responseBody?: string; responseEncoding?: string; startedAtMs: number; totalMs?: number; maxBodyBytes?: number; unavailableReason?: string }): RequestRecord | undefined {
  const { request } = input;
  let parsed: URL;
  try { parsed = new URL(request.request.url); } catch { return undefined; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
  const reqHeaders = markHeaders(headersFromObject({ ...(request.request.headers ?? {}), ...(input.requestHeaders ?? {}) }));
  const resHeaders = markHeaders(headersFromObject(input.responseHeaders ?? input.response?.headers));
  const query: RequestRecord['request']['query'] = {};
  parsed.searchParams.forEach((value, key) => { const current = query[key]; query[key] = current === undefined ? value : Array.isArray(current) ? [...current, value] : [current, value]; });
  const reqBodyText = input.requestBody ?? request.request.postData;
  const responseText = input.responseBody;
  const mimeType = input.response?.mimeType ?? resHeaders.find((h) => /^content-type$/i.test(h.name))?.value;
  const responseBody = responseText === undefined
    ? (input.unavailableReason ? { unavailableReason: input.unavailableReason } : undefined)
    : { ...parseBody(responseText, mimeType, input.maxBodyBytes), encoding: input.responseEncoding };
  const id = `${input.tabId}:${request.requestId}`;
  const hasAuth = Boolean(getAuth(reqHeaders) || reqHeaders.some((h) => h.sensitive));
  const record: RequestRecord = {
    id, tabId: input.tabId, timestamp: input.startedAtMs,
    page: { url: input.pageUrl, title: input.pageTitle },
    request: { method: request.request.method.toUpperCase(), url: request.request.url, protocol: parsed.protocol, host: parsed.host, path: `${parsed.pathname}${parsed.search}`, query, headers: reqHeaders, cookies: [], body: parseBody(reqBodyText, reqHeaders.find((h) => /^content-type$/i.test(h.name))?.value, input.maxBodyBytes), auth: getAuth(reqHeaders) },
    response: { status: input.response?.status ?? 0, statusText: input.response?.statusText, headers: resHeaders, mimeType, body: responseBody },
    timing: { startedAt: input.startedAtMs, total: input.totalMs },
    meta: { resourceType: request.type, initiator: request.initiator?.url ?? request.initiator?.type, fromCache: input.response?.fromDiskCache, ip: input.response?.remoteIPAddress, size: input.response?.encodedDataLength },
    flags: { failed: !input.response || (input.response.status ?? 0) >= 400, hasAuth, hasSensitiveData: reqHeaders.some((h) => h.sensitive) || resHeaders.some((h) => h.sensitive), pinned: false },
  };
  return record;
}
