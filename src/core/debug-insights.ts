import type { ConsoleRecord, DebugInsight, EventRecord, MutationDebugRecord, PerformanceRecord, RequestRecord, UIElementRecord } from '../shared/types';

export function deriveInsights(requests: RequestRecord[], ui: UIElementRecord[], consoles: ConsoleRecord[], performance: PerformanceRecord[]): DebugInsight[] {
  const output: DebugInsight[] = [];
  for (const request of requests) {
    if (request.response.status === 401) {
      const exp = jwtExpiration(request);
      output.push({ id: `auth:${request.id}`, category: 'auth', severity: 'warning', title: exp !== undefined && exp * 1000 <= request.timestamp ? 'JWT appears expired' : 'Authentication failed', description: 'A 401 means the server did not accept these credentials; it does not identify the cause by itself.', evidence: [`HTTP 401 ${request.response.statusText ?? ''}`.trim(), ...(exp !== undefined ? [`JWT exp ${new Date(exp * 1000).toISOString()}`, `Request ${new Date(request.timestamp).toISOString()}`] : [])], relatedRecordIds: [request.id] });
    }
    if (request.response.status === 422) output.push({ id: `validation:${request.id}`, category: 'network', severity: 'warning', title: 'Validation response', description: 'HTTP 422 commonly indicates an input or semantic validation issue; inspect the captured response.', evidence: [`${request.request.method} ${request.request.url}`, request.response.body?.text?.slice(0, 500) ?? request.response.statusText ?? 'Response body unavailable'], relatedRecordIds: [request.id] });
    if (request.request.credentials === 'include' && !request.response.headers.some((header) => header.name.toLowerCase() === 'access-control-allow-credentials' && header.value.toLowerCase() === 'true')) output.push({ id: `cors:${request.id}`, category: 'network', severity: 'info', title: 'Check credentialed CORS response', description: 'The request uses credentials, but the captured headers lack Access-Control-Allow-Credentials: true. Page-hook headers can be incomplete.', evidence: ['credentials: include', 'Access-Control-Allow-Credentials: true not captured'], relatedRecordIds: [request.id] });
    if ((request.timing?.total ?? 0) >= 1000) output.push({ id: `slow:${request.id}`, category: 'performance', severity: 'warning', title: 'Slow API request', description: 'The request took at least one second. Compare server wait and transfer timings if available.', evidence: [`Total ${Math.round(request.timing!.total!)} ms`, ...(request.timing?.wait !== undefined ? [`Wait ${Math.round(request.timing.wait)} ms`] : [])], relatedRecordIds: [request.id] });
    if ((request.meta?.size ?? 0) >= 1024 * 1024) output.push({ id: `large:${request.id}`, category: 'performance', severity: 'warning', title: 'Large response', description: 'A response of at least 1 MB can add parsing and rendering cost.', evidence: [`${request.meta?.size} bytes`], relatedRecordIds: [request.id] });
  }
  const byRoute = new Map<string, RequestRecord[]>();
  for (const request of requests) { const key = `${request.request.method} ${canonicalUrl(request.request.url)}`; byRoute.set(key, [...(byRoute.get(key) ?? []), request]); }
  for (const [key, list] of byRoute) {
    const sorted = list.sort((a, b) => a.timestamp - b.timestamp);
    if (sorted.some((item, index) => index > 0 && item.timestamp - sorted[index - 1]!.timestamp <= 2100)) output.push({ id: `repeated:${sorted[0]!.id}`, category: 'network', severity: 'info', title: 'Repeated API request', description: 'The same method and URL appeared within about two seconds; this may be polling or a duplicate call.', evidence: [key, 'At least two matching requests within 2.1 seconds'], relatedRecordIds: sorted.map((item) => item.id) });
  }
  for (const element of ui) for (const diagnostic of element.diagnostics) output.push({ id: `ui:${element.id}:${diagnostic.title}`, category: diagnostic.title.toLowerCase().includes('accessibility') ? 'accessibility' : /clipped|covered|overflow|pointer/i.test(diagnostic.title) ? 'css' : 'ui', severity: diagnostic.severity, title: diagnostic.title, description: diagnostic.evidence, evidence: [element.selector, diagnostic.evidence], relatedRecordIds: [element.id] });
  for (const item of consoles.filter((record) => record.level === 'error')) {
    const related = requests.filter((request) => request.flags.failed && Math.abs(request.timestamp - item.timestamp) <= 1200);
    if (related.length) output.push({ id: `console-related:${item.id}`, category: 'console', severity: 'warning', title: 'Console error near a failed request', description: 'This timestamp correlation is a clue, not proof of causality.', evidence: [`Console: ${item.message.slice(0, 240)}`, ...related.map((request) => `${request.request.method} ${request.request.url} → ${request.response.status}`)], relatedRecordIds: [item.id, ...related.map((request) => request.id)] });
  }
  for (const item of performance) {
    if (item.entryType === 'longtask' && item.duration >= 50) output.push({ id: `longtask:${item.id}`, category: 'performance', severity: item.duration > 150 ? 'warning' : 'info', title: 'Main-thread long task', description: 'Long tasks can delay input and rendering.', evidence: [`${Math.round(item.duration)} ms`, new Date(item.timestamp).toLocaleTimeString()], relatedRecordIds: [item.id] });
    if (item.entryType === 'layout-shift' && (item.value ?? 0) >= 0.1) output.push({ id: `layout:${item.id}`, category: 'performance', severity: 'warning', title: 'Visible layout shift', description: 'The page reported a layout shift score of at least 0.1.', evidence: [`Score ${item.value}`], relatedRecordIds: [item.id] });
  }
  return output.sort((a, b) => weight(b.severity) - weight(a.severity));
}

export function buildRelatedFlows(requests: RequestRecord[], events: EventRecord[], mutations: MutationDebugRecord[], consoles: ConsoleRecord[]) {
  return events.filter((item) => ['click', 'submit', 'inspect'].includes(item.type)).sort((a, b) => a.timestamp - b.timestamp).slice(-100).map((trigger) => {
    const end = trigger.timestamp + 5000;
    const flow: Array<{ id: string; timestamp: number; type: string; label: string; recordId?: string }> = [{ id: trigger.id, timestamp: trigger.timestamp, type: 'ui-event', label: `${trigger.type} · ${trigger.targetSelector ?? 'element'}` }];
    requests.filter((item) => item.timestamp >= trigger.timestamp && item.timestamp <= end).forEach((item) => flow.push({ id: item.id, timestamp: item.timestamp, type: 'request', label: `${item.request.method} ${item.request.url}`, recordId: item.id }));
    mutations.filter((item) => item.timestamp >= trigger.timestamp && item.timestamp <= end).forEach((item) => flow.push({ id: item.id, timestamp: item.timestamp, type: 'mutation', label: `${item.change} · ${item.targetSelector ?? ''} · ${item.name ?? ''}: ${item.before ?? ''} → ${item.after ?? ''}`, recordId: item.id }));
    consoles.filter((item) => item.timestamp >= trigger.timestamp && item.timestamp <= end).forEach((item) => flow.push({ id: item.id, timestamp: item.timestamp, type: 'console', label: `${item.level}: ${item.message.slice(0, 180)}`, recordId: item.id }));
    flow.sort((a, b) => a.timestamp - b.timestamp);
    return { id: `flow:${trigger.id}`, startedAt: trigger.timestamp, trigger: { type: trigger.type, selector: trigger.targetSelector }, events: flow };
  }).filter((item) => item.events.length > 1);
}

function jwtExpiration(request: RequestRecord): number | undefined { const payload = request.request.auth?.decodedJwt?.payload; if (!payload || typeof payload !== 'object' || !('exp' in payload)) return undefined; const exp = (payload as { exp?: unknown }).exp; return typeof exp === 'number' && Number.isFinite(exp) ? exp : undefined; }
function canonicalUrl(value: string) { try { const url = new URL(value); url.hash = ''; return url.href; } catch { return value; } }
function weight(value: DebugInsight['severity']) { return value === 'error' ? 3 : value === 'warning' ? 2 : 1; }
