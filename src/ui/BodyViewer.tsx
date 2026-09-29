import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { countJsonNodes, detectBodyLanguage, formatViewerText, toJsonPath, type BodyLanguage } from '../core/body-viewer';

type ViewMode = 'tree' | 'pretty' | 'raw';
interface BodyViewerProps {
  title: string;
  body?: string;
  json?: unknown;
  mimeType?: string;
  graphQL?: boolean;
  unavailable?: string;
  status?: string;
  size?: string;
  onCopy: (value: string, label: string) => Promise<void>;
}

export function BodyViewer({ title, body, json, mimeType, graphQL = false, unavailable, status, size, onCopy }: BodyViewerProps) {
  const source = body ?? (json === undefined ? '' : JSON.stringify(json));
  const language = useMemo(() => detectBodyLanguage(mimeType, source, graphQL), [mimeType, source, graphQL]);
  const parsedJson = useMemo(() => {
    if (!language.isJson) return { valid: false, value: undefined };
    if (json !== undefined) return { valid: true, value: json };
    try { return { valid: true, value: JSON.parse(source) as unknown }; } catch { return { valid: false, value: undefined }; }
  }, [json, language.isJson, source]);
  const [mode, setMode] = useState<ViewMode>('pretty');
  const [wrap, setWrap] = useState(false);
  const [search, setSearch] = useState('');
  const [treeExpanded, setTreeExpanded] = useState(false);
  const [treeReset, setTreeReset] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const renderedText = useMemo(() => formatViewerText(source, language.language, mode === 'pretty'), [source, language.language, mode]);
  const matches = useMemo(() => countMatches(renderedText, search), [renderedText, search]);
  const canTree = parsedJson.valid;
  const treeNodeCount = useMemo(() => canTree ? countJsonNodes(parsedJson.value) : 0, [canTree, parsedJson.value]);
  const matchingPaths = useMemo(() => canTree ? findJsonMatches(parsedJson.value, search) : new Set<string>(), [canTree, parsedJson.value, search]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault(); searchRef.current?.focus(); searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  useEffect(() => { if (!canTree && mode === 'tree') setMode('pretty'); }, [canTree, mode]);

  return <section className="body-viewer" aria-label={`${title} body viewer`}>
    <div className="body-viewer-toolbar">
      <div className="body-viewer-heading"><h3>{title} body</h3>{status && <span className="mime-status">{status}</span>}<span className="mime-badge">{language.label}</span>{size && <span className="body-size">{size}</span>}</div>
      <div className="body-viewer-controls">
        {canTree && <div className="view-switch" role="group" aria-label="JSON body view"><button className={mode === 'tree' ? 'active' : ''} aria-pressed={mode === 'tree'} onClick={() => setMode('tree')}>Tree</button><button className={mode === 'pretty' ? 'active' : ''} aria-pressed={mode === 'pretty'} onClick={() => setMode('pretty')}>Pretty</button><button className={mode === 'raw' ? 'active' : ''} aria-pressed={mode === 'raw'} onClick={() => setMode('raw')}>Raw</button></div>}
        {!canTree && <div className="view-switch" role="group" aria-label="Body format"><button className={mode === 'pretty' ? 'active' : ''} aria-pressed={mode === 'pretty'} onClick={() => setMode('pretty')}>Pretty</button><button className={mode === 'raw' ? 'active' : ''} aria-pressed={mode === 'raw'} onClick={() => setMode('raw')}>Raw</button></div>}
        <label className="wrap-toggle"><input type="checkbox" checked={wrap} onChange={(event) => setWrap(event.target.checked)} />Wrap</label>
        <button className="copy-small" onClick={() => void onCopy(source, `${title} body`)} disabled={body === undefined && json === undefined}>Copy</button>
      </div>
    </div>
    <div className="body-search"><input ref={searchRef} aria-label={`Search ${title.toLowerCase()} body`} placeholder="Search body… (Ctrl/Cmd+F)" value={search} onChange={(event) => setSearch(event.target.value)} /><span aria-live="polite">{search ? `${matches} match${matches === 1 ? '' : 'es'}` : ''}</span></div>
    {mode === 'tree' && canTree ? <div className="json-tree-toolbar"><span>JSON structure</span><div><button className="copy-small" onClick={() => { setTreeExpanded(false); setTreeReset((value) => value + 1); }}>Collapse all</button><button className="copy-small" onClick={() => { setTreeExpanded(true); setTreeReset((value) => value + 1); }}>Expand all</button></div></div> : null}
    {mode === 'tree' && canTree
      ? <div className="json-tree-viewport"><JsonTreeNode value={parsedJson.value} name="$" path="$" depth={0} onCopy={onCopy} expandAll={treeExpanded} reset={treeReset} maxDepth={treeNodeCount > 1500 ? 3 : 32} search={search} matchingPaths={matchingPaths} /></div>
      : <VirtualCode text={renderedText} language={language.language} search={search} wrap={wrap} />}
    {unavailable && body === undefined && json === undefined && <small className="hint">Body unavailable: {unavailable}</small>}
    {canTree && treeNodeCount > 1500 && mode === 'tree' && <small className="hint">Large JSON tree expansion is capped at three levels for responsiveness. Expand specific branches as needed.</small>}
  </section>;
}

function JsonTreeNode({ value, name, path, depth, onCopy, expandAll, reset, maxDepth, search, matchingPaths }: {
  value: unknown; name: string; path: string; depth: number; onCopy: (value: string, label: string) => Promise<void>;
  expandAll: boolean; reset: number; maxDepth: number; search: string; matchingPaths: Set<string>;
}) {
  const expandable = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(depth === 0);
  useEffect(() => { if (reset > 0) setOpen(expandAll && depth < maxDepth); }, [reset, expandAll, depth, maxDepth]);
  const entries = useMemo(() => expandable
    ? (Array.isArray(value) ? value.map((entry, index) => [String(index), entry] as const) : Object.entries(value as Record<string, unknown>))
    : [], [expandable, value]);
  const preview = expandable ? `${Array.isArray(value) ? 'Array' : 'Object'}(${entries.length})` : primitiveLabel(value);
  const filteredEntries = search ? entries.filter(([key]) => matchingPaths.has(toJsonPath(path, Array.isArray(value) ? Number(key) : key))) : entries;
  const shown = filteredEntries.slice(0, 200);
  return <div className="json-tree-node">
    <div className="json-tree-row" style={{ paddingInlineStart: `${Math.min(depth, 30) * 16 + 6}px` }}>
      {expandable ? <button className="tree-disclosure" aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`} aria-expanded={open} onClick={() => setOpen((current) => !current)}>{open ? '▾' : '▸'}</button> : <span className="tree-disclosure-placeholder" />}
      <button className="tree-key" title={`Copy JSON path ${path}`} onClick={() => void onCopy(path, 'JSON path')}>{renderInlineSearch(name, search)}</button>
      {expandable ? <span className="tree-summary">{preview}{entries.length > shown.length ? ` · showing ${shown.length}` : ''}</span> : <button className={`tree-value ${jsonValueClass(value)}`} title="Copy value" onClick={() => void onCopy(JSON.stringify(value) ?? String(value), 'JSON value')}>{renderInlineSearch(preview, search)}</button>}
    </div>
    {open && expandable && <div className="json-tree-children">{shown.map(([key, child]) => <JsonTreeNode key={`${path}/${key}`} value={child} name={Array.isArray(value) ? `[${key}]` : key} path={toJsonPath(path, Array.isArray(value) ? Number(key) : key)} depth={depth + 1} onCopy={onCopy} expandAll={expandAll} reset={reset} maxDepth={maxDepth} search={search} matchingPaths={matchingPaths} />)}{!shown.length && search && <div className="tree-truncated" style={{ paddingInlineStart: `${Math.min(depth + 1, 30) * 16 + 6}px` }}>No matching fields in this branch</div>}{filteredEntries.length > shown.length && <div className="tree-truncated" style={{ paddingInlineStart: `${Math.min(depth + 1, 30) * 16 + 6}px` }}>… {filteredEntries.length - shown.length} more matching entries</div>}</div>}
  </div>;
}

function VirtualCode({ text, language, search, wrap }: { text: string; language: BodyLanguage; search: string; wrap: boolean }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 280, width: 640 });
  const lines = useMemo(() => text.split('\n'), [text]);
  useEffect(() => {
    const element = viewportRef.current; if (!element) return;
    const update = () => setViewport({ top: element.scrollTop, height: element.clientHeight, width: element.clientWidth });
    const observer = new ResizeObserver(update); observer.observe(element); update();
    return () => observer.disconnect();
  }, []);
  const rowHeights = useMemo(() => {
    const columns = Math.max(24, Math.floor((viewport.width - 54) / 7.2));
    return lines.map((line) => wrap ? Math.max(1, Math.ceil([...line].length / columns)) : 1);
  }, [lines, viewport.width, wrap]);
  const offsets = useMemo(() => {
    const result = new Array<number>(lines.length + 1); result[0] = 0;
    for (let index = 0; index < lines.length; index += 1) result[index + 1] = result[index]! + rowHeights[index]! * 19;
    return result;
  }, [lines.length, rowHeights]);
  const first = Math.max(0, lineAtOffset(offsets, viewport.top) - 4);
  const last = Math.min(lines.length, lineAtOffset(offsets, viewport.top + viewport.height) + 6);
  const totalHeight = offsets[offsets.length - 1] ?? 19;
  const content = lines.slice(first, last);
  return <div className={`code-viewport ${wrap ? 'wrapped' : ''}`} ref={viewportRef} onScroll={(event) => setViewport((current) => ({ ...current, top: event.currentTarget.scrollTop }))}>
    <div className="code-spacer" style={{ height: `${Math.max(19, totalHeight)}px` }}><div className="virtual-code-lines" style={{ transform: `translateY(${offsets[first] ?? 0}px)` }}>
      {content.map((line, relativeIndex) => {
        const lineNumber = first + relativeIndex + 1;
        return <div className="code-line" key={lineNumber} style={{ minHeight: `${rowHeights[first + relativeIndex]! * 19}px` }}><span className="line-number" aria-hidden="true">{lineNumber}</span><code>{renderSyntaxLine(line, language, search)}</code></div>;
      })}
    </div></div>
  </div>;
}

function lineAtOffset(offsets: number[], target: number): number {
  let low = 0; let high = offsets.length - 1;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (offsets[middle + 1]! <= target) low = middle + 1; else high = middle; }
  return low;
}

interface Token { text: string; kind?: string }
function renderSyntaxLine(line: string, language: BodyLanguage, search: string): ReactNode[] {
  const tokens = tokenize(line, language);
  let key = 0;
  return tokens.flatMap((token) => splitSearch(token.text, search).map((part) => {
    const id = key++;
    if (part.match) return <mark className="search-hit" key={id}>{part.text}</mark>;
    return token.kind ? <span className={`syntax-${token.kind}`} key={id}>{part.text}</span> : part.text;
  }));
}

function tokenize(line: string, language: BodyLanguage): Token[] {
  if (language === 'text') return [{ text: line }];
  const pattern = language === 'json'
    ? /("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b(?:true|false|null)\b)/g
    : language === 'html' || language === 'xml'
      ? /(<!--[\s\S]*?-->|<!DOCTYPE\b[^>]*>|<\/?[\w:-]+|\/?>|\b[\w:-]+(?=\s*=)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi
      : language === 'css'
        ? /(\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[\da-f]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|s|ms|vh|vw)?\b|[\w-]+(?=\s*:))/gi
        : /(\/\/.*$|\/\*.*?\*\/|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:const|let|var|function|return|if|else|await|async|new|throw|try|catch|class|import|export|from|true|false|null|undefined)\b|-?\b\d+(?:\.\d+)?\b)/g;
  const result: Token[] = []; let cursor = 0; let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    if (match.index > cursor) result.push({ text: line.slice(cursor, match.index) });
    const value = match[0]; result.push({ text: value, kind: classifyToken(value, language, line.slice(match.index + value.length)) }); cursor = match.index + value.length;
  }
  if (cursor < line.length) result.push({ text: line.slice(cursor) });
  if (!result.length) result.push({ text: line });
  return result;
}

function classifyToken(value: string, language: BodyLanguage, following: string): string {
  if (language === 'json') {
    if (value.startsWith('"')) return /^\s*:/.test(following) ? 'key' : 'string';
    if (/^-?\d/.test(value)) return 'number';
    return value === 'null' ? 'null' : 'boolean';
  }
  if (/^(?:\/\/|\/\*|<!--)/.test(value)) return 'comment';
  if (value.startsWith('"') || value.startsWith("'") || value.startsWith('`')) return 'string';
  if (/^<\/?[\w:-]+/.test(value) || /^<!/i.test(value) || /^(?:\/?>)$/.test(value)) return 'tag';
  if (/^#[\da-f]/i.test(value)) return 'number';
  if (/^-?\d/.test(value)) return 'number';
  if (/^(?:true|false|null|undefined)$/.test(value)) return 'boolean';
  if (/^(?:const|let|var|function|return|if|else|await|async|new|throw|try|catch|class|import|export|from)$/.test(value)) return 'keyword';
  return language === 'html' || language === 'xml' ? 'attribute' : 'property';
}

function splitSearch(text: string, query: string): Array<{ text: string; match: boolean }> {
  if (!query) return [{ text, match: false }];
  const result: Array<{ text: string; match: boolean }> = []; const lower = text.toLowerCase(); const needle = query.toLowerCase();
  let cursor = 0; let index = lower.indexOf(needle, cursor);
  while (index >= 0) { if (index > cursor) result.push({ text: text.slice(cursor, index), match: false }); result.push({ text: text.slice(index, index + query.length), match: true }); cursor = index + query.length; index = lower.indexOf(needle, cursor); }
  if (cursor < text.length || !result.length) result.push({ text: text.slice(cursor), match: false });
  return result;
}

function countMatches(text: string, query: string): number {
  if (!query) return 0;
  let count = 0; let index = 0; const source = text.toLowerCase(); const target = query.toLowerCase();
  while ((index = source.indexOf(target, index)) >= 0) { count += 1; index += target.length; }
  return count;
}

function findJsonMatches(value: unknown, query: string): Set<string> {
  const matches = new Set<string>();
  const needle = query.trim().toLowerCase();
  if (!needle) return matches;
  const stack: Array<{ value: unknown; path: string; parents: string[] }> = [{ value, path: '$', parents: [] }];
  let visited = 0;
  while (stack.length && visited < 20_000) {
    const current = stack.pop()!; visited += 1;
    if (current.value && typeof current.value === 'object') {
      const entries = Array.isArray(current.value) ? current.value.map((child, index) => [String(index), child] as const) : Object.entries(current.value as Record<string, unknown>);
      for (const [key, child] of entries) {
        const childPath = toJsonPath(current.path, Array.isArray(current.value) ? Number(key) : key);
        if (key.toLowerCase().includes(needle) || (!child || typeof child !== 'object') && primitiveLabel(child).toLowerCase().includes(needle)) {
          matches.add(childPath); for (const parent of current.parents) matches.add(parent); matches.add(current.path);
        }
        if (child && typeof child === 'object') stack.push({ value: child, path: childPath, parents: [...current.parents, current.path] });
      }
    } else if (primitiveLabel(current.value).toLowerCase().includes(needle)) {
      matches.add(current.path); for (const parent of current.parents) matches.add(parent);
    }
  }
  return matches;
}

function renderInlineSearch(text: string, query: string): ReactNode[] {
  return splitSearch(text, query).map((part, index) => part.match ? <mark className="search-hit" key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>);
}

function primitiveLabel(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.length > 180 ? `${value.slice(0, 177)}…` : value);
  return JSON.stringify(value) ?? 'undefined';
}
function jsonValueClass(value: unknown): string {
  if (value === null) return 'tree-null';
  if (typeof value === 'string') return 'tree-string';
  if (typeof value === 'number') return 'tree-number';
  if (typeof value === 'boolean') return 'tree-boolean';
  return '';
}
