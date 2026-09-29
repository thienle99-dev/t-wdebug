import type { HeaderEntry, RequestRecord } from '../shared/types';
import { redactRecord } from './secrets';

function prepared(record: RequestRecord, includeSecrets: boolean): RequestRecord { return includeSecrets ? record : redactRecord(record); }
function bodyValue(record: RequestRecord): unknown { if (record.request.body?.json !== undefined) return record.request.body.json; return record.request.body?.text; }
function headersObject(headers: HeaderEntry[]): Record<string, string> { return Object.fromEntries(headers.map(({ name, value }) => [name, value])); }
export function toDebugBundle(record: RequestRecord, includeSecrets = false) { const item = prepared(record, includeSecrets); return { version: 1, capturedAt: new Date(item.timestamp).toISOString(), page: item.page, request: item.request, response: item.response, timing: item.timing, meta: item.meta, flags: item.flags }; }
export function toFullDebug(record: RequestRecord, includeSecrets = false): string {
  const r = prepared(record, includeSecrets);
  return [`${r.request.method} ${r.request.url}`, '', 'PAGE', r.page.url ?? '(unknown)', '', 'STATUS', `${r.response.status} ${r.response.statusText ?? ''}`.trim(), '', 'REQUEST HEADERS', ...r.request.headers.map((h) => `${h.name}: ${h.value}`), '', 'REQUEST BODY', pretty(bodyValue(r) ?? (r.request.body?.formData ? { formData: r.request.body.formData } : undefined)), '', 'RESPONSE HEADERS', ...r.response.headers.map((h) => `${h.name}: ${h.value}`), '', 'RESPONSE BODY', r.response.body?.text ?? (r.response.body?.json !== undefined ? pretty(r.response.body.json) : r.response.body?.unavailableReason ?? '(empty)'), '', 'TIMING', `Total: ${r.timing?.total ?? 'unknown'} ms`].join('\n');
}
function pretty(value: unknown): string { return value === undefined ? '(empty)' : typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
export function toCurl(record: RequestRecord, includeSecrets = false): string {
  const r = prepared(record, includeSecrets); const multipart = Boolean(r.request.body?.formData && /multipart\/form-data/i.test(r.request.body.mimeType ?? '')); const lines = [`curl ${shellQuote(r.request.url)}`, `  -X ${shellQuote(r.request.method)}`];
  for (const { name, value } of r.request.headers) {
    if (multipart && /^content-type$/i.test(name)) continue;
    lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  }
  const body = r.request.body?.text;
  if (body && !['GET', 'HEAD'].includes(r.request.method)) lines.push(`  --data-raw ${shellQuote(body)}`);
  else if (r.request.body?.formData && !['GET', 'HEAD'].includes(r.request.method)) {
    if (multipart) for (const [name, value] of formPairs(r.request.body.formData)) lines.push(`  --form ${shellQuote(`${name}=${value}`)}`);
    else if (/x-www-form-urlencoded/i.test(r.request.body.mimeType ?? '')) lines.push(`  --data-raw ${shellQuote(new URLSearchParams(formPairs(r.request.body.formData)).toString())}`);
  }
  return lines.join(' \\\n');
}
export function toFetch(record: RequestRecord, includeSecrets = false): string {
  const r = prepared(record, includeSecrets); const options: Record<string, unknown> = { method: r.request.method, headers: headersObject(r.request.headers) };
  if (r.request.body?.text && !['GET', 'HEAD'].includes(r.request.method)) options.body = r.request.body.text;
  return `fetch(${JSON.stringify(r.request.url)}, ${JSON.stringify(options, null, 2)});`;
}
export function toRawHttp(record: RequestRecord, includeSecrets = false): string {
  const r = prepared(record, includeSecrets); const url = new URL(r.request.url);
  const headers = [...r.request.headers];
  if (!headers.some((header) => /^host$/i.test(header.name))) headers.unshift({ name: 'Host', value: url.host });
  const body = r.request.body?.text;
  if (body && !headers.some((header) => /^content-length$/i.test(header.name))) headers.push({ name: 'Content-Length', value: String(new TextEncoder().encode(body).byteLength) });
  return [`${r.request.method} ${url.pathname}${url.search} HTTP/1.1`, ...headers.map(({ name, value }) => `${name}: ${value}`), '', body ?? ''].join('\r\n');
}
export function toAxios(record: RequestRecord, includeSecrets = false): string {
  const r = prepared(record, includeSecrets); const body = bodyValue(r); const config = { headers: headersObject(r.request.headers) };
  return `await axios.request({\n  method: ${JSON.stringify(r.request.method.toLowerCase())},\n  url: ${JSON.stringify(r.request.url)},${body === undefined ? '' : `\n  data: ${JSON.stringify(body, null, 2).replaceAll('\n', '\n  ')},`}\n  ...${JSON.stringify(config, null, 2).replaceAll('\n', '\n  ')}\n});`;
}
export function toPythonRequests(record: RequestRecord, includeSecrets = false): string {
  const r = prepared(record, includeSecrets); const body = bodyValue(r); const lines = ['import requests', '', 'response = requests.request(', `    ${JSON.stringify(r.request.method)},`, `    ${JSON.stringify(r.request.url)},`, `    headers=${pythonLiteral(headersObject(r.request.headers), 4)},`];
  if (body !== undefined) lines.push(`    json=${pythonLiteral(body, 4)},`);
  lines.push(')', '', 'print(response.status_code)', 'print(response.text)'); return lines.join('\n');
}
function pythonLiteral(value: unknown, indent = 0): string {
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
  if (Array.isArray(value)) return value.length ? `[${value.map((item) => pythonLiteral(item, indent + 4)).join(', ')}]` : '[]';
  if (typeof value === 'object' && value) return Object.keys(value).length ? `{\n${Object.entries(value).map(([key, item]) => `${' '.repeat(indent + 4)}${JSON.stringify(key)}: ${pythonLiteral(item, indent + 4)}`).join(',\n')}\n${' '.repeat(indent)}}` : '{}';
  return 'None';
}
export function toPostman(record: RequestRecord, includeSecrets = false): object {
  const r = prepared(record, includeSecrets); const u = new URL(r.request.url);
  let postmanBody: Record<string, unknown> | undefined;
  const multipart = Boolean(r.request.body?.formData && /multipart\/form-data/i.test(r.request.body.mimeType ?? ''));
  if (r.request.body?.text) postmanBody = { mode: 'raw', raw: r.request.body.text, options: { raw: { language: /json/i.test(r.request.body.mimeType ?? '') ? 'json' : 'text' } } };
  else if (r.request.body?.formData && multipart) postmanBody = { mode: 'formdata', formdata: postmanFormFields(r.request.body.formData) };
  else if (r.request.body?.formData && /x-www-form-urlencoded/i.test(r.request.body.mimeType ?? '')) postmanBody = { mode: 'urlencoded', urlencoded: formPairs(r.request.body.formData).map(([key, value]) => ({ key, value, type: 'text' })) };
  const postmanHeaders = multipart ? r.request.headers.filter((header) => !/^content-type$/i.test(header.name)) : r.request.headers;
  return { info: { name: `API Lens - ${r.request.method} ${u.pathname}`, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [{ name: `${r.request.method} ${u.pathname}`, request: { method: r.request.method, header: postmanHeaders.map((h) => ({ key: h.name, value: h.value })), url: { raw: r.request.url, protocol: u.protocol.replace(':', ''), host: u.hostname.split('.'), path: u.pathname.split('/').filter(Boolean), query: [...u.searchParams.entries()].map(([key, value]) => ({ key, value })) }, ...(postmanBody ? { body: postmanBody } : {}) } }] };
}
export function toMarkdownBugReport(record: RequestRecord): string { const r = prepared(record, false); return `# API Error\n\nPage: ${r.page.url ?? 'unknown'}\n\nRequest: ${r.request.method} ${r.request.path ?? r.request.url}\n\nStatus: ${r.response.status} ${r.response.statusText ?? ''}\n\n## Request\n\n\`\`\`http\n${toFullDebug(r, false)}\n\`\`\``; }
export function toAIPrompt(record: RequestRecord): string { const r = prepared(record, false); return `You are debugging an HTTP API request. Distinguish confirmed facts from hypotheses and do not invent undocumented API requirements. Identify likely cause, evidence, suggested fix, corrected request and cURL, and backend checks.\n\nREQUEST\n${r.request.method} ${r.request.url}\nHeaders:\n${r.request.headers.map((h) => `${h.name}: ${h.value}`).join('\n')}\nBody:\n${r.request.body?.text ?? '(empty)'}\n\nRESPONSE\nStatus: ${r.response.status} ${r.response.statusText ?? ''}\nBody:\n${r.response.body?.text ?? r.response.body?.unavailableReason ?? '(empty)'}`; }

function formPairs(data: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(data).flatMap(([name, raw]) => (Array.isArray(raw) ? raw : [raw]).map((value): [string, string] => {
    if (value && typeof value === 'object' && 'fileName' in value) return [name, `@${String((value as { fileName?: unknown }).fileName ?? '')}`];
    return [name, String(value ?? '')];
  }));
}

function postmanFormFields(data: Record<string, unknown>): Array<{ key: string; type: 'file'; src: string } | { key: string; type: 'text'; value: string }> {
  return Object.entries(data).flatMap(([key, raw]) => (Array.isArray(raw) ? raw : [raw]).map((value): { key: string; type: 'file'; src: string } | { key: string; type: 'text'; value: string } => {
    if (value && typeof value === 'object' && 'fileName' in value) return { key, src: String((value as { fileName?: unknown }).fileName ?? ''), type: 'file' };
    return { key, value: String(value ?? ''), type: 'text' };
  }));
}
