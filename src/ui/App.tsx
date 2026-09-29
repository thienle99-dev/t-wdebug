import { useEffect, useMemo, useState } from 'react';
import { clearRequests } from '../storage/indexed-db';
import { getPreferences, savePreferences } from '../storage/preferences';
import { useRequestStore } from '../shared/store';
import type { Preferences, RequestRecord } from '../shared/types';
import { toAIPrompt, toAxios, toCurl, toDebugBundle, toFetch, toFullDebug, toMarkdownBugReport, toPostman, toRawHttp } from '../core/formatters';
import { redactRecord } from '../core/secrets';
import '../styles.css';

type DetailTab = 'overview' | 'request' | 'response' | 'auth' | 'ai';
function methodClass(method: string) { return `method method-${method.toLowerCase()}`; }
function statusClass(status: number) { return status <= 0 || status >= 500 ? 'status bad' : status >= 400 ? 'status warn' : 'status ok'; }
function prettyUrl(url: string) { try { const parsed = new URL(url); return `${parsed.pathname}${parsed.search}`; } catch { return url; } }

export function App({ devtoolsTabId }: { devtoolsTabId?: number }) {
  const { requests, selectedId, loading, refresh, select, remove, togglePin } = useRequestStore();
  const [query, setQuery] = useState(''); const [tab, setTab] = useState<DetailTab>('overview');
  const [capture, setCapture] = useState(false); const [captureError, setCaptureError] = useState('');
  const [includeSecrets, setIncludeSecrets] = useState(false); const [prefs, setPrefs] = useState<Preferences>(); const [notice, setNotice] = useState('');
  useEffect(() => { void refresh(); void getPreferences().then((p) => { setPrefs(p); setIncludeSecrets(p.includeSecretsInCopy); }); const timer = window.setInterval(() => void refresh(), 1200); return () => window.clearInterval(timer); }, [refresh]);
  const [activeTabId, setActiveTabId] = useState<number | undefined>(devtoolsTabId);
  const tabId = devtoolsTabId ?? activeTabId;
  useEffect(() => {
    if (devtoolsTabId !== undefined) { setActiveTabId(devtoolsTabId); return; }
    void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([active]) => setActiveTabId(active?.id)).catch(() => undefined);
  }, [devtoolsTabId]);
  useEffect(() => {
    if (tabId === undefined) return;
    void chrome.runtime.sendMessage({ type: 'capture:status', tabId }).then((response) => setCapture(Boolean(response?.active))).catch(() => undefined);
  }, [tabId]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests.filter((r) => !q || `${r.request.method} ${r.request.url} ${r.response.status} ${r.response.statusText ?? ''}`.toLowerCase().includes(q));
  }, [requests, query]);
  const visibleRequests = devtoolsTabId === undefined ? filtered.slice(0, 20) : filtered;
  const selected = visibleRequests.find((item) => item.id === selectedId) ?? visibleRequests.find((item) => item.flags.failed) ?? visibleRequests[0];
  const failedCount = requests.filter((item) => item.flags.failed).length;
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setNotice(`${label} copied`); window.setTimeout(() => setNotice(''), 1800); }
    catch { setNotice('Clipboard unavailable. Check extension clipboard access.'); window.setTimeout(() => setNotice(''), 2800); }
  }
  async function toggleCapture() {
    if (tabId === undefined) { setCaptureError('Open this panel in a normal browser tab to start capture.'); return; }
    const type = capture ? 'capture:stop' : 'capture:start';
    try { const result = await chrome.runtime.sendMessage({ type, tabId }); if (!result?.ok) throw new Error(result?.error ?? 'Capture could not start.'); setCapture(!capture); setCaptureError(''); }
    catch (error) { setCaptureError(error instanceof Error ? error.message : String(error)); }
  }
  async function changeSecrets(enabled: boolean) { setIncludeSecrets(enabled); await savePreferences({ includeSecretsInCopy: enabled }); }
  function downloadPostman(record: RequestRecord, withSecrets: boolean) {
    try {
      const data = JSON.stringify(toPostman(record, withSecrets), null, 2);
      const blobUrl = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = blobUrl; anchor.download = `api-lens-${record.request.method.toLowerCase()}-${Date.now()}.postman_collection.json`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000); setNotice('Postman collection exported'); window.setTimeout(() => setNotice(''), 1800);
    } catch { setNotice('Unable to export Postman collection.'); window.setTimeout(() => setNotice(''), 2200); }
  }
  async function clearHistory() { if (!window.confirm('Clear all captured requests? Pinned requests will also be removed.')) return; await clearRequests(); await refresh(); }
  function copyAction(kind: 'full' | 'curl' | 'safe-curl' | 'request' | 'response' | 'fetch' | 'axios' | 'raw' | 'bundle' | 'postman' | 'ai' | 'bug', record = selected) {
    if (!record) return;
    const withSecrets = includeSecrets;
    if (kind === 'full') void copy(toFullDebug(record, withSecrets), 'Debug context');
    else if (kind === 'curl') void copy(toCurl(record, withSecrets), 'cURL');
    else if (kind === 'safe-curl') void copy(toCurl(record, false), 'Safe cURL');
    else if (kind === 'request') { const r = withSecrets ? record : redactRecord(record); void copy(`${r.request.method} ${r.request.url}\n${r.request.headers.map((h) => `${h.name}: ${h.value}`).join('\n')}\n\n${r.request.body?.text ?? ''}`, 'Request'); }
    else if (kind === 'response') { const r = withSecrets ? record : redactRecord(record); void copy(`${r.response.status} ${r.response.statusText ?? ''}\n${r.response.headers.map((h) => `${h.name}: ${h.value}`).join('\n')}\n\n${r.response.body?.text ?? r.response.body?.unavailableReason ?? ''}`, 'Response'); }
    else if (kind === 'fetch') void copy(toFetch(record, withSecrets), 'fetch');
    else if (kind === 'axios') void copy(toAxios(record, withSecrets), 'Axios');
    else if (kind === 'raw') void copy(toRawHttp(record, withSecrets), 'Raw HTTP');
    else if (kind === 'bundle') void copy(JSON.stringify(toDebugBundle(record, false), null, 2), 'Safe debug bundle');
    else if (kind === 'postman') downloadPostman(record, withSecrets);
    else if (kind === 'ai') { setTab('ai'); void copy(toAIPrompt(record), 'Redacted AI prompt'); }
    else if (kind === 'bug') void copy(toMarkdownBugReport(record), 'Safe bug report');
  }
  return <main className={devtoolsTabId === undefined ? 'app popup' : 'app panel'}>
    <header className="topbar"><div className="brand"><span className="brand-mark">A</span><strong>API Lens</strong><span className="count">{requests.length}</span></div><div className="top-actions"><span className={`capture-state ${capture ? 'on' : ''}`}>{capture ? 'CAPTURING' : `${failedCount} failed`}</span><button className={`capture-button ${capture ? 'active' : ''}`} onClick={() => void toggleCapture()}>{capture ? 'Stop' : 'Capture'}</button></div></header>
    {captureError && <div className="inline-error" role="alert">Capture unavailable: {captureError}</div>}
    <section className="toolbar"><input aria-label="Search requests" placeholder="Filter by URL, method, status…" value={query} onChange={(event) => setQuery(event.target.value)} /><label className="secret-toggle" title="Include sensitive values in local copies"><input type="checkbox" checked={includeSecrets} onChange={(event) => void changeSecrets(event.target.checked)} /> secrets</label><button className="quiet" onClick={() => void clearHistory()}>Clear</button></section>
    <section className="workspace"><aside className="request-list" aria-label="Captured requests">{loading && !requests.length ? <div className="empty">Loading local history…</div> : visibleRequests.length ? visibleRequests.map((r) => <RequestRow key={r.id} record={r} selected={selected?.id === r.id} onClick={() => select(r.id)} />) : <div className="empty"><strong>No API requests captured yet.</strong><span>Start capture, then use the app in this tab.</span><small>Traffic stays in this browser unless you explicitly copy or send it.</small></div>}</aside>
      <section className="details">{selected ? <><div className="selected-head"><div><span className={methodClass(selected.request.method)}>{selected.request.method}</span><strong title={selected.request.url}>{prettyUrl(selected.request.url)}</strong><span className={statusClass(selected.response.status)}>{selected.response.status || 'ERR'}</span></div><div className="row-actions"><button onClick={() => void togglePin(selected.id)} title="Pin request">{selected.flags.pinned ? 'Pinned' : 'Pin'}</button><button onClick={() => void remove(selected.id)} title="Delete request">Delete</button></div></div>
        <nav className="tabs">{(['overview', 'request', 'response', 'auth', 'ai'] as DetailTab[]).map((name) => <button key={name} className={tab === name ? 'selected' : ''} onClick={() => setTab(name)}>{name}</button>)}</nav>
        <div className="detail-content">{tab === 'overview' && <Overview record={selected} />}{tab === 'request' && <BodyPanel title="Request" headers={selected.request.headers} body={selected.request.body?.text} unavailable={undefined} />}{tab === 'response' && <BodyPanel title="Response" headers={selected.response.headers} body={selected.response.body?.text} unavailable={selected.response.body?.unavailableReason} />}{tab === 'auth' && <AuthPanel record={selected} />}{tab === 'ai' && <section className="ai-panel"><div className="ai-heading">Manual AI debug prompt <span>redacted by default</span></div><p>Review the included context, then copy it into your preferred AI tool. API Lens does not send data automatically.</p><pre>{toAIPrompt(selected)}</pre><button className="primary" onClick={() => copyAction('ai', selected)}>Copy AI prompt</button></section>}</div>
        <div className="action-bar"><button className="primary" onClick={() => copyAction('full')}>Copy Full Debug</button><button onClick={() => copyAction('curl')}>cURL</button><button onClick={() => copyAction('safe-curl')}>Safe cURL</button><button onClick={() => copyAction('request')}>Req</button><button onClick={() => copyAction('response')}>Res</button><div className="more-actions"><button onClick={() => copyAction('fetch')}>fetch</button><button onClick={() => copyAction('axios')}>Axios</button><button onClick={() => copyAction('raw')}>Raw HTTP</button><button onClick={() => copyAction('bundle')}>Safe bundle</button><button onClick={() => copyAction('postman')}>Postman</button><button onClick={() => copyAction('bug')}>Bug report</button><button className="ai-button" onClick={() => copyAction('ai')}>Ask AI</button></div></div>
      </> : <div className="empty detail-empty">Select a request to inspect its details.</div>}</section>
    </section>
    <footer><span>Local history · max {prefs?.maxRequests ?? 500} requests</span><span>{notice || 'No traffic is sent automatically'}</span></footer>
  </main>;
}

function RequestRow({ record, selected, onClick }: { record: RequestRecord; selected: boolean; onClick: () => void }) {
  return <button className={`request-row ${selected ? 'selected' : ''}`} onClick={onClick}><span className={methodClass(record.request.method)}>{record.request.method}</span><span className="request-url" title={record.request.url}>{prettyUrl(record.request.url)}</span><span className={statusClass(record.response.status)}>{record.response.status || 'ERR'}</span></button>;
}
function Overview({ record }: { record: RequestRecord }) {
  return <div className="overview"><dl><dt>Full URL</dt><dd>{record.request.url}</dd><dt>Page</dt><dd>{record.page.url ?? 'Unknown'}</dd><dt>Captured</dt><dd>{new Date(record.timestamp).toLocaleString()}</dd><dt>Duration</dt><dd>{record.timing?.total === undefined ? 'Unavailable' : `${Math.round(record.timing.total)} ms`}</dd><dt>Type</dt><dd>{record.meta?.resourceType ?? 'Unknown'}</dd><dt>Body size</dt><dd>{record.meta?.size === undefined ? 'Unknown' : `${record.meta.size.toLocaleString()} bytes`}</dd></dl>{record.flags.failed && <div className="diagnosis">{record.response.status === 401 ? 'Authentication failure' : record.response.status === 403 ? 'Authorization or permission failure' : record.response.status === 404 ? 'Route or resource not found' : record.response.status === 422 ? 'Validation or semantic error' : record.response.status === 429 ? 'Rate limited' : record.response.status >= 500 ? 'Server or upstream error' : 'Request failed'}. Generic status guidance; inspect the request and response for evidence.</div>}</div>;
}
function BodyPanel({ title, headers, body, unavailable }: { title: string; headers: RequestRecord['request']['headers']; body?: string; unavailable?: string }) {
  return <div className="body-panel"><h3>{title} headers <span>{headers.length}</span></h3><pre>{headers.length ? headers.map((h) => `${h.name}: ${h.value}`).join('\n') : '(none)'}</pre><h3>{title} body</h3><pre>{body ?? unavailable ?? '(empty)'}</pre>{unavailable && <small className="hint">Body unavailable: {unavailable}</small>}</div>;
}
function AuthPanel({ record }: { record: RequestRecord }) {
  const authHeaders = record.request.headers.filter((h) => h.sensitive);
  return <div className="auth-panel"><h3>Detected authentication</h3>{record.request.auth ? <p>{record.request.auth.type} · {record.request.auth.source}</p> : <p>No authorization header detected.</p>}<pre>{authHeaders.length ? authHeaders.map((h) => `${h.name}: ${h.value}`).join('\n') : '(none)'}</pre><p className="muted">Sensitive values stay local. Enable the secrets toggle only when you intentionally need them in a local copy.</p></div>;
}
