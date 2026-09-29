import { describe, expect, it } from 'vitest';
import { demoRequests } from './fixtures';
import { toAIPrompt, toCurl, toFetch, toAxios, toPythonRequests, toPostman, toRawHttp } from './formatters';
import { detectSecret, redactRecord } from './secrets';
import { normalizeRecord } from './normalize';

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
});

describe('capture normalization', () => {
  it('normalizes URL query, headers, bodies, status and timing', () => {
    const normalized = normalizeRecord({ tabId: 7, pageUrl: 'https://app.test', request: { requestId: 'r1', request: { url: 'https://api.test/a?x=1&x=2', method: 'post', headers: { Authorization: 'Bearer token' }, postData: '{"a":1}' }, timestamp: 1, wallTime: 1700000000, type: 'Fetch' }, response: { status: 201, headers: { 'Content-Type': 'application/json' }, mimeType: 'application/json' }, responseBody: '{"ok":true}', startedAtMs: 1700000000000, totalMs: 42 });
    expect(normalized?.request.method).toBe('POST');
    expect(normalized?.request.query.x).toEqual(['1', '2']);
    expect(normalized?.request.headers[0]?.sensitive).toBe(true);
    expect(normalized?.response.body?.json).toEqual({ ok: true });
    expect(normalized?.timing?.total).toBe(42);
  });
  it('ignores invalid URLs and preserves malformed or empty bodies safely', () => {
    expect(normalizeRecord({ tabId: 1, request: { requestId: 'bad', request: { url: 'not a URL', method: 'GET' }, timestamp: 0 }, startedAtMs: 0 })).toBeUndefined();
    const empty = normalizeRecord({ tabId: 1, request: { requestId: 'empty', request: { url: 'https://api.test', method: 'GET' }, timestamp: 0 }, response: { status: 204 }, responseBody: '', startedAtMs: 0 });
    expect(empty?.response.status).toBe(204);
    expect(empty?.response.body).toBeUndefined();
  });
  it('marks oversized body text as truncated and parses URL-encoded forms', () => {
    const large = normalizeRecord({ tabId: 1, request: { requestId: 'large', request: { url: 'https://api.test', method: 'POST', headers: { 'Content-Type': 'application/json' } }, timestamp: 0 }, response: { status: 200 }, responseBody: '{"long":"abcdefgh"}', startedAtMs: 0, maxBodyBytes: 8 });
    expect(large?.response.body?.truncated).toBe(true);
    const form = normalizeRecord({ tabId: 1, request: { requestId: 'form', request: { url: 'https://api.test', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, postData: 'tag=a&tag=b' }, timestamp: 0 }, startedAtMs: 0 });
    expect(form?.request.body?.formData).toEqual({ tag: ['a', 'b'] });
  });
});
