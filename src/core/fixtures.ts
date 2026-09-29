import type { RequestRecord } from '../shared/types';

export const demoRequests: RequestRecord[] = [
  record('get-me', 'GET', 'https://api.example.test/api/me', 200, { name: 'Ada' }),
  record('login-401', 'POST', 'https://api.example.test/api/login', 401, { error: 'token_expired' }, { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZGEifQ.signature', 'Content-Type': 'application/json' }, { email: 'ada@example.test', password: 'demo-secret' }),
  record('validation-422', 'POST', 'https://api.example.test/api/orders', 422, { errors: { quantity: ['Must be positive'] } }),
  record('server-500', 'POST', 'https://api.example.test/api/checkout', 500, { error: 'internal_error' }),
  record('graphql', 'POST', 'https://api.example.test/graphql', 200, { data: { viewer: { id: 'u1' } } }, { 'Content-Type': 'application/json' }, { query: 'query Viewer { viewer { id } }', variables: {} }),
  record('multipart', 'POST', 'https://api.example.test/api/upload', 201, { uploaded: true }, { 'Content-Type': 'multipart/form-data; boundary=api-lens-demo' }, { description: 'sample upload', file: '[binary part omitted by Chrome]' }),
  record('large-response', 'GET', 'https://api.example.test/api/large', 200, { payload: 'x'.repeat(4096) }),
  record('binary-response', 'GET', 'https://api.example.test/assets/file', 200, '[binary body omitted]', { 'Content-Type': 'application/octet-stream' }),
];
function record(id: string, method: string, url: string, status: number, response: unknown, headers: Record<string, string> = { 'Content-Type': 'application/json' }, request?: unknown): RequestRecord {
  const text = request === undefined ? undefined : JSON.stringify(request);
  return { id, timestamp: Date.now() - id.length * 1000, page: { url: 'https://app.example.test/dashboard', title: 'Demo app' }, request: { method, url, query: {}, headers: Object.entries(headers).map(([name, value]) => ({ name, value, sensitive: name.toLowerCase() === 'authorization' })), cookies: [], body: text ? { text, json: request } : undefined }, response: { status, statusText: status === 200 ? 'OK' : status === 401 ? 'Unauthorized' : status === 422 ? 'Unprocessable Entity' : 'Internal Server Error', headers: [{ name: 'Content-Type', value: 'application/json' }], mimeType: 'application/json', body: { text: JSON.stringify(response), json: response } }, timing: { total: 94 }, flags: { failed: status >= 400, hasAuth: Boolean(headers.Authorization), hasSensitiveData: Boolean(headers.Authorization), pinned: false } };
}
