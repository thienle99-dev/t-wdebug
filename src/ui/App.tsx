import { Component, useEffect, useMemo, useRef, useState, type CSSProperties, type ErrorInfo, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { clearDebugRecords, clearRequests, getComponentScreenshot, getComponentSnapshots, getDebugRecords, saveComponentSnapshot } from '../storage/indexed-db';
import { getPreferences, savePreferences } from '../storage/preferences';
import { useRequestStore } from '../shared/store';
import type { AppearanceTheme, BodyContent, ComponentCaptureMode, ConsoleRecord, DebugInsight, DebugRecord, PerformanceRecord, Preferences, RequestRecord, UIComponentSnapshot, UIElementRecord } from '../shared/types';
import { toAIPrompt, toAxios, toCurl, toDebugBundle, toFetch, toFullDebug, toMarkdownBugReport, toPostman, toRawHttp } from '../core/formatters';
import { detectSecret, redactRecord, redactUrlValue } from '../core/secrets';
import { BodyViewer } from './BodyViewer';
import { DebugModes, type ProductMode } from './DebugModes';
import { deriveInsights } from '../core/debug-insights';
import { calculateScreenshotCrop, cropScreenshot, makeComponentSnapshot } from '../ui-inspector/component-snapshot';
import '../styles.css';

type DetailTab = 'overview' | 'request' | 'response' | 'headers' | 'timing' | 'auth' | 'ai';
const devtoolsModes: Array<[ProductMode, string]> = [['network', 'Network'], ['ui', 'UI Inspector'], ['console', 'Console'], ['performance', 'Performance'], ['flows', 'Flows']];
const popupModes: Array<[ProductMode, string]> = [['recent', 'Recent'], ['network', 'Network'], ['ui', 'UI'], ['console', 'Errors']];
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
  const { requests, selectedId, loading, storageError, refresh, select, remove, togglePin } = useRequestStore();
  const [query, setQuery] = useState(''); const [tab, setTab] = useState<DetailTab>('overview');
  const [mode, setMode] = useState<ProductMode>(devtoolsTabId === undefined ? 'recent' : 'network');
  const [debugRecords, setDebugRecords] = useState<DebugRecord[]>([]);
  const [componentSnapshots, setComponentSnapshots] = useState<UIComponentSnapshot[]>([]);
  const [capture, setCapture] = useState(false);
  const [pageHookCapture, setPageHookCapture] = useState(false);
  const [activeTabUrl, setActiveTabUrl] = useState<string>();
  const [includeSecrets, setIncludeSecrets] = useState(false); const [prefs, setPrefs] = useState<Preferences>(); const [notice, setNotice] = useState('');
  const [appearance, setAppearance] = useState<AppearanceTheme>('system');
  const [sidebarWidth, setSidebarWidth] = useState(34);
  const [domainFilter, setDomainFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [hasAuthOnly, setHasAuthOnly] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const mainContentRef = useRef<HTMLElement>(null);
  const popupLayoutDebug = devtoolsTabId === undefined && import.meta.env.DEV && new URLSearchParams(window.location.search).get('debugLayout') === '1';
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
    if (!popupLayoutDebug) return;
    document.documentElement.dataset.debugLayout = 'true';
    const frame = window.requestAnimationFrame(() => {
      const dimensions = (element: Element | null) => {
        const rect = element?.getBoundingClientRect();
        return rect ? { width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top) } : null;
      };
      console.info('[Debug Lens popup layout]', {
        window: { width: window.innerWidth, height: window.innerHeight },
        document: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
        root: dimensions(document.getElementById('root')),
        popupShell: dimensions(document.querySelector('.popup-shell')),
        mainContent: dimensions(mainContentRef.current),
      });
    });
    return () => { window.cancelAnimationFrame(frame); delete document.documentElement.dataset.debugLayout; };
  }, [popupLayoutDebug]);
  useEffect(() => {
    if (appearance !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => { document.documentElement.dataset.theme = media.matches ? 'dark' : 'light'; document.documentElement.style.colorScheme = media.matches ? 'dark' : 'light'; };
    media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, [appearance]);
  const [activeTabId, setActiveTabId] = useState<number | undefined>(devtoolsTabId);
  const tabId = devtoolsTabId ?? activeTabId;
  useEffect(() => {
    if (devtoolsTabId !== undefined) {
      setActiveTabId(devtoolsTabId);
      chrome.devtools.inspectedWindow.eval('location.href', (value) => { if (typeof value === 'string') setActiveTabUrl(value); });
      return;
    }
    void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([active]) => { setActiveTabId(active?.id); setActiveTabUrl(active?.url); }).catch(() => undefined);
  }, [devtoolsTabId]);
  useEffect(() => {
    if (tabId === undefined) { setCapture(false); setPageHookCapture(false); return; }
    let cancelled = false;
    const updateStatus = () => {
      void chrome.runtime.sendMessage({ type: 'capture:status', tabId })
        .then((response) => { if (!cancelled) { setCapture(response?.state === 'active' || response?.active === true); setPageHookCapture(response?.pageHookActive === true); } })
        .catch(() => { if (!cancelled) { setCapture(false); setPageHookCapture(false); } });
    };
    updateStatus();
    const timer = window.setInterval(updateStatus, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [tabId]);
  useEffect(() => {
    let cancelled = false;
    const refreshDebug = async () => {
      const kinds = await Promise.all([
        getDebugRecords('ui-snapshot', tabId), getDebugRecords('event', tabId), getDebugRecords('console', tabId),
        getDebugRecords('mutation', tabId), getDebugRecords('performance', tabId),
      ]);
      const componentSnapshots = await getComponentSnapshots(tabId);
      if (!cancelled) {
        const next = kinds.flat().sort((a, b) => b.timestamp - a.timestamp) as DebugRecord[];
        setDebugRecords((current) => current.length === next.length && current.every((item, index) => item.id === next[index]?.id && item.timestamp === next[index]?.timestamp) ? current : next);
        setComponentSnapshots((current) => current.length === componentSnapshots.length && current.every((item, index) => item.id === componentSnapshots[index]?.id && item.timestamp === componentSnapshots[index]?.timestamp) ? current : componentSnapshots);
      }
    };
    void refreshDebug().catch(() => undefined);
    const timer = window.setInterval(() => void refreshDebug().catch(() => undefined), 1200);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [tabId]);
  const tabRequests = tabId === undefined ? requests : requests.filter((item) => item.tabId === undefined || item.tabId === tabId);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tabRequests.filter((r) => !q || `${r.request.method} ${r.request.url} ${r.response.status} ${r.response.statusText ?? ''}`.toLowerCase().includes(q));
  }, [tabRequests, query]);
  const domains = useMemo(() => [...new Set(tabRequests.flatMap((item) => { try { return [new URL(item.request.url).host]; } catch { return []; } }))].sort(), [tabRequests]);
  const shownRequests = filtered.filter((item) => {
    const status = item.response.status;
    const inStatus = statusFilter === 'all' || (statusFilter === '2xx' && status >= 200 && status < 300) || (statusFilter === '3xx' && status >= 300 && status < 400) || (statusFilter === '4xx' && status >= 400 && status < 500) || (statusFilter === '5xx' && status >= 500);
    let host = ''; try { host = new URL(item.request.url).host; } catch { /* Keep malformed captured URLs filterable. */ }
    return inStatus && (!domainFilter || domainFilter === host) && (!hasAuthOnly || item.flags.hasAuth);
  });
  const visibleRequests = devtoolsTabId === undefined ? shownRequests.slice(0, 20) : shownRequests;
  const insights: DebugInsight[] = useMemo(() => deriveInsights(tabRequests, debugRecords.filter((item): item is UIElementRecord => item.kind === 'ui-snapshot'), debugRecords.filter((item): item is ConsoleRecord => item.kind === 'console'), debugRecords.filter((item): item is PerformanceRecord => item.kind === 'performance')), [tabRequests, debugRecords]);
  const selected = visibleRequests.find((item) => item.id === selectedId) ?? visibleRequests.find((item) => item.flags.failed) ?? visibleRequests[0];
  const safeSelected = useMemo(() => selected ? redactRecord(selected) : undefined, [selected]);
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setNotice(`${label} copied`); window.setTimeout(() => setNotice(''), 1800); }
    catch { setNotice('Clipboard unavailable. Check extension clipboard access.'); window.setTimeout(() => setNotice(''), 2800); }
  }
  async function changeSecrets(enabled: boolean) { setIncludeSecrets(enabled); await savePreferences({ includeSecretsInCopy: enabled }); }
  async function changeAppearance(value: AppearanceTheme) { setAppearance(value); await savePreferences({ theme: value }); }
  async function togglePageHook() {
    if (tabId === undefined || !activeTabUrl) { setNotice('The current page URL is unavailable.'); return; }
    let page: URL;
    try { page = new URL(activeTabUrl); } catch { setNotice('API Lens cannot capture this browser page.'); return; }
    if (!['http:', 'https:'].includes(page.protocol)) { setNotice('API Lens can capture HTTP and HTTPS pages only.'); return; }
    if (pageHookCapture) {
      const result = await chrome.runtime.sendMessage({ type: 'capture:hook:stop', tabId, origin: page.origin }).catch(() => undefined);
      if (!result?.ok) { setNotice(result?.error ?? 'Unable to stop capture for this tab.'); return; }
      setPageHookCapture(false); setNotice('Page capture stopped'); return;
    }
    const pattern = `${page.protocol}//${page.hostname}/*`;
    try {
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) { setNotice('Site access was not granted. Existing history is unchanged.'); return; }
      const result = await chrome.runtime.sendMessage({ type: 'capture:hook:start', tabId, origin: page.origin });
      if (!result?.ok) throw new Error(result?.error ?? 'Capture could not start.');
      setPageHookCapture(true); setCapture(true); setNotice('Capturing fetch and XHR on this tab');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Capture could not start.'); }
  }
  async function startElementPicker() {
    if (tabId === undefined || !activeTabUrl) { setNotice('The current page URL is unavailable.'); return; }
    let page: URL;
    try { page = new URL(activeTabUrl); } catch { setNotice('UI inspection is unavailable on this page.'); return; }
    if (!['http:', 'https:'].includes(page.protocol)) { setNotice('UI inspection works on HTTP and HTTPS pages only.'); return; }
    const pattern = `${page.protocol}//${page.hostname}/*`;
    try {
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) { setNotice('Site access was not granted.'); return; }
      const result = await chrome.runtime.sendMessage({ type: 'debug:ui:pick', tabId });
      if (!result?.ok) throw new Error(result?.error ?? 'Element picker could not start.');
      setNotice('Picker active on page · press Escape to cancel');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Element picker could not start.'); }
  }
  async function captureComponent(element: UIElementRecord, mode: ComponentCaptureMode, padding: number, relatedRequestIds: string[], relatedConsoleIds: string[]): Promise<UIComponentSnapshot> {
    if (tabId === undefined) throw new Error('The inspected tab is unavailable.');
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) throw new Error('Activate the inspected page tab before capturing its visible screenshot.');
    const page = new URL(element.page.url);
    const originPermission = `${page.protocol}//${page.hostname}/*`;
    if (!await chrome.permissions.contains({ origins: [originPermission] })) throw new Error('Grant site access before capturing a component screenshot.');
    const viewport = { width: element.viewport?.width ?? element.page.viewportWidth, height: element.viewport?.height ?? element.page.viewportHeight, devicePixelRatio: element.viewport?.devicePixelRatio ?? window.devicePixelRatio ?? 1 };
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const image = new Image(); image.src = dataUrl; await image.decode();
    const crop = calculateScreenshotCrop({ x: element.bounds.left, y: element.bounds.top, width: element.bounds.width, height: element.bounds.height }, viewport, { width: image.naturalWidth, height: image.naturalHeight }, mode, padding);
    const cropped = await cropScreenshot(dataUrl, crop);
    const snapshot = makeComponentSnapshot({
      id: crypto.randomUUID(), tabId, timestamp: Date.now(), mode, contextPadding: mode === 'context' ? padding : 0,
      element: { selector: element.selector, tagName: element.tagName, text: element.text?.slice(0, 1000), outerHTML: element.html?.slice(0, 8000) },
      screenshot: { width: cropped.width, height: cropped.height, mimeType: 'image/png', partial: crop.partial, visibleBounds: crop.visibleBounds },
      bounds: { x: element.bounds.x, y: element.bounds.y, width: element.bounds.width, height: element.bounds.height }, viewport,
      styles: element.styles.computed, accessibility: element.accessibility, pageUrl: element.page.url,
      relatedRequestIds, relatedConsoleIds,
    }, cropped);
    await saveComponentSnapshot(snapshot);
    setComponentSnapshots(await getComponentSnapshots(tabId));
    setNotice(crop.partial ? 'Visible portion captured; the selected element extends beyond the viewport.' : 'Component snapshot captured');
    return snapshot;
  }
  async function stopElementTracking() { if (tabId !== undefined) await chrome.runtime.sendMessage({ type: 'debug:ui:stop', tabId }).catch(() => undefined); }
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
  async function clearHistory() { if (!window.confirm('Clear all captured requests and page debug history? Pinned requests will also be removed.')) return; await Promise.all([clearRequests(), clearDebugRecords()]); await refresh(); setDebugRecords([]); }
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
  const captureLabel = pageHookCapture ? 'Capturing this tab' : capture ? 'DevTools capture' : 'Live capture unavailable';
  return <main className={devtoolsTabId === undefined ? 'app popup popup-shell' : 'app panel'}>
    <header className={devtoolsTabId === undefined ? 'topbar popup-header' : 'topbar'}><div className="brand"><span className="brand-mark" aria-hidden="true">◇</span><strong className="brand-title">Debug Lens</strong><span className="count request-count" title={`${requests.length} captured requests`}>{requests.length}</span></div>{devtoolsTabId === undefined && <span className="header-spacer" />}<div className="top-actions"><span className={`capture-state ${devtoolsTabId === undefined ? 'capture-status' : ''} ${capture ? 'on' : ''}`} role="status"><i className={devtoolsTabId === undefined ? 'capture-dot' : undefined} aria-hidden="true" /><span className={devtoolsTabId === undefined ? 'capture-status-label' : undefined}>{captureLabel}</span></span><label className="theme-control"><span className="visually-hidden">Appearance</span><select className={devtoolsTabId === undefined ? 'theme-select' : undefined} aria-label="Appearance" title={`Appearance: ${appearance}`} value={appearance} onChange={(event) => void changeAppearance(event.target.value as AppearanceTheme)}><option value="system">System theme</option><option value="light">Light theme</option><option value="dark">Dark theme</option></select></label></div></header>
    {devtoolsTabId === undefined && <aside className="capture-hint" role="status"><span>{pageHookCapture ? 'Page hook is capturing fetch/XHR on this tab.' : capture ? 'DevTools is capturing. Enable the page hook to capture without DevTools.' : 'Capture fetch/XHR on this tab without opening DevTools. Saved history remains available.'}</span><button className={pageHookCapture ? '' : 'primary'} onClick={() => void togglePageHook()} disabled={!activeTabUrl}>{pageHookCapture ? 'Stop site capture' : 'Capture this site'}</button></aside>}
    <nav className="product-nav" aria-label="Debug areas" role="tablist">{(devtoolsTabId === undefined ? popupModes : devtoolsModes).map(([key, label]) => <button key={key} role="tab" aria-selected={mode === key} className={mode === key ? 'selected' : ''} onClick={() => setMode(key)}>{label}{key === 'console' && debugRecords.some((item) => item.kind === 'console' && item.level === 'error') ? <span className="nav-count">{debugRecords.filter((item) => item.kind === 'console' && item.level === 'error').length}</span> : null}</button>)}</nav>
    <section className="main-content" ref={mainContentRef} aria-live="polite">
    <MainContentBoundary>
    {loading && !requests.length ? <div className="main-loading" role="status">Loading captured requests…</div> : storageError && !requests.length ? <div className="storage-failure" role="alert"><strong>Unable to load local request history.</strong><span>The local database could not be read. Your existing data has not been cleared.</span><button className="primary" onClick={() => void refresh()}>Retry</button></div> : <>
    {mode !== 'network' && <DebugModes mode={mode} records={debugRecords} requests={tabRequests} insights={insights} componentSnapshots={componentSnapshots} onCaptureComponent={captureComponent} onLoadComponentImage={getComponentScreenshot} onPick={() => void startElementPicker()} onStop={() => void stopElementTracking()} onCopy={(value, label) => { if (value) void copy(value, label); else setNotice(label); }} />}
    {mode === 'network' && <>
    <section className="toolbar"><label className="search-field"><span aria-hidden="true">⌕</span><input aria-label="Search requests" placeholder="Search URL, method, status…" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button className="clear-search" aria-label="Clear search" onClick={() => setQuery('')}>×</button>}</label><select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All status</option><option value="2xx">2xx</option><option value="3xx">3xx</option><option value="4xx">4xx</option><option value="5xx">5xx</option></select><select aria-label="Filter by domain" value={domainFilter} onChange={(event) => setDomainFilter(event.target.value)}><option value="">All domains</option>{domains.map((domain) => <option key={domain} value={domain}>{domain}</option>)}</select><button className={`filter-chip ${hasAuthOnly ? 'active' : ''}`} aria-pressed={hasAuthOnly} onClick={() => setHasAuthOnly(!hasAuthOnly)}>Has auth</button><details className="menu sensitive-menu"><summary>{includeSecrets ? 'Sensitive: reveal ▾' : 'Sensitive: mask ▾'}</summary><div className="menu-popover menu-align-right" role="menu"><button role="menuitemradio" aria-checked={!includeSecrets} onClick={(event) => { closeMenu(event); void changeSecrets(false); }}>Mask secrets</button><button role="menuitemradio" aria-checked={includeSecrets} onClick={(event) => { closeMenu(event); void changeSecrets(true); }}>Reveal in copies</button></div></details><details className="menu clear-menu"><summary className="quiet">Clear ▾</summary><div className="menu-popover menu-align-right"><button className="danger-action" onClick={(event) => { closeMenu(event); void clearHistory(); }}>Clear all history</button></div></details></section>
      <section className="workspace" ref={workspaceRef} style={{ '--sidebar-width': `${sidebarWidth}%` } as CSSProperties}><aside className="request-list" aria-label="Captured requests"><div className="list-heading"><strong>Requests</strong><span>{visibleRequests.length} {visibleRequests.length === 1 ? 'request' : 'requests'}</span></div>{loading && !requests.length ? <div className="empty">Loading local history…</div> : visibleRequests.length ? visibleRequests.map((r) => <RequestRow key={r.id} record={r} selected={selected?.id === r.id} onClick={() => select(r.id)} />) : <div className="empty"><strong>No API requests captured yet.</strong><span>{pageHookCapture ? 'Use the app in this tab; fetch and XHR traffic will appear here.' : devtoolsTabId !== undefined || capture ? 'Waiting for API traffic…' : 'Choose “Capture this site” to capture fetch/XHR without opening DevTools.'}</span><small>Traffic stays in this browser unless you explicitly copy or send it.</small></div>}</aside><button className="workspace-splitter" role="separator" aria-orientation="vertical" aria-label="Resize request list" aria-valuemin={25} aria-valuemax={55} aria-valuenow={Math.round(sidebarWidth)} onPointerDown={resizeSidebar} onKeyDown={resizeWithKeyboard} />
      <section className="details">{selected ? <><div className="selected-head"><div className="endpoint"><div className="endpoint-title"><span className="method">{selected.request.method}</span><strong title={safeSelected?.request.url}>{prettyUrl(safeSelected?.request.url ?? selected.request.url)}</strong><span className={statusClass(selected.response.status)}>{selected.response.status || 'ERR'} {selected.response.statusText}</span></div><div className="endpoint-meta"><span>{selected.request.host ?? hostOf(selected.request.url)}</span><span>{formatDuration(selected.timing?.total)}</span><span>{formatSize(selected.meta?.size)}</span><span>{selected.meta?.resourceType ?? 'request'}</span><span>{selected.meta?.httpVersion}</span></div></div><div className="row-actions"><button className={`icon-button pin-action ${selected.flags.pinned ? 'pinned' : ''}`} aria-label={selected.flags.pinned ? 'Unpin request' : 'Pin request'} title={selected.flags.pinned ? 'Unpin request' : 'Pin request'} onClick={() => void togglePin(selected.id)}>{selected.flags.pinned ? '★' : '☆'}</button><details className="menu row-menu"><summary className="icon-button" aria-label="Request actions">•••</summary><div className="menu-popover menu-align-right"><button onClick={(event) => { closeMenu(event); void copy(selected.request.url, 'URL'); }}>Copy URL</button><button className="danger-action" onClick={(event) => { closeMenu(event); void remove(selected.id); }}>Delete request</button></div></details></div></div>
        <nav className="tabs" aria-label="Request details" role="tablist">{(['overview', 'request', 'response', 'headers', 'timing'] as DetailTab[]).map((name) => <button key={name} id={`request-tab-${name}`} role="tab" aria-controls="request-detail-panel" aria-selected={tab === name} className={tab === name ? 'selected' : ''} onClick={() => setTab(name)}>{name}</button>)}<details className="menu more-tabs"><summary>More ▾</summary><div className="menu-popover"><button id="request-tab-auth" role="tab" aria-controls="request-detail-panel" aria-selected={tab === 'auth'} onClick={(event) => { closeMenu(event); setTab('auth'); }}>Authentication</button><button id="request-tab-ai" role="tab" aria-controls="request-detail-panel" aria-selected={tab === 'ai'} onClick={(event) => { closeMenu(event); setTab('ai'); }}>AI prompt</button></div></details></nav>
        <div className="detail-content" id="request-detail-panel" role="tabpanel" aria-labelledby={`request-tab-${tab}`} tabIndex={0}><div key={tab} className="detail-tab-pane" data-state="active">{tab === 'overview' && safeSelected && <Overview record={safeSelected} />}{tab === 'request' && safeSelected && <BodyPanel title="Request" headers={selected.request.headers} body={bodyForDisplay(safeSelected.request.body)} mimeType={safeSelected.request.body?.mimeType} json={safeSelected.request.body?.json} graphQL={/graphql/i.test(selected.request.url)} unavailable={undefined} onCopy={copy} />}{tab === 'headers' && <><BodyPanel title="Request" section="headers" headers={selected.request.headers} body={undefined} onCopy={copy} /><BodyPanel title="Response" section="headers" headers={selected.response.headers} body={undefined} onCopy={copy} /></>}{tab === 'response' && safeSelected && <BodyPanel title="Response" section="body" headers={[]} body={safeSelected.response.body?.text} json={safeSelected.response.body?.json} mimeType={safeSelected.response.mimeType} graphQL={/graphql/i.test(selected.request.url)} unavailable={safeSelected.response.body?.unavailableReason} status={`${selected.response.status || 'ERR'} ${selected.response.statusText ?? ''}`.trim()} size={formatSize(selected.meta?.size)} onCopy={copy} />}{tab === 'timing' && <TimingPanel record={selected} />}{tab === 'auth' && <AuthPanel record={selected} onCopy={copy} />}{tab === 'ai' && <section className="ai-panel"><div className="ai-heading">Manual AI debug prompt <span>redacted by default</span></div><p>Review the included context, then copy it into your preferred AI tool. API Lens does not send data automatically.</p><pre>{toAIPrompt(selected)}</pre><button className="primary" onClick={() => copyAction('ai', selected)}>Copy AI prompt</button></section>}</div></div>
        <div className="action-bar"><button className="primary" onClick={() => copyAction('full')}>Copy debug</button><button className="secondary-action" onClick={() => copyAction('curl')}>Copy cURL</button><button className="ai-action" onClick={() => copyAction('ai')}>Ask AI</button><span className="action-spacer" /><details className="menu action-menu"><summary>Copy ▾</summary><div className="menu-popover menu-align-right"><button onClick={(event) => { closeMenu(event); copyAction('request'); }}>Request</button><button onClick={(event) => { closeMenu(event); copyAction('response'); }}>Response</button><button onClick={(event) => { closeMenu(event); copyAction('safe-curl'); }}>Safe cURL</button><button onClick={(event) => { closeMenu(event); copyAction('fetch'); }}>JavaScript fetch</button><button onClick={(event) => { closeMenu(event); copyAction('axios'); }}>Axios</button><button onClick={(event) => { closeMenu(event); copyAction('raw'); }}>Raw HTTP</button><button onClick={(event) => { closeMenu(event); copyAction('bundle'); }}>Safe debug bundle</button></div></details><details className="menu action-menu"><summary>Export ▾</summary><div className="menu-popover menu-align-right"><button onClick={(event) => { closeMenu(event); copyAction('postman'); }}>Postman collection</button><button onClick={(event) => { closeMenu(event); copyAction('bug'); }}>Markdown bug report</button></div></details></div>
      </> : <div className="empty detail-empty">Select a request to inspect its details.</div>}</section>
    </section></>}
    </>}
    </MainContentBoundary>
    </section>
    <footer><span>Local history · max {prefs?.maxRequests ?? 500} requests</span><span>{notice || 'No traffic is sent automatically'}</span></footer>
  </main>;
}

interface MainContentBoundaryState { failed: boolean }
class MainContentBoundary extends Component<{ children: ReactNode }, MainContentBoundaryState> {
  state: MainContentBoundaryState = { failed: false };
  static getDerivedStateFromError(): MainContentBoundaryState { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Do not log captured records or error messages that may contain user data.
    console.error('[Debug Lens] Main content rendering failed.', { name: error.name, componentStack: info.componentStack?.slice(0, 1000) });
  }
  render() {
    if (this.state.failed) return <div className="layout-error" role="alert"><strong>Something went wrong rendering the main content.</strong><span>The header is still available. Retry the view to render it again.</span><button onClick={() => this.setState({ failed: false })}>Retry</button></div>;
    return this.props.children;
  }
}

function RequestRow({ record, selected, onClick }: { record: RequestRecord; selected: boolean; onClick: () => void }) {
  const safeUrl = redactUrlValue(record.request.url);
  let host = ''; try { host = new URL(record.request.url).host; } catch { /* Preserve malformed captured URLs for inspection. */ }
  return <button className={`request-row ${selected ? 'selected' : ''} ${record.flags.failed ? 'failed' : ''}`} aria-current={selected ? 'true' : undefined} onClick={onClick}><span className="method">{record.request.method}</span><span className="request-copy"><span className="request-url" title={safeUrl}>{prettyUrl(safeUrl)}</span><span className="request-meta"><span className="request-host" title={host}>{host || 'Unknown host'}</span><span>{formatDuration(record.timing?.total)}</span></span></span><span className={statusClass(record.response.status)}>{record.response.status || 'ERR'}</span></button>;
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
function BodyPanel({ title, section = 'both', headers, body, json, mimeType, graphQL = false, unavailable, status, size, onCopy }: { title: string; section?: 'both' | 'headers' | 'body'; headers: RequestRecord['request']['headers']; body?: string; json?: unknown; mimeType?: string; graphQL?: boolean; unavailable?: string; status?: string; size?: string; onCopy: (value: string, label: string) => Promise<void> }) {
  return <div className={`body-panel ${section === 'body' ? 'body-only-panel' : ''}`}>
    {(section === 'both' || section === 'headers') && <><div className="section-heading"><h3>{title} headers <span>{headers.length}</span></h3><button className="copy-small" onClick={() => void onCopy(headers.map((h) => `${h.name}: ${h.value}`).join('\n'), `${title} headers`)} disabled={!headers.length}>Copy headers</button></div><HeaderList headers={headers} onCopy={onCopy} emptyLabel="No headers captured." /></>}
    {(section === 'both' || section === 'body') && <BodyViewer title={title} body={body} json={json} mimeType={mimeType} graphQL={graphQL} unavailable={unavailable} status={status} size={size} onCopy={onCopy} />}
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
