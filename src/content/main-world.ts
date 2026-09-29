type HookSource = 'fetch-hook' | 'xhr-hook';
interface HookPayload {
  source: HookSource;
  timestamp: number;
  pageUrl: string;
  request: { method: string; url: string; headers: Record<string, string>; body?: string; bodyTruncated?: boolean; credentials?: string };
  response: { status: number; statusText?: string; headers: Record<string, string>; body?: string; bodyTruncated?: boolean; mimeType?: string; unavailableReason?: string };
  timing: { total: number };
}
interface XhrMetadata { method: string; url: string; headers: Record<string, string> }
interface HookState { enabled: boolean }

declare global { interface Window { __API_LENS_HOOK__?: HookState } }

(() => {
  const prior = window.__API_LENS_HOOK__;
  if (prior) { prior.enabled = true; return; }

  const state: HookState = { enabled: true };
  window.__API_LENS_HOOK__ = state;
  const maxBodyBytes = 1024 * 1024;
  const pending: HookPayload[] = [];
  let bridgeReady = false;
  const binaryMime = /^(?:image\/|audio\/|video\/|font\/|application\/(?:octet-stream|pdf|zip|gzip|wasm))/i;
  const ignoredMime = /^(?:text\/css|application\/(?:javascript|x-javascript))/i;
  const apiPath = /(?:^|\/)(?:api|graphql|rest)(?:\/|$)/i;

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== window || !isObject(event.data)) return;
    const message = event.data as { source?: string; type?: string; enabled?: boolean };
    if (message.source === 'API_LENS_BRIDGE' && message.type === 'READY') { bridgeReady = true; flush(); }
    if (message.source === 'API_LENS_BRIDGE' && message.type === 'SET_ENABLED') state.enabled = message.enabled === true;
  });
  // The bridge is injected first. Hello makes readiness deterministic even if its
  // initial READY message happened before this MAIN-world listener existed.
  window.postMessage({ source: 'API_LENS_HOOK', type: 'HELLO' }, '*');

  function emit(payload: HookPayload): void {
    if (!state.enabled) return;
    if (bridgeReady) window.postMessage({ source: 'API_LENS', type: 'CAPTURE', payload }, '*');
    else { pending.push(payload); if (pending.length > 40) pending.shift(); }
  }
  function flush(): void { while (pending.length) window.postMessage({ source: 'API_LENS', type: 'CAPTURE', payload: pending.shift() }, '*'); }
  function pageUrl(): string { try { return location.href.slice(0, 4096); } catch { return ''; } }
  function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object'; }
  function shouldCapture(method: string, url: string, requestMime: string, responseMime: string): boolean {
    if (!/^https?:/i.test(url)) return false;
    if (binaryMime.test(responseMime) || ignoredMime.test(responseMime)) return false;
    if (apiPath.test(safePath(url)) || /graphql/i.test(url)) return true;
    if (/json|graphql|x-www-form-urlencoded|multipart\/form-data/i.test(`${requestMime} ${responseMime}`)) return true;
    return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
  }
  function safePath(url: string): string { try { return new URL(url).pathname; } catch { return url; } }
  function headersToObject(headers: Headers): Record<string, string> {
    const output: Record<string, string> = {};
    headers.forEach((value, name) => { if (Object.keys(output).length < 200) output[name] = value.slice(0, 8192); });
    return output;
  }
  function requestHeaders(request: Request): Record<string, string> { try { return headersToObject(request.headers); } catch { return {}; } }
  async function readBody(body: ReadableStream<Uint8Array> | null): Promise<{ text?: string; truncated?: boolean }> {
    if (!body) return {};
    const reader = body.getReader(); const chunks: Uint8Array[] = []; let size = 0; let truncated = false;
    try {
      while (size <= maxBodyBytes) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        const remaining = maxBodyBytes - size;
        if (value.byteLength > remaining) { chunks.push(value.slice(0, Math.max(0, remaining))); size = maxBodyBytes; truncated = true; await reader.cancel(); break; }
        chunks.push(value); size += value.byteLength;
      }
      const joined = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
      return { text: new TextDecoder().decode(joined), ...(truncated ? { truncated: true } : {}) };
    } catch { try { await reader.cancel(); } catch { /* Stream already closed. */ } return { text: undefined }; }
    finally { try { reader.releaseLock(); } catch { /* Reader was cancelled. */ } }
  }
  function mimeOf(headers: Headers): string { try { return headers.get('content-type') ?? ''; } catch { return ''; } }
  const nativeFetch = window.fetch;
  window.fetch = function apiLensFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (!state.enabled) return nativeFetch.call(this, input, init);
    let request: Request;
    try { request = new Request(input, init); } catch { return nativeFetch.call(this, input, init); }
    const startedAt = performance.now(); const timestamp = Date.now();
    let requestInfo: Promise<{ text?: string; truncated?: boolean }> = Promise.resolve({});
    try { if (request.method !== 'GET' && request.method !== 'HEAD') requestInfo = readBody(request.clone().body); } catch { /* Body inspection must not block the application's fetch. */ }
    let responsePromise: Promise<Response>;
    try { responsePromise = nativeFetch.call(this, input, init); } catch (error) { throw error; }
    return responsePromise.then((response) => {
      void (async () => {
        const responseMime = mimeOf(response.headers);
        if (!shouldCapture(request.method, request.url, mimeOf(request.headers), responseMime)) return;
        const requestBody = await requestInfo;
        let responseBody: { text?: string; truncated?: boolean } = {};
        if (!/text\/event-stream/i.test(responseMime) && !binaryMime.test(responseMime)) {
          try { responseBody = await readBody(response.clone().body); } catch { responseBody = {}; }
        }
        emit({ source: 'fetch-hook', timestamp, pageUrl: pageUrl(), request: {
          method: request.method.toUpperCase(), url: request.url, headers: requestHeaders(request), body: requestBody.text,
          bodyTruncated: requestBody.truncated, credentials: request.credentials,
        }, response: {
          status: response.status, statusText: response.statusText, headers: headersToObject(response.headers), body: responseBody.text,
          bodyTruncated: responseBody.truncated, mimeType: responseMime,
          ...(!responseBody.text && response.status !== 204 ? { unavailableReason: 'Response body was empty or could not be read by the page hook.' } : {}),
        }, timing: { total: performance.now() - startedAt } });
      })().catch(() => undefined);
      return response;
    }, (error: unknown) => {
      void requestInfo.then((requestBody) => emit({ source: 'fetch-hook', timestamp, pageUrl: pageUrl(), request: {
        method: request.method.toUpperCase(), url: request.url, headers: requestHeaders(request), body: requestBody.text,
        bodyTruncated: requestBody.truncated, credentials: request.credentials,
      }, response: { status: 0, statusText: 'Network Error', headers: {}, unavailableReason: error instanceof Error ? error.message.slice(0, 300) : 'Fetch failed.' }, timing: { total: performance.now() - startedAt } })).catch(() => undefined);
      throw error;
    });
  };

  const xhrPrototype = XMLHttpRequest.prototype as unknown as Record<string, (...args: any[]) => any>;
  const nativeOpen = xhrPrototype.open!;
  const nativeSetHeader = xhrPrototype.setRequestHeader!;
  const nativeSend = xhrPrototype.send!;
  xhrPrototype.open = function apiLensXhrOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]): any {
    let resolvedUrl = String(url);
    try { resolvedUrl = new URL(resolvedUrl, location.href).href; } catch { /* Preserve native open validation behavior. */ }
    (this as XMLHttpRequest & { __apiLens?: XhrMetadata }).__apiLens = { method: String(method).toUpperCase(), url: resolvedUrl, headers: {} };
    return nativeOpen.call(this, method, url, ...rest);
  };
  xhrPrototype.setRequestHeader = function apiLensXhrSetHeader(this: XMLHttpRequest, name: string, value: string): any {
    const metadata = (this as XMLHttpRequest & { __apiLens?: XhrMetadata }).__apiLens;
    if (metadata && Object.keys(metadata.headers).length < 200) metadata.headers[name] = String(value).slice(0, 8192);
    return nativeSetHeader.call(this, name, value);
  };
  xhrPrototype.send = function apiLensXhrSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): any {
    const xhr = this; const metadata = (xhr as XMLHttpRequest & { __apiLens?: XhrMetadata }).__apiLens;
    if (!metadata || !state.enabled) return nativeSend.call(this, body);
    const started = performance.now(); const timestamp = Date.now(); const requestBody = serializeXhrBody(body);
    xhr.addEventListener('loadend', () => {
      try {
        let responseText: string | undefined;
        if (xhr.responseType === '' || xhr.responseType === 'text') responseText = xhr.responseText;
        else if (xhr.responseType === 'json' && xhr.response !== null) responseText = JSON.stringify(xhr.response);
        const responseHeaders = parseXhrHeaders(xhr.getAllResponseHeaders());
        const responseMime = responseHeaders['content-type'] ?? '';
        const requestMime = metadata.headers['content-type'] ?? '';
        if (!shouldCapture(metadata.method, xhr.responseURL || metadata.url, requestMime, responseMime)) return;
        emit({ source: 'xhr-hook', timestamp, pageUrl: pageUrl(), request: { method: metadata.method, url: metadata.url, headers: metadata.headers, body: requestBody.text, bodyTruncated: requestBody.truncated }, response: {
          status: xhr.status, statusText: xhr.statusText, headers: responseHeaders, body: responseText?.slice(0, maxBodyBytes),
          bodyTruncated: (responseText?.length ?? 0) > maxBodyBytes, mimeType: responseMime,
          ...(!responseText && xhr.status !== 204 ? { unavailableReason: 'XHR response body is unavailable for this response type.' } : {}),
        }, timing: { total: performance.now() - started } });
      } catch { /* Capture must never interfere with application XHR behavior. */ }
    }, { once: true });
    return nativeSend.call(this, body);
  };

  function serializeXhrBody(body: Document | XMLHttpRequestBodyInit | null | undefined): { text?: string; truncated?: boolean } {
    if (body === null || body === undefined) return {};
    try {
      if (typeof body === 'string') return { text: body.slice(0, maxBodyBytes), ...(body.length > maxBodyBytes ? { truncated: true } : {}) };
      if (body instanceof URLSearchParams) { const text = body.toString(); return { text: text.slice(0, maxBodyBytes), ...(text.length > maxBodyBytes ? { truncated: true } : {}) }; }
      if (body instanceof FormData) {
        const entries: Record<string, string | string[]> = {};
        for (const [key, value] of body.entries()) {
          const safeValue = typeof value === 'string' ? value.slice(0, 8192) : `[File: ${value.name}; ${value.size} bytes]`;
          const previous = entries[key]; entries[key] = previous === undefined ? safeValue : Array.isArray(previous) ? [...previous, safeValue] : [previous, safeValue];
        }
        const text = JSON.stringify(entries); return { text: text.slice(0, maxBodyBytes), ...(text.length > maxBodyBytes ? { truncated: true } : {}) };
      }
      if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return { text: '[Binary request body omitted.]' };
      if (body instanceof Blob) return { text: `[Blob request body omitted; ${body.size} bytes.]` };
    } catch { /* Unsupported request body, but preserve the network call. */ }
    return {};
  }
  function parseXhrHeaders(raw: string): Record<string, string> {
    const output: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) { const index = line.indexOf(':'); if (index > 0) output[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim().slice(0, 8192); }
    return output;
  }
})();
