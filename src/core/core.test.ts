import { describe, expect, it } from 'vitest';
import { demoRequests } from './fixtures';
import { toAIPrompt, toCurl, toFetch, toAxios, toPythonRequests, toPostman, toRawHttp } from './formatters';
import { detectSecret, redactRecord } from './secrets';
import { formatBody } from './body-format';
import { createHarDedupeKey, normalizeHarEntry, shouldCaptureHarEntry } from './capture/devtools-network';

describe('response body formatting', () => {
  it('pretty-prints valid JSON and preserves the raw representation', () => {
    const compact = '{"ok":true,"items":[1,2]}';
    expect(formatBody(compact, 'pretty')).toBe(JSON.stringify({ ok: true, items: [1, 2] }, null, 2));
    expect(formatBody(compact, 'raw')).toBe(compact);
  });
  it('leaves malformed JSON and plain text unchanged', () => {
    expect(formatBody('{"unfinished":', 'pretty')).toBe('{"unfinished":');
    expect(formatBody('not JSON\nplain text', 'pretty')).toBe('not JSON\nplain text');
    expect(formatBody(undefined, 'pretty')).toBe('');
  });
});

describe('secret detection and redaction', () => {
  it('detects authorization, API keys, JWTs, and passwords', () => {
    expect(detectSecret('Authorization', 'Bearer abc')).toBe('bearer-token');
    expect(detectSecret('x-api-key', 'abc')).toBe('api-key');
    expect(detectSecret('x-custom', 'eyJabcdefgh.eyJabcdefgh.signature')).toBe('jwt');
    expect(detectSecret('password', 'a secret')).toBe('client-secret');
  });
  it('redacts auth headers and secrets nested in request text before AI prompting', () => {
    const record = demoRequests[1]!;
    const safe = redactRecord(record);
    expect(safe.request.headers[0]?.value).toContain('[REDACTED');
    expect(toAIPrompt(record)).not.toContain('demo-secret');
    expect(toAIPrompt(record)).not.toContain('eyJhbGci');
  });
  it('redacts sensitive form fields in HAR parameter bodies', () => {
    const record = { ...demoRequests[0]!, request: { ...demoRequests[0]!.request, body: { mimeType: 'multipart/form-data', formData: { username: 'ada', password: 'private-value' } } } };
    const safe = redactRecord(record);
    expect(safe.request.body?.formData?.password).toBe('[REDACTED]');
  });
});

describe('request formatters', () => {
  const record = { ...demoRequests[1]!, request: { ...demoRequests[1]!.request, url: "https://api.example.test/quote?q=a'b&access_token=query-secret", body: { text: `{"note":"line 1\nline '2' ☃","ok":true}`, json: { note: "line 1\nline '2' ☃", ok: true } } } };
  it('quotes shell arguments and includes an authenticated request when requested', () => {
    const curl = toCurl(record, true);
    expect(curl).toContain("'\\''");
    expect(curl).toContain('Authorization: Bearer');
    const safeCurl = toCurl(record, false);
    expect(safeCurl).toContain('[REDACTED');
    expect(safeCurl).not.toContain('query-secret');
  });
  it('produces fetch, Axios, Python, and valid Postman structures', () => {
    expect(toFetch(record)).toContain('fetch(');
    expect(toAxios(record)).toContain('axios.request');
    expect(toPythonRequests(record)).toContain('True');
    expect(toPostman(record)).toHaveProperty('info.schema');
    expect(toRawHttp(record)).toContain('HTTP/1.1');
  });
  it('copies HAR form fields to cURL and Postman without retaining multipart boundaries', () => {
    const multipart = { ...record, request: { ...record.request, headers: [...record.request.headers, { name: 'Content-Type', value: 'multipart/form-data; boundary=browser-boundary' }], body: { mimeType: 'multipart/form-data', formData: { title: ['alpha', 'beta'], file: { fileName: 'payload.json', contentType: 'application/json' } } } } };
    const curl = toCurl(multipart, true);
    expect(curl).toContain("--form 'title=alpha'");
    expect(curl).toContain("--form 'title=beta'");
    expect(curl).toContain("--form 'file=@payload.json'");
    expect(curl).not.toContain('browser-boundary');
    const collection = toPostman(multipart) as { item: Array<{ request: { header: Array<{ key: string }>; body: { mode: string; formdata: Array<{ key: string; type: string }> } } }> };
    expect(collection.item[0]?.request.body.mode).toBe('formdata');
    expect(collection.item[0]?.request.body.formdata).toHaveLength(3);
    expect(collection.item[0]?.request.body.formdata.find((field) => field.key === 'file')?.type).toBe('file');
    expect(collection.item[0]?.request.header.some((header) => header.key.toLowerCase() === 'content-type')).toBe(false);
  });
});

describe('capture normalization', () => {
  const entry = (overrides: Record<string, unknown> = {}) => ({
    startedDateTime: '2025-01-02T03:04:05.000Z', time: 42,
    request: { method: 'post', url: 'https://api.test/a?x=1&x=2', httpVersion: 'HTTP/2', headers: [{ name: 'Authorization', value: 'Bearer token' }, { name: 'Content-Type', value: 'application/json' }], cookies: [{ name: 'session', value: 'cookie-value', httpOnly: true, secure: true }], postData: { mimeType: 'application/json', text: '{"a":1}' } },
    response: { status: 201, statusText: 'Created', httpVersion: 'HTTP/2', headers: [{ name: 'Content-Type', value: 'application/problem+json' }, { name: 'Set-Cookie', value: 'sid=abc; HttpOnly' }], cookies: [{ name: 'sid', value: 'abc', httpOnly: true }], content: { mimeType: 'application/problem+json', size: 12 } },
    timings: { blocked: -1, dns: 3, connect: 4, ssl: 1, send: 2, wait: 20, receive: 12 },
    serverIPAddress: '192.0.2.1', connection: '7', _resourceType: 'XHR',
    ...overrides,
  });

  it('normalizes HAR URL, auth, cookies, JSON bodies, metadata and non-negative timings', () => {
    const normalized = normalizeHarEntry({ entry: entry(), tabId: 7, page: { url: 'https://app.test', title: 'App' }, responseContent: '{"ok":true}' });
    expect(normalized?.request.method).toBe('POST');
    expect(normalized?.request.query.x).toEqual(['1', '2']);
    expect(normalized?.request.headers[0]?.sensitive).toBe(true);
    expect(normalized?.response.body?.json).toEqual({ ok: true });
    expect(normalized?.timing?.total).toBe(42);
    expect(normalized?.timing?.blocked).toBeUndefined();
    expect(normalized?.request.cookies[0]?.value).toBe('cookie-value');
    expect(normalized?.response.cookies?.[0]?.name).toBe('sid');
    expect(normalized?.source).toBe('devtools-network');
    expect(normalized?.meta?.serverIPAddress).toBe('192.0.2.1');
    expect(normalized?.page.title).toBe('App');
  });
  it('ignores invalid URLs and safely handles malformed JSON and empty 204 bodies', () => {
    expect(normalizeHarEntry({ entry: { request: { url: 'not a URL', method: 'GET' } }, tabId: 1 })).toBeUndefined();
    const malformed = normalizeHarEntry({ entry: entry({ request: { method: 'POST', url: 'https://api.test', postData: { mimeType: 'application/json', text: '{bad' } }, response: { status: 200, content: { mimeType: 'application/json' } } }), tabId: 1, responseContent: '{bad' });
    expect(malformed?.response.body?.text).toBe('{bad');
    expect(malformed?.response.body?.json).toBeUndefined();
    const empty = normalizeHarEntry({ entry: entry({ request: { method: 'GET', url: 'https://api.test' }, response: { status: 204, content: { mimeType: 'application/json' } } }), tabId: 1, responseContent: '' });
    expect(empty?.response.status).toBe(204);
    expect(empty?.response.body).toBeUndefined();
  });
  it('caps large payloads and parses URL-encoded and multipart form parameters', () => {
    const large = normalizeHarEntry({ entry: entry({ request: { method: 'POST', url: 'https://api.test', postData: { mimeType: 'application/json', text: '{"long":"abcdefgh"}' } }, response: { status: 200, content: { mimeType: 'application/json' } } }), tabId: 1, responseContent: '{"long":"abcdefgh"}', maxBodyBytes: 8 });
    expect(large?.response.body?.truncated).toBe(true);
    const form = normalizeHarEntry({ entry: entry({ request: { method: 'POST', url: 'https://api.test', postData: { mimeType: 'application/x-www-form-urlencoded', text: 'tag=a&tag=b' } } }), tabId: 1 });
    expect(form?.request.body?.formData).toEqual({ tag: ['a', 'b'] });
    const multipart = normalizeHarEntry({ entry: entry({ request: { method: 'POST', url: 'https://api.test', postData: { mimeType: 'multipart/form-data', params: [{ name: 'file', fileName: 'data.json', contentType: 'application/json' }, { name: 'tag', value: 'one' }] } } }), tabId: 1 });
    expect(multipart?.request.body?.formData).toEqual({ file: { fileName: 'data.json', contentType: 'application/json' }, tag: 'one' });
  });
  it('deduplicates by stable request identity and filters static traffic by default', () => {
    const request = entry();
    expect(createHarDedupeKey(request, 2)).toBe(createHarDedupeKey(request, 2));
    expect(createHarDedupeKey(request, 2)).not.toBe(createHarDedupeKey(entry({ request: { method: 'POST', url: 'https://api.test/a', postData: { text: 'different' } } }), 2));
    expect(shouldCaptureHarEntry(request)).toBe(true);
    expect(shouldCaptureHarEntry(entry({ request: { method: 'GET', url: 'https://cdn.test/image.png' }, response: { status: 200, content: { mimeType: 'image/png' } }, _resourceType: 'Image' }))).toBe(false);
    expect(shouldCaptureHarEntry(entry({ request: { method: 'GET', url: 'https://cdn.test/image.png' }, response: { status: 200, content: { mimeType: 'image/png' } }, _resourceType: 'Image' }), true)).toBe(true);
  });
  it('omits binary body parsing and records a useful unavailable reason', () => {
    const binary = normalizeHarEntry({ entry: entry({ response: { status: 200, content: { mimeType: 'application/octet-stream', size: 100 } } }), tabId: 4, responseContent: 'AAECAw==' });
    expect(binary?.response.body?.unavailableReason).toBe('Binary response body omitted.');
    expect(binary?.response.body?.json).toBeUndefined();
  });
});
