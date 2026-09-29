import type { AuthInfo, HeaderEntry, PageHookCapturePayload, RequestRecord } from '../../shared/types';
import { markHeaders } from '../secrets';

const BINARY_MIME = /^(?:image\/|audio\/|video\/|font\/|application\/(?:octet-stream|pdf|zip|gzip|wasm))/i;

export function normalizePageHookCapture(payload: PageHookCapturePayload, tabId: number, tabUrl?: string): RequestRecord | undefined {
  if (!payload || !payload.request || !payload.response || !Number.isInteger(tabId)) return undefined;
  let url: URL;
  try { url = new URL(payload.request.url); } catch { return undefined; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  const requestHeaders = markHeaders(toHeaders(payload.request.headers));
  const responseHeaders = markHeaders(toHeaders(payload.response.headers));
  const requestMime = headerValue(requestHeaders, 'content-type');
  const responseMime = payload.response.mimeType ?? headerValue(responseHeaders, 'content-type');
  const requestBody = parseBody(payload.request.body, requestMime, payload.request.bodyTruncated);
  const responseBody = BINARY_MIME.test(responseMime ?? '')
    ? { mimeType: responseMime, unavailableReason: 'Binary response body omitted.' }
    : parseBody(payload.response.body, responseMime, payload.response.bodyTruncated, payload.response.unavailableReason);
  const auth = extractAuth(requestHeaders);
  const query: RequestRecord['request']['query'] = {};
  url.searchParams.forEach((value, key) => {
    const current = query[key]; query[key] = current === undefined ? value : Array.isArray(current) ? [...current, value] : [current, value];
  });
  const timestamp = Number.isFinite(payload.timestamp) ? payload.timestamp : Date.now();
  const sensitive = requestHeaders.some((header) => header.sensitive) || responseHeaders.some((header) => header.sensitive);
  const pageUrl = safeHttpUrl(payload.pageUrl) ? payload.pageUrl : safeHttpUrl(tabUrl) ? tabUrl : undefined;
  const identity = `${tabId}\n${timestamp}\n${payload.request.method}\n${url.href}\n${payload.request.body ?? ''}`;
  return {
    id: `page-hook:${tabId}:${hash(identity)}`,
    source: payload.source,
    tabId,
    timestamp,
    page: { url: pageUrl },
    request: {
      method: payload.request.method.toUpperCase(), url: payload.request.url, protocol: url.protocol, host: url.host,
      path: `${url.pathname}${url.search}`, query, headers: requestHeaders, cookies: [], body: requestBody,
      auth, ...(payload.request.credentials ? { credentials: payload.request.credentials } : {}),
    },
    response: {
      status: Number.isFinite(payload.response.status) ? payload.response.status : 0,
      statusText: payload.response.statusText ?? '', headers: responseHeaders, mimeType: responseMime, body: responseBody,
    },
    timing: { startedAt: timestamp, total: finiteNonNegative(payload.timing?.total) },
    meta: { resourceType: payload.source === 'fetch-hook' ? 'fetch' : 'xhr', size: byteLength(payload.response.body) },
    flags: { failed: payload.response.status <= 0 || payload.response.status >= 400, hasAuth: Boolean(auth) || requestHeaders.some((header) => header.sensitive), hasSensitiveData: sensitive, pinned: false },
  };
}

function parseBody(text: string | undefined, mimeType?: string, truncated = false, unavailableReason?: string): RequestRecord['request']['body'] {
  if (text === undefined) return unavailableReason ? { mimeType, unavailableReason, ...(truncated ? { truncated: true } : {}) } : undefined;
  if (text === '' && !truncated) return undefined;
  const bounded = limitUtf8(text, 1024 * 1024);
  const isTruncated = truncated || bounded.truncated;
  const body: NonNullable<RequestRecord['request']['body']> = { mimeType, text: bounded.text, ...(isTruncated ? { truncated: true } : {}) };
  if (/json|graphql/i.test(mimeType ?? '') && !isTruncated) { try { body.json = JSON.parse(bounded.text); } catch { /* Preserve malformed JSON as text. */ } }
  if (/application\/x-www-form-urlencoded/i.test(mimeType ?? '')) {
    const data: Record<string, string | string[]> = {};
    new URLSearchParams(bounded.text).forEach((value, key) => { const prior = data[key]; data[key] = prior === undefined ? value : Array.isArray(prior) ? [...prior, value] : [prior, value]; });
    body.formData = data;
  }
  if (/multipart\/form-data/i.test(mimeType ?? '')) {
    try { const parsed: unknown = JSON.parse(bounded.text); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body.formData = parsed as Record<string, unknown>; }
    catch { /* Native fetch multipart bodies remain available as raw text. */ }
  }
  return body;
}

function limitUtf8(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return { text: value, truncated: false };
  let low = 0; let high = Math.min(value.length, maxBytes);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(value.slice(0, middle)).byteLength <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return { text: value.slice(0, low), truncated: true };
}

function toHeaders(values?: Record<string, string>): HeaderEntry[] {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return [];
  return Object.entries(values).slice(0, 200).map(([name, value]) => ({ name: name.slice(0, 256), value: String(value).slice(0, 8192) }));
}

function headerValue(headers: HeaderEntry[], name: string): string | undefined { return headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value; }
function finiteNonNegative(value?: number): number | undefined { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined; }
function byteLength(value?: string): number | undefined { return value === undefined ? undefined : new TextEncoder().encode(value).byteLength; }
function safeHttpUrl(value?: string): boolean { try { const url = new URL(value ?? ''); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; } }
function hash(value: string): string { let result = 2166136261; for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619); return (result >>> 0).toString(16); }

function extractAuth(headers: HeaderEntry[]): AuthInfo | undefined {
  const header = headers.find((item) => /^authorization$/i.test(item.name));
  if (!header) return undefined;
  const match = header.value.match(/^\s*(Bearer|Basic)\s+(.+)$/i);
  if (!match) return { type: 'unknown', source: header.name, value: header.value };
  if (match[1]!.toLowerCase() === 'basic') return { type: 'basic', source: header.name, value: match[2] };
  const value = match[2]!; const jwt = decodeJwt(value);
  return { type: jwt ? 'jwt' : 'bearer', source: header.name, value, ...(jwt ? { decodedJwt: jwt } : {}) };
}

function decodeJwt(token: string): AuthInfo['decodedJwt'] | undefined {
  const parts = token.split('.'); if (parts.length !== 3) return undefined;
  try {
    const decode = (part: string) => JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='))) as unknown;
    return { header: decode(parts[0]!), payload: decode(parts[1]!) };
  } catch { return undefined; }
}
