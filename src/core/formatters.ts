import type { HeaderEntry, RequestRecord } from '../shared/types';
import { redactRecord } from './secrets';

function prepared(record: RequestRecord, includeSecrets: boolean): RequestRecord { return includeSecrets ? record : redactRecord(record); }
function bodyValue(record: RequestRecord): unknown { if (record.request.body?.json !== undefined) return record.request.body.json; return record.request.body?.text; }
function headersObject(headers: HeaderEntry[]): Record<string, string> { return Object.fromEntries(headers.map(({ name, value }) => [name, value])); }
export function toDebugBundle(record: RequestRecord, includeSecrets = false) { const item = prepared(record, includeSecrets); return { version: 1, capturedAt: new Date(item.timestamp).toISOString(), page: item.page, request: item.request, response: item.response, timing: item.timing, meta: item.meta, flags: item.flags }; }
export function toFullDebug(record: RequestRecord, includeSecrets = false): string {
  const r = prepared(record, includeSecrets);
  return [`${r.request.method} ${r.request.url}`, '', 'PAGE', r.page.url ?? '(unknown)', '', 'STATUS', `${r.response.status} ${r.response.statusText ?? ''}`.trim(), '', 'REQUEST HEADERS', ...r.request.headers.map((h) => `${h.name}: ${h.value}`), '', 'REQUEST BODY', pretty(bodyValue(r)), '', 'RESPONSE HEADERS', ...r.response.headers.map((h) => `${h.name}: ${h.value}`), '', 'RESPONSE BODY', r.response.body?.text ?? pretty(r.response.body?.json) ?? r.response.body?.unavailableReason ?? '(empty)', '', 'TIMING', `Total: ${r.timing?.total ?? 'unknown'} ms`].join('\n');
}
function pretty(value: unknown): string { return value === undefined ? '(empty)' : typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
export function toCurl(record: RequestRecord, includeSecrets = true): string {
  const r = prepared(record, includeSecrets); const lines = [`curl ${shellQuote(r.request.url)}`, `  -X ${shellQuote(r.request.method)}`];
  for (const { name, value } of r.request.headers) lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  const body = r.request.body?.text;
  if (body && !['GET', 'HEAD'].includes(r.request.method)) lines.push(`  --data-raw ${shellQuote(body)}`);
  return lines.join(' \\\n');
}
export function toFetch(record: RequestRecord, includeSecrets = true): string {
  const r = prepared(record, includeSecrets); const options: Record<string, unknown> = { method: r.request.method, headers: headersObject(r.request.headers) };
  if (r.request.body?.text && !['GET', 'HEAD'].includes(r.request.method)) options.body = r.request.body.text;
  return `fetch(${JSON.stringify(r.request.url)}, ${JSON.stringify(options, null, 2)});`;
}
export function toAxios(record: RequestRecord, includeSecrets = true): string {
  const r = prepared(record, includeSecrets); const body = bodyValue(r); const config = { headers: headersObject(r.request.headers) };
  return `await axios.request({\n  method: ${JSON.stringify(r.request.method.toLowerCase())},\n  url: ${JSON.stringify(r.request.url)},${body === undefined ? '' : `\n  data: ${JSON.stringify(body, null, 2).replaceAll('\n', '\n  ')},`}\n  ...${JSON.stringify(config, null, 2).replaceAll('\n', '\n  ')}\n});`;
}
export function toPythonRequests(record: RequestRecord, includeSecrets = true): string {
  const r = prepared(record, includeSecrets); const body = bodyValue(r); const lines = ['import requests', '', 'response = requests.request(', `    ${JSON.stringify(r.request.method)},`, `    ${JSON.stringify(r.request.url)},`, `    headers=${JSON.stringify(headersObject(r.request.headers), null, 4).replaceAll('\n', '\n    ')},`];
  if (body !== undefined) lines.push(`    json=${JSON.stringify(body, null, 4).replaceAll('\n', '\n    ')},`);
  lines.push(')', '', 'print(response.status_code)', 'print(response.text)'); return lines.join('\n');
}
export function toPostman(record: RequestRecord, includeSecrets = false): object {
  const r = prepared(record, includeSecrets); const u = new URL(r.request.url);
  return { info: { name: `API Lens - ${r.request.method} ${u.pathname}`, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [{ name: `${r.request.method} ${u.pathname}`, request: { method: r.request.method, header: r.request.headers.map((h) => ({ key: h.name, value: h.value })), url: { raw: r.request.url, protocol: u.protocol.replace(':', ''), host: u.hostname.split('.'), path: u.pathname.split('/').filter(Boolean), query: [...u.searchParams.entries()].map(([key, value]) => ({ key, value })) }, ...(r.request.body?.text ? { body: { mode: 'raw', raw: r.request.body.text, options: { raw: { language: 'json' } } } } : {}) } }] };
}
export function toMarkdownBugReport(record: RequestRecord): string { const r = prepared(record, false); return `# API Error\n\nPage: ${r.page.url ?? 'unknown'}\n\nRequest: ${r.request.method} ${r.request.path ?? r.request.url}\n\nStatus: ${r.response.status} ${r.response.statusText ?? ''}\n\n## Request\n\n\`\`\`http\n${toFullDebug(r, false)}\n\`\`\``; }
export function toAIPrompt(record: RequestRecord): string { const r = prepared(record, false); return `You are debugging an HTTP API request. Distinguish confirmed facts from hypotheses and do not invent undocumented API requirements. Identify likely cause, evidence, suggested fix, corrected request and cURL, and backend checks.\n\nREQUEST\n${r.request.method} ${r.request.url}\nHeaders:\n${r.request.headers.map((h) => `${h.name}: ${h.value}`).join('\n')}\nBody:\n${r.request.body?.text ?? '(empty)'}\n\nRESPONSE\nStatus: ${r.response.status} ${r.response.statusText ?? ''}\nBody:\n${r.response.body?.text ?? r.response.body?.unavailableReason ?? '(empty)'}`; }
