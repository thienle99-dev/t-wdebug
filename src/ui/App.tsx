import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { clearRequests } from '../storage/indexed-db';
import { getPreferences, savePreferences } from '../storage/preferences';
import { useRequestStore } from '../shared/store';
import type { AppearanceTheme, BodyContent, Preferences, RequestRecord } from '../shared/types';
import { toAIPrompt, toAxios, toCurl, toDebugBundle, toFetch, toFullDebug, toMarkdownBugReport, toPostman, toRawHttp } from '../core/formatters';
import { detectSecret, redactRecord } from '../core/secrets';
import { formatBody, type BodyViewMode } from '../core/body-format';
import '../styles.css';

type DetailTab = 'overview' | 'request' | 'response' | 'headers' | 'timing' | 'auth' | 'ai';
function statusClass(status: number) { return status <= 0 || status >= 500 ? 'status bad' : status >= 400 ? 'status warn' : status >= 300 ? 'status redirect' : 'status ok'; }
function prettyUrl(url: string) { try { const parsed = new URL(url); return `${parsed.pathname}${parsed.search}`; } catch { return url; } }
function hostOf(url: string) { try { return new URL(url).host; } catch { return 'Unknown host'; } }
function formatDuration(value?: number) { if (value === undefined || !Number.isFinite(value)) return '—'; return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`; }
function formatSize(value?: number) { if (value === undefined || !Number.isFinite(value)) return '—'; return value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} B`; }
function bodyForDisplay(body?: BodyContent): string | undefined {
  if (!body) return undefined;
  if (body.text !== undefined) return body.text;
  if (body.json !== undefined) return JSON.stringify(body.json, null, 2);
  if (body.formData !== undefined) return JSON.stringify(body.formData, null, 2);
  return undefined;
}

export function App({ devtoolsTabId }: { devtoolsTabId?: number }) {
  const { requests, selectedId, loading, refresh, select, remove, togglePin } = useRequestStore();
  const [query, setQuery] = useState(''); const [tab, setTab] = useState<DetailTab>('overview');
  const [capture, setCapture] = useState(false);
  const [includeSecrets, setIncludeSecrets] = useState(false); const [prefs, setPrefs] = useState<Preferences>(); const [notice, setNotice] = useState('');
  const [appearance, setAppearance] = useState<AppearanceTheme>('system');
  const [sidebarWidth, setSidebarWidth] = useState(34);
  const [domainFilter, setDomainFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [hasAuthOnly, setHasAuthOnly] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  useEffect(() => { void refresh(); void getPreferences().then((p) => { setPrefs(p); setIncludeSecrets(p.includeSecretsInCopy); setAppearance(p.theme); setSidebarWidth(p.sidebarWidth); }); const timer = window.setInterval(() => void refresh(), 1200); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => {
    const syncPreferences = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !changes.preferences?.newValue) return;
      const next = { ...prefs, ...(changes.preferences.newValue as Partial<Preferences>) };
      if (next.theme) setAppearance(next.theme);
      if (typeof next.sidebarWidth === 'number') setSidebarWidth(next.sidebarWidth);
      if (typeof next.includeSecretsInCopy === 'boolean') setIncludeSecrets(next.includeSecretsInCopy);
      setPrefs((current) => current ? { ...current, ...next } : current);
    };
    chrome.storage.onChanged.addListener(syncPreferences);
    return () => chrome.storage.onChanged.removeListener(syncPreferences);
  }, [prefs]);
  const resolvedTheme = appearance === 'system' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : appearance;
  useEffect(() => { document.documentElement.dataset.theme = resolvedTheme; document.documentElement.style.colorScheme = resolvedTheme; }, [resolvedTheme]);
  useEffect(() => {
    if (appearance !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => { document.documentElement.dataset.theme = media.matches ? 'dark' : 'light'; document.documentElement.style.colorScheme = media.matches ? 'dark' : 'light'; };
    media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, [appearance]);
  const [activeTabId, setActiveTabId] = useState<number | undefined>(devtoolsTabId);
  const tabId = devtoolsTabId ?? activeTabId;
  useEffect(() => {
    if (devtoolsTabId !== undefined) { setActiveTabId(devtoolsTabId); return; }
    void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([active]) => setActiveTabId(active?.id)).catch(() => undefined);
  }, [devtoolsTabId]);
  useEffect(() => {
    if (tabId === undefined) { setCapture(false); return; }
    let cancelled = false;
    const updateStatus = () => {
      void chrome.runtime.sendMessage({ type: 'capture:status', tabId })
        .then((response) => { if (!cancelled) setCapture(response?.state === 'active' || response?.active === true); })
        .catch(() => { if (!cancelled) setCapture(false); });
    };
    updateStatus();
    const timer = window.setInterval(updateStatus, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [tabId]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests.filter((r) => !q || `${r.request.method} ${r.request.url} ${r.response.status} ${r.response.statusText ?? ''}`.toLowerCase().includes(q));
  }, [requests, query]);
  const domains = useMemo(() => [...new Set(requests.flatMap((item) => { try { return [new URL(item.request.url).host]; } catch { return []; } }))].sort(), [requests]);
  const shownRequests = filtered.filter((item) => {
    const status = item.response.status;
    const inStatus = statusFilter === 'all' || (statusFilter === '2xx' && status >= 200 && status < 300) || (statusFilter === '3xx' && status >= 300 && status < 400) || (statusFilter === '4xx' && status >= 400 && status < 500) || (statusFilter === '5xx' && status >= 500);
    let host = ''; try { host = new URL(item.request.url).host; } catch { /* Keep malformed captured URLs filterable. */ }
    return inStatus && (!domainFilter || domainFilter === host) && (!hasAuthOnly || item.flags.hasAuth);
  });
  const visibleRequests = devtoolsTabId === undefined ? shownRequests.slice(0, 20) : shownRequests;
  const selected = visibleRequests.find((item) => item.id === selectedId) ?? visibleRequests.find((item) => item.flags.failed) ?? visibleRequests[0];
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setNotice(`${label} copied`); window.setTimeout(() => setNotice(''), 1800); }
    catch { setNotice('Clipboard unavailable. Check extension clipboard access.'); window.setTimeout(() => setNotice(''), 2800); }
  }
  async function changeSecrets(enabled: boolean) { setIncludeSecrets(enabled); await savePreferences({ includeSecretsInCopy: enabled }); }
  async function changeAppearance(value: AppearanceTheme) { setAppearance(value); await savePreferences({ theme: value }); }
  async function saveSidebarWidth(value: number) { const next = Math.max(25, Math.min(55, value)); setSidebarWidth(next); await savePreferences({ sidebarWidth: next }); }
  function resizeSidebar(event: PointerEvent<HTMLButtonElement>) {
    const workspace = workspaceRef.current; if (!workspace) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const update = (clientX: number) => { const bounds = workspace.getBoundingClientRect(); setSidebarWidth(Math.max(25, Math.min(55, ((clientX - bounds.left) / bounds.width) * 100))); };
    const move = (moveEvent: globalThis.PointerEvent) => update(moveEvent.clientX);
    const up = (upEvent: globalThis.PointerEvent) => { update(upEvent.clientX); window.removeEventListener('pointermove', move); const bounds = workspace.getBoundingClientRect(); void saveSidebarWidth(((upEvent.clientX - bounds.left) / bounds.width) * 100); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
  }
  function resizeWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); void saveSidebarWidth(sidebarWidth + (event.key === 'ArrowRight' ? 2 : -2));
  }
  function closeMenu(event: MouseEvent<HTMLButtonElement>) { event.currentTarget.closest('details')?.removeAttribute('open'); }
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
    else if (kind === 'request') { const r = withSecrets ? record : redactRecord(record); void copy(`${r.request.method} ${r.request.url}\n${r.request.headers.map((h) => `${h.name}: ${h.value}`).join('\n')}\n\n${bodyForDisplay(r.request.body) ?? ''}`, 'Request'); }
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
    <header className="topbar"><div className="brand"><span className="brand-mark" aria-hidden="true">◇</span><strong>API Lens</strong><span className="count" title={`${requests.length} captured requests`}>{requests.length}</span></div><div className="top-actions"><span className={`capture-state ${capture ? 'on' : ''}`} role="status"><i aria-hidden="true" />{capture ? 'Capturing' : 'Capture paused'}</span><label className="theme-control"><span className="visually-hidden">Appearance</span><select aria-label="Appearance" title={`Appearance: ${appearance}`} value={appearance} onChange={(event) => void changeAppearance(event.target.value as AppearanceTheme)}><option value="system">System theme</option><option value="light">Light theme</option><option value="dark">Dark theme</option></select></label></div></header>
    {devtoolsTabId === undefined && !capture && <aside className="capture-hint" role="status"><span>Open DevTools to capture new requests. Saved history remains available.</span></aside>}
    <section className="toolbar"><label className="search-field"><span aria-hidden="true">⌕</span><input aria-label="Search requests" placeholder="Search URL, method, status…" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button className="clear-search" aria-label="Clear search" onClick={() => setQuery('')}>×</button>}</label><select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All status</option><option value="2xx">2xx</option><option value="3xx">3xx</option><option value="4xx">4xx</option><option value="5xx">5xx</option></select><select aria-label="Filter by domain" value={domainFilter} onChange={(event) => setDomainFilter(event.target.value)}><option value="">All domains</option>{domains.map((domain) => <option key={domain} value={domain}>{domain}</option>)}</select><button className={`filter-chip ${hasAuthOnly ? 'active' : ''}`} aria-pressed={hasAuthOnly} onClick={() => setHasAuthOnly(!hasAuthOnly)}>Has auth</button><details className="menu sensitive-menu"><summary>{includeSecrets ? 'Sensitive: reveal ▾' : 'Sensitive: mask ▾'}</summary><div className="menu-popover menu-align-right" role="menu"><button role="menuitemradio" aria-checked={!includeSecrets} onClick={(event) => { closeMenu(event); void changeSecrets(false); }}>Mask secrets</button><button role="menuitemradio" aria-checked={includeSecrets} onClick={(event) => { closeMenu(event); void changeSecrets(true); }}>Reveal in copies</button></div></details><details className="menu clear-menu"><summary className="quiet">Clear ▾</summary><div className="menu-popover menu-align-right"><button className="danger-action" onClick={(event) => { closeMenu(event); void clearHistory(); }}>Clear all history</button></div></details></section>
    <section className="workspace" ref={workspaceRef} style={{ '--sidebar-width': `${sidebarWidth}%` } as CSSProperties}><aside className="request-list" aria-label="Captured requests"><div className="list-heading"><strong>Requests</strong><span>{visibleRequests.length} {visibleRequests.length === 1 ? 'request' : 'requests'}</span></div>{loading && !requests.length ? <div className="empty">Loading local history…</div> : visibleRequests.length ? visibleRequests.map((r) => <RequestRow key={r.id} record={r} selected={selected?.id === r.id} onClick={() => select(r.id)} />) : <div className="empty"><strong>No API requests captured yet.</strong><span>Open DevTools, then use the app in this tab.</span><small>Traffic stays in this browser unless you explicitly copy or send it.</small></div>}</aside><button className="workspace-splitter" role="separator" aria-orientation="vertical" aria-label="Resize request list" aria-valuemin={25} aria-valuemax={55} aria-valuenow={Math.round(sidebarWidth)} onPointerDown={resizeSidebar} onKeyDown={resizeWithKeyboard} />
      <section className="details">{selected ? <><div className="selected-head"><div className="endpoint"><div className="endpoint-title"><span className="method">{selected.request.method}</span><strong title={selected.request.url}>{prettyUrl(selected.request.url)}</strong><span className={statusClass(selected.response.status)}>{selected.response.status || 'ERR'} {selected.response.statusText}</span></div><div className="endpoint-meta"><span>{selected.request.host ?? hostOf(selected.request.url)}</span><span>{formatDuration(selected.timing?.total)}</span><span>{formatSize(selected.meta?.size)}</span><span>{selected.meta?.resourceType ?? 'request'}</span><span>{selected.meta?.httpVersion}</span></div></div><div className="row-actions"><button className={`icon-button pin-action ${selected.flags.pinned ? 'pinned' : ''}`} aria-label={selected.flags.pinned ? 'Unpin request' : 'Pin request'} title={selected.flags.pinned ? 'Unpin request' : 'Pin request'} onClick={() => void togglePin(selected.id)}>{selected.flags.pinned ? '★' : '☆'}</button><details className="menu row-menu"><summary className="icon-button" aria-label="Request actions">•••</summary><div className="menu-popover menu-align-right"><button onClick={(event) => { closeMenu(event); void copy(selected.request.url, 'URL'); }}>Copy URL</button><button className="danger-action" onClick={(event) => { closeMenu(event); void remove(selected.id); }}>Delete request</button></div></details></div></div>
        <nav className="tabs" aria-label="Request details" role="tablist">{(['overview', 'request', 'response', 'headers', 'timing'] as DetailTab[]).map((name) => <button key={name} role="tab" aria-selected={tab === name} className={tab === name ? 'selected' : ''} onClick={() => setTab(name)}>{name}</button>)}<details className="menu more-tabs"><summary>More ▾</summary><div className="menu-popover"><button role="tab" aria-selected={tab === 'auth'} onClick={(event) => { closeMenu(event); setTab('auth'); }}>Authentication</button><button role="tab" aria-selected={tab === 'ai'} onClick={(event) => { closeMenu(event); setTab('ai'); }}>AI prompt</button></div></details></nav>
        <div className="detail-content">{tab === 'overview' && <Overview record={selected} />}{tab === 'request' && <BodyPanel title="Request" headers={selected.request.headers} body={bodyForDisplay(selected.request.body)} unavailable={undefined} onCopy={copy} />}{tab === 'headers' && <><BodyPanel title="Request" section="headers" headers={selected.request.headers} body={undefined} onCopy={copy} /><BodyPanel title="Response" section="headers" headers={selected.response.headers} body={undefined} onCopy={copy} /></>}{tab === 'response' && <BodyPanel title="Response" section="body" headers={[]} body={selected.response.body?.text} unavailable={selected.response.body?.unavailableReason} onCopy={copy} />}{tab === 'timing' && <TimingPanel record={selected} />}{tab === 'auth' && <AuthPanel record={selected} onCopy={copy} />}{tab === 'ai' && <section className="ai-panel"><div className="ai-heading">Manual AI debug prompt <span>redacted by default</span></div><p>Review the included context, then copy it into your preferred AI tool. API Lens does not send data automatically.</p><pre>{toAIPrompt(selected)}</pre><button className="primary" onClick={() => copyAction('ai', selected)}>Copy AI prompt</button></section>}</div>
        <div className="action-bar"><button className="primary" onClick={() => copyAction('full')}>Copy debug</button><button className="secondary-action" onClick={() => copyAction('curl')}>Copy cURL</button><button className="ai-action" onClick={() => copyAction('ai')}>Ask AI</button><span className="action-spacer" /><details className="menu action-menu"><summary>Copy ▾</summary><div className="menu-popover menu-align-right"><button onClick={(event) => { closeMenu(event); copyAction('request'); }}>Request</button><button onClick={(event) => { closeMenu(event); copyAction('response'); }}>Response</button><button onClick={(event) => { closeMenu(event); copyAction('safe-curl'); }}>Safe cURL</button><button onClick={(event) => { closeMenu(event); copyAction('fetch'); }}>JavaScript fetch</button><button onClick={(event) => { closeMenu(event); copyAction('axios'); }}>Axios</button><button onClick={(event) => { closeMenu(event); copyAction('raw'); }}>Raw HTTP</button><button onClick={(event) => { closeMenu(event); copyAction('bundle'); }}>Safe debug bundle</button></div></details><details className="menu action-menu"><summary>Export ▾</summary><div className="menu-popover menu-align-right"><button onClick={(event) => { closeMenu(event); copyAction('postman'); }}>Postman collection</button><button onClick={(event) => { closeMenu(event); copyAction('bug'); }}>Markdown bug report</button></div></details></div>
      </> : <div className="empty detail-empty">Select a request to inspect its details.</div>}</section>
    </section>
    <footer><span>Local history · max {prefs?.maxRequests ?? 500} requests</span><span>{notice || 'No traffic is sent automatically'}</span></footer>
  </main>;
}

function RequestRow({ record, selected, onClick }: { record: RequestRecord; selected: boolean; onClick: () => void }) {
  let host = ''; try { host = new URL(record.request.url).host; } catch { /* Preserve malformed captured URLs for inspection. */ }
  return <button className={`request-row ${selected ? 'selected' : ''} ${record.flags.failed ? 'failed' : ''}`} aria-current={selected ? 'true' : undefined} onClick={onClick}><span className="method">{record.request.method}</span><span className="request-copy"><span className="request-url" title={record.request.url}>{prettyUrl(record.request.url)}</span><span className="request-meta"><span className="request-host" title={host}>{host || 'Unknown host'}</span><span>{formatDuration(record.timing?.total)}</span></span></span><span className={statusClass(record.response.status)}>{record.response.status || 'ERR'}</span></button>;
}
function Overview({ record }: { record: RequestRecord }) {
  return <div className="overview"><InfoSection title="Request"><InfoRow label="Method" value={record.request.method} /><InfoRow label="Full URL" value={record.request.url} /><InfoRow label="Host" value={record.request.host ?? hostOf(record.request.url)} /><InfoRow label="Protocol" value={record.meta?.httpVersion ?? 'Unknown'} /></InfoSection><InfoSection title="Response"><InfoRow label="Status" value={`${record.response.status || 'ERR'} ${record.response.statusText ?? ''}`} /><InfoRow label="Content type" value={record.response.mimeType ?? 'Unknown'} /><InfoRow label="Size" value={formatSize(record.meta?.size)} /></InfoSection><InfoSection title="Timing"><InfoRow label="Total" value={formatDuration(record.timing?.total)} /><InfoRow label="Waiting" value={formatDuration(record.timing?.wait)} /><InfoRow label="Download" value={formatDuration(record.timing?.receive)} /></InfoSection><InfoSection title="Context"><InfoRow label="Page" value={record.page.url ?? 'Unknown'} /><InfoRow label="Captured" value={new Date(record.timestamp).toLocaleTimeString()} /><InfoRow label="Source" value={record.meta?.resourceType ?? 'Network'} /></InfoSection>{record.flags.failed && <div className="diagnosis">{record.response.status === 401 ? 'Authentication failure' : record.response.status === 403 ? 'Authorization or permission failure' : record.response.status === 404 ? 'Route or resource not found' : record.response.status === 422 ? 'Validation or semantic error' : record.response.status === 429 ? 'Rate limited' : record.response.status >= 500 ? 'Server or upstream error' : 'Request failed'}. Generic status guidance; inspect the request and response for evidence.</div>}</div>;
}
function InfoSection({ title, children }: { title: string; children: ReactNode }) { return <section className="info-section"><h3>{title}</h3><dl>{children}</dl></section>; }
function InfoRow({ label, value }: { label: string; value: string }) { return <><dt>{label}</dt><dd title={value}>{value}</dd></>; }
function TimingPanel({ record }: { record: RequestRecord }) {
  const rows: Array<[string, number | undefined]> = [['Blocked', record.timing?.blocked], ['DNS', record.timing?.dns], ['Connect', record.timing?.connect], ['SSL', record.timing?.ssl], ['Send', record.timing?.send], ['Waiting', record.timing?.wait], ['Receive', record.timing?.receive], ['Total', record.timing?.total]];
  return <div className="timing-panel">{rows.map(([name, value]) => <div className="timing-row" key={name}><span>{name}</span><div className="timing-track"><i style={{ width: `${value === undefined || !record.timing?.total ? 0 : Math.max(1, Math.min(100, (value / record.timing.total) * 100))}%` }} /></div><code>{formatDuration(value)}</code></div>)}</div>;
}
function BodyPanel({ title, section = 'both', headers, body, unavailable, onCopy }: { title: string; section?: 'both' | 'headers' | 'body'; headers: RequestRecord['request']['headers']; body?: string; unavailable?: string; onCopy: (value: string, label: string) => Promise<void> }) {
  const [mode, setMode] = useState<BodyViewMode>('pretty');
  const shownBody = formatBody(body, mode);
  return <div className="body-panel">
    {(section === 'both' || section === 'headers') && <><div className="section-heading"><h3>{title} headers <span>{headers.length}</span></h3><button className="copy-small" onClick={() => void onCopy(headers.map((h) => `${h.name}: ${h.value}`).join('\n'), `${title} headers`)} disabled={!headers.length}>Copy headers</button></div><HeaderList headers={headers} onCopy={onCopy} emptyLabel="No headers captured." /></>}
    {(section === 'both' || section === 'body') && <><div className={`section-heading ${section === 'both' ? 'body-heading' : ''}`}><h3>{title} body</h3><div className="body-tools"><div className="view-switch" role="group" aria-label={`${title} body format`}><button className={mode === 'pretty' ? 'active' : ''} aria-pressed={mode === 'pretty'} onClick={() => setMode('pretty')}>Pretty</button><button className={mode === 'raw' ? 'active' : ''} aria-pressed={mode === 'raw'} onClick={() => setMode('raw')}>Raw</button></div><button className="copy-small" onClick={() => void onCopy(body ?? '', `${title} body`)} disabled={body === undefined}>Copy body</button></div></div>
    <pre className="body-value">{body === undefined ? unavailable ?? '(empty)' : shownBody || '(empty)'}</pre>
    {unavailable && <small className="hint">Body unavailable: {unavailable}</small>}
    {body?.trim().startsWith('{') || body?.trim().startsWith('[') ? <small className="hint">Pretty view formats valid JSON; Raw preserves the captured text.</small> : null}</>}
  </div>;
}
function HeaderList({ headers, onCopy, sensitiveOnly = false, emptyLabel = 'No matching headers captured.' }: { headers: RequestRecord['request']['headers']; onCopy: (value: string, label: string) => Promise<void>; sensitiveOnly?: boolean; emptyLabel?: string }) {
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const visible = headers.map((header, index) => ({ header, index, secret: Boolean(header.sensitive || detectSecret(header.name, header.value)) })).filter((item) => !sensitiveOnly || item.secret);
  if (!visible.length) return <div className="headers-empty">{emptyLabel}</div>;
  return <div className="header-list">{visible.map(({ header, index, secret }) => <div className={`header-row ${secret ? 'sensitive' : ''}`} key={`${header.name}-${index}`}>
    <span className="header-name" title={header.name}>{header.name}</span>
    <code className="header-value" title={secret && !revealed[index] ? 'Sensitive value hidden' : header.value}>{secret && !revealed[index] ? '••••••••••••' : header.value}</code>
    {secret && <button className="copy-small" aria-label={`${revealed[index] ? 'Hide' : 'Reveal'} ${header.name}`} aria-pressed={Boolean(revealed[index])} onClick={() => setRevealed((current) => ({ ...current, [index]: !current[index] }))}>{revealed[index] ? 'Hide' : 'Reveal'}</button>}
    <button className="copy-small" aria-label={`Copy ${header.name}`} onClick={() => void onCopy(header.value, header.name)}>Copy</button>
  </div>)}</div>;
}
function AuthPanel({ record, onCopy }: { record: RequestRecord; onCopy: (value: string, label: string) => Promise<void> }) {
  const authHeaders = record.request.headers.filter((h) => h.sensitive || detectSecret(h.name, h.value));
  const responseAuthHeaders = record.response.headers.filter((h) => h.sensitive || detectSecret(h.name, h.value));
  return <div className="auth-panel">
    <h3>Detected authentication</h3>
    {record.request.auth ? <p>{record.request.auth.type} · {record.request.auth.source}</p> : <p>No authorization header detected.</p>}
    <section className="auth-header-group" aria-label="Request headers">
      <div className="section-heading"><h3>Request headers <span>{authHeaders.length}</span></h3><button className="copy-small" disabled={!authHeaders.length} onClick={() => void onCopy(authHeaders.map((h) => `${h.name}: ${h.value}`).join('\n'), 'Request headers')}>Copy headers</button></div>
      <HeaderList headers={authHeaders} sensitiveOnly onCopy={onCopy} emptyLabel="No sensitive request headers detected." />
    </section>
    <section className="auth-header-group" aria-label="Response headers">
      <div className="section-heading"><h3>Response headers <span>{responseAuthHeaders.length}</span></h3><button className="copy-small" disabled={!responseAuthHeaders.length} onClick={() => void onCopy(responseAuthHeaders.map((h) => `${h.name}: ${h.value}`).join('\n'), 'Response headers')}>Copy headers</button></div>
      <HeaderList headers={responseAuthHeaders} sensitiveOnly onCopy={onCopy} emptyLabel="No sensitive response headers detected." />
    </section>
    <p className="muted">Sensitive values are hidden on screen. Copy explicitly to place the original value on your clipboard.</p>
  </div>;
}
