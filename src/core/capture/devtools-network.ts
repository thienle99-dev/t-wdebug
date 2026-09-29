import type { AuthInfo, CookieEntry, HeaderEntry, RequestRecord } from '../../shared/types';
import { saveRequest } from '../../storage/indexed-db';
import { getPreferences } from '../../storage/preferences';
import { markHeaders } from '../secrets';
import type { CaptureAdapter } from './capture-adapter';

interface HarCookie { name?: string; value?: string; domain?: string; path?: string; expires?: string; httpOnly?: boolean; secure?: boolean }
interface HarHeader { name?: string; value?: string }
interface HarParam { name?: string; value?: string; fileName?: string; contentType?: string }
interface HarPostData { mimeType?: string; text?: string; params?: HarParam[] }
interface HarEntry {
  startedDateTime?: string;
  time?: number;
  request?: { method?: string; url?: string; httpVersion?: string; headers?: HarHeader[]; cookies?: HarCookie[]; queryString?: Array<{ name?: string; value?: string }>; postData?: HarPostData };
  response?: { status?: number; statusText?: string; httpVersion?: string; headers?: HarHeader[]; cookies?: HarCookie[]; content?: { mimeType?: string; size?: number }; bodySize?: number; _fromDiskCache?: boolean };
  timings?: { blocked?: number; dns?: number; connect?: number; ssl?: number; send?: number; wait?: number; receive?: number };
  serverIPAddress?: string;
  connection?: string;
  _resourceType?: string;
  cache?: unknown;
}
interface ReadContent { text?: string; encoding?: string; unavailableReason?: string }
interface PageInfo { url?: string; title?: string }

const BINARY_MIME = /^(?:image\/|audio\/|video\/|font\/|application\/(?:octet-stream|pdf|zip|gzip|x-rar|x-7z|wasm))/i;
const STATIC_MIME = /^(?:image\/|audio\/|video\/|font\/|text\/css|application\/(?:javascript|x-javascript))/i;
const STATIC_RESOURCE = /^(?:image|media|font|stylesheet|script)$/i;
const API_PATH = /(?:^|\/)(?:api|graphql|rest)(?:\/|$)/i;

export function shouldCaptureHarEntry(entry: HarEntry, captureStaticAssets = false): boolean {
  const request = entry.request;
  if (!request?.url || !request.method) return false;
  let url: URL;
  try { url = new URL(request.url); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (captureStaticAssets) return true;

  const method = request.method.toUpperCase();
  const resourceType = entry._resourceType ?? '';
  const mimeType = entry.response?.content?.mimeType ?? headerValue(entry.response?.headers, 'content-type') ?? '';
  const requestMime = headerValue(request.headers, 'content-type') ?? '';
  if (STATIC_RESOURCE.test(resourceType) || STATIC_MIME.test(mimeType)) return false;
  if (/^(?:fetch|xhr|eventsource)$/i.test(resourceType)) return true;
  if (/json|graphql/i.test(mimeType) || /json|graphql|x-www-form-urlencoded|multipart\/form-data/i.test(requestMime)) return true;
  if (API_PATH.test(url.pathname) || /graphql/i.test(url.pathname)) return true;
  return !['GET', 'HEAD', 'OPTIONS'].includes(method);
}

export function createHarDedupeKey(entry: HarEntry, tabId: number): string {
  const request = entry.request;
  const body = request?.postData?.text ?? (request?.postData?.params ?? []).map((param) => `${param.name ?? ''}=${param.value ?? param.fileName ?? ''}`).join('&');
  const identity = [tabId, entry.startedDateTime ?? '', request?.method?.toUpperCase() ?? '', request?.url ?? '', body].join('\n');
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(identity)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  return `devtools-network:${tabId}:${hash.toString(16).padStart(16, '0')}`;
}

export function normalizeHarEntry(input: {
  entry: HarEntry;
  tabId: number;
  page?: PageInfo;
  responseContent?: string;
  responseEncoding?: string;
  responseUnavailableReason?: string;
  maxBodyBytes?: number;
}): RequestRecord | undefined {
  const { entry, tabId } = input;
  const request = entry.request;
  const response = entry.response;
  if (!request?.url || !request.method) return undefined;

  let url: URL;
  try { url = new URL(request.url); } catch { return undefined; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;

  const requestHeaders = markHeaders(toHeaders(request.headers));
  const responseHeaders = markHeaders(toHeaders(response?.headers));
  const requestMime = request.postData?.mimeType ?? headerValue(request.headers, 'content-type');
  const responseMime = response?.content?.mimeType ?? headerValue(response?.headers, 'content-type');
  const maxBodyBytes = Math.max(0, input.maxBodyBytes ?? 1024 * 1024);
  const requestBody = normalizeRequestBody(request.postData, requestMime, maxBodyBytes);
  const binaryResponse = BINARY_MIME.test(responseMime ?? '');
  const responseBody = binaryResponse
    ? { mimeType: responseMime, unavailableReason: 'Binary response body omitted.' }
    : normalizeBody(input.responseContent, responseMime, maxBodyBytes, input.responseUnavailableReason, input.responseEncoding);
  const parsedTimestamp = entry.startedDateTime ? Date.parse(entry.startedDateTime) : Number.NaN;
  const timestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now();
  const auth = detectAuth(requestHeaders);
  const status = Number.isFinite(response?.status) ? Number(response?.status) : 0;
  const requestCookies = toCookies(request.cookies);
  const responseCookies = toCookies(response?.cookies);
  const query: RequestRecord['request']['query'] = {};
  url.searchParams.forEach((value, key) => {
    const current = query[key];
    query[key] = current === undefined ? value : Array.isArray(current) ? [...current, value] : [current, value];
  });
  const contentLength = finiteNonNegative(response?.content?.size) ?? finiteNonNegative(response?.bodySize);
  const hasSensitiveData = requestHeaders.some((header) => header.sensitive) || responseHeaders.some((header) => header.sensitive) || requestCookies.length > 0 || responseCookies.length > 0;

  return {
    id: createHarDedupeKey(entry, tabId),
    source: 'devtools-network',
    tabId,
    timestamp,
    page: { url: input.page?.url, title: input.page?.title },
    request: {
      method: request.method.toUpperCase(), url: request.url, protocol: url.protocol, host: url.host, path: `${url.pathname}${url.search}`, query,
      headers: requestHeaders, cookies: requestCookies, body: requestBody, auth,
    },
    response: {
      status, statusText: response?.statusText || statusLabel(status), headers: responseHeaders, cookies: responseCookies,
      mimeType: responseMime, body: responseBody,
    },
    timing: {
      startedAt: timestamp, total: finiteNonNegative(entry.time), blocked: finiteNonNegative(entry.timings?.blocked),
      dns: finiteNonNegative(entry.timings?.dns), connect: finiteNonNegative(entry.timings?.connect), ssl: finiteNonNegative(entry.timings?.ssl),
      send: finiteNonNegative(entry.timings?.send), wait: finiteNonNegative(entry.timings?.wait), receive: finiteNonNegative(entry.timings?.receive),
    },
    meta: {
      resourceType: entry._resourceType, httpVersion: request.httpVersion || response?.httpVersion,
      serverIPAddress: entry.serverIPAddress, connection: entry.connection,
      fromCache: Boolean(response?._fromDiskCache) || status === 304, size: contentLength,
    },
    flags: { failed: status <= 0 || status >= 400, hasAuth: Boolean(auth) || requestHeaders.some((header) => header.sensitive) || requestCookies.length > 0, hasSensitiveData, pinned: false },
  };
}

export class DevToolsNetworkCaptureAdapter implements CaptureAdapter {
  private readonly tabId = chrome.devtools.inspectedWindow.tabId;
  private readonly seen = new Set<string>();
  private page: PageInfo = {};
  private started = false;
  private heartbeatTimer?: number;
  private readonly onRequestFinished = (entry: chrome.devtools.network.Request) => { void this.capture(entry as unknown as HarEntry); };
  private readonly onNavigated = () => { void this.readPageInfo().then((page) => { this.page = page; }); };

  isSupported(): boolean { return typeof chrome !== 'undefined' && Boolean(chrome.devtools?.network); }

  async start(): Promise<void> {
    if (this.started || !this.isSupported()) return;
    const preferences = await getPreferences();
    if (!preferences.captureEnabled) {
      await this.setHeartbeat(false);
      return;
    }
    this.started = true;
    this.page = await this.readPageInfo();
    chrome.devtools.network.onRequestFinished.addListener(this.onRequestFinished);
    chrome.devtools.network.onNavigated.addListener(this.onNavigated);
    await this.setHeartbeat(true);
    this.heartbeatTimer = window.setInterval(() => { void this.setHeartbeat(true); }, 5_000);
    try {
      const log = await this.readHar();
      await Promise.all((log?.entries ?? []).map((entry) => this.capture(entry as unknown as HarEntry)));
    } catch {
      // Existing HAR import can fail while live request capture continues.
    }
  }

  async stop(): Promise<void> {
    if (!this.started) { await this.setHeartbeat(false); return; }
    this.started = false;
    chrome.devtools.network.onRequestFinished.removeListener(this.onRequestFinished);
    chrome.devtools.network.onNavigated.removeListener(this.onNavigated);
    if (this.heartbeatTimer !== undefined) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    await this.setHeartbeat(false);
  }

  private async capture(entry: HarEntry): Promise<void> {
    try {
      const preferences = await getPreferences();
      if (!preferences.captureEnabled || !shouldCaptureHarEntry(entry, preferences.captureStaticAssets)) return;
      const id = createHarDedupeKey(entry, this.tabId);
      if (this.seen.has(id)) return;
      this.seen.add(id);
      const mimeType = entry.response?.content?.mimeType ?? headerValue(entry.response?.headers, 'content-type') ?? '';
      let content: ReadContent = {};
      if (BINARY_MIME.test(mimeType)) content.unavailableReason = 'Binary response body omitted.';
      else content = await getResponseContent(entry as HarEntry & { getContent?: (callback: (text: string, encoding: string) => void) => void }, preferences.maxBodyBytes);
      const record = normalizeHarEntry({
        entry, tabId: this.tabId, page: this.page, responseContent: content.text, responseEncoding: content.encoding,
        responseUnavailableReason: content.unavailableReason, maxBodyBytes: preferences.maxBodyBytes,
      });
      if (record) await saveRequest(record, preferences.maxRequests);
    } catch {
      // One malformed or unavailable HAR entry must not stop the capture listener.
    }
  }

  private readHar(): Promise<HARFormatLog | undefined> {
    return new Promise((resolve) => {
      try { chrome.devtools.network.getHAR((log) => resolve(log)); }
      catch { resolve(undefined); }
    });
  }

  private readPageInfo(): Promise<PageInfo> {
    return new Promise((resolve) => {
      try {
        chrome.devtools.inspectedWindow.eval('({ url: location.href, title: document.title })', (result, exception) => {
          if (exception?.isException || !result || typeof result !== 'object') { resolve({}); return; }
          const value = result as PageInfo;
          resolve({ url: typeof value.url === 'string' ? value.url : undefined, title: typeof value.title === 'string' ? value.title : undefined });
        });
      } catch { resolve({}); }
    });
  }

  private async setHeartbeat(active: boolean): Promise<void> {
    try { await chrome.runtime.sendMessage({ type: 'capture:heartbeat', tabId: this.tabId, active }); } catch { /* The heartbeat expires if the worker is unavailable. */ }
  }
}

function getResponseContent(entry: HarEntry & { getContent?: (callback: (text: string, encoding: string) => void) => void }, maxBodyBytes: number): Promise<ReadContent> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: ReadContent) => { if (!settled) { settled = true; window.clearTimeout(timeout); resolve(value); } };
    const timeout = window.setTimeout(() => finish({ unavailableReason: 'Response body is unavailable from DevTools.' }), 4_000);
    if (!entry.getContent) { finish({ unavailableReason: 'DevTools did not provide a response body reader.' }); return; }
    try {
      entry.getContent((content, encoding) => {
        if (!content) { finish({ text: content ?? '', encoding: encoding || undefined }); return; }
        if (encoding === 'base64') {
          const mimeType = entry.response?.content?.mimeType ?? '';
          if (BINARY_MIME.test(mimeType)) { finish({ unavailableReason: 'Binary response body omitted.' }); return; }
          try {
            const maxEncoded = Math.ceil((maxBodyBytes + 2) / 3) * 4;
            const bounded = content.length > maxEncoded ? content.slice(0, maxEncoded) : content;
            const binary = atob(bounded);
            const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
            finish({ text: new TextDecoder().decode(bytes), encoding: undefined });
          } catch { finish({ unavailableReason: 'Encoded response body could not be decoded.' }); }
          return;
        }
        finish({ text: content, encoding: encoding || undefined });
      });
    } catch { finish({ unavailableReason: 'Response body is unavailable from DevTools.' }); }
  });
}

function normalizeRequestBody(postData: HarPostData | undefined, mimeType: string | undefined, maxBytes: number): RequestRecord['request']['body'] {
  if (!postData) return undefined;
  const formData = postData.params?.length ? paramsToFormData(postData.params) : undefined;
  if (postData.text !== undefined) return normalizeBody(postData.text, mimeType, maxBytes, undefined, undefined, formData);
  return formData ? { mimeType, formData } : undefined;
}

function normalizeBody(text: string | undefined, mimeType: string | undefined, maxBytes: number, unavailableReason?: string, encoding?: string, formData?: Record<string, unknown>): RequestRecord['request']['body'] {
  if (text === undefined) return unavailableReason ? { mimeType, unavailableReason, encoding } : undefined;
  if (text === '' && !formData) return undefined;
  const bytes = new TextEncoder().encode(text);
  const truncated = bytes.byteLength > maxBytes;
  const safeText = truncated ? new TextDecoder().decode(bytes.slice(0, maxBytes)) : text;
  const body: NonNullable<RequestRecord['request']['body']> = { mimeType, text: safeText, ...(formData ? { formData } : {}), ...(truncated ? { truncated: true } : {}) };
  if (/json|graphql/i.test(mimeType ?? '')) { try { body.json = JSON.parse(safeText); } catch { /* Keep malformed or truncated JSON as text. */ } }
  if (/application\/x-www-form-urlencoded/i.test(mimeType ?? '')) body.formData = parseFormUrlEncoded(safeText);
  return { ...body, ...(encoding ? { encoding } : {}) };
}

function parseFormUrlEncoded(text: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  new URLSearchParams(text).forEach((value, key) => {
    const previous = result[key];
    result[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  });
  return result;
}

function paramsToFormData(params: HarParam[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const param of params) {
    if (!param.name) continue;
    const value = param.fileName ? { fileName: param.fileName, contentType: param.contentType } : param.value ?? '';
    const previous = result[param.name];
    result[param.name] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return result;
}

function toHeaders(headers?: HarHeader[]): HeaderEntry[] {
  return (headers ?? []).flatMap((header) => typeof header.name === 'string' ? [{ name: header.name, value: String(header.value ?? '') }] : []);
}

function headerValue(headers: HarHeader[] | undefined, name: string): string | undefined { return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value; }

function toCookies(cookies?: HarCookie[]): CookieEntry[] {
  return (cookies ?? []).flatMap((cookie) => typeof cookie.name === 'string' ? [{
    name: cookie.name, value: cookie.value ?? '', domain: cookie.domain, path: cookie.path,
    expires: cookie.expires ? Date.parse(cookie.expires) : undefined, httpOnly: cookie.httpOnly, secure: cookie.secure,
  }] : []);
}

function detectAuth(headers: HeaderEntry[]): AuthInfo | undefined {
  const header = headers.find((item) => /^authorization$/i.test(item.name));
  if (header) {
    const scheme = header.value.match(/^\s*(Bearer|Basic)\s+(.+)$/i);
    if (!scheme) return { type: 'unknown', source: header.name, value: header.value };
    const token = scheme[2]!;
    if (scheme[1]!.toLowerCase() === 'basic') return { type: 'basic', source: header.name, value: token };
    const jwt = token.match(/^([\w-]+)\.([\w-]+)\.([\w-]+)$/);
    if (!jwt) return { type: 'bearer', source: header.name, value: token };
    try {
      const decode = (value: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (character) => character.charCodeAt(0))));
      return { type: 'jwt', source: header.name, value: token, decodedJwt: { header: decode(jwt[1]!), payload: decode(jwt[2]!) } };
    } catch { return { type: 'jwt', source: header.name, value: token }; }
  }
  const key = headers.find((item) => /api[-_]?key/i.test(item.name));
  return key ? { type: 'api-key', source: key.name, value: key.value } : undefined;
}

function finiteNonNegative(value: number | undefined): number | undefined { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined; }
function statusLabel(status: number): string | undefined { return ({ 200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 422: 'Unprocessable Entity', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' } as Record<number, string>)[status]; }
