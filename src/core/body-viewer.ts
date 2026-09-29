export type BodyLanguage = 'json' | 'html' | 'xml' | 'css' | 'javascript' | 'text';

export interface BodyLanguageInfo {
  language: BodyLanguage;
  label: string;
  isJson: boolean;
}

export function detectBodyLanguage(mimeType: string | undefined, text: string, graphQL = false): BodyLanguageInfo {
  const mime = mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (graphQL || /graphql/i.test(mime)) return { language: 'json', label: 'GraphQL · JSON', isJson: true };
  if (/^(?:application\/(?:[^/]+\+)?json|text\/json)$/.test(mime)) return { language: 'json', label: 'JSON', isJson: true };
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return { language: 'html', label: 'HTML', isJson: false };
  if (/^(?:application|text)\/(?:[^/]+\+)?xml$/.test(mime)) return { language: 'xml', label: 'XML', isJson: false };
  if (mime === 'text/css') return { language: 'css', label: 'CSS', isJson: false };
  if (/^(?:application|text)\/(?:javascript|ecmascript|x-javascript)$/.test(mime)) return { language: 'javascript', label: 'JavaScript', isJson: false };
  if (mime.startsWith('text/')) return { language: 'text', label: 'Text', isJson: false };

  const trimmed = text.trimStart();
  try { JSON.parse(text); return { language: 'json', label: 'JSON', isJson: true }; } catch { /* Use content signatures below. */ }
  if (/^(?:<!doctype\s+html|<html\b)/i.test(trimmed)) return { language: 'html', label: 'HTML', isJson: false };
  if (/^(?:<\?xml\b|<[A-Za-z_:][\w:.-]*(?:\s|>|\/))/i.test(trimmed)) return { language: 'xml', label: 'XML', isJson: false };
  return { language: 'text', label: 'Raw', isJson: false };
}

/** Read-only display formatting. The captured source string is never changed. */
export function formatViewerText(text: string, language: BodyLanguage, pretty: boolean): string {
  if (!pretty) return text;
  if (language === 'json') {
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
  }
  if (language === 'html' || language === 'xml') return formatMarkup(text);
  return text;
}

function formatMarkup(source: string): string {
  const tokens = source.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[\w:-]+(?:\s[^<>]*?)?\/?>|[^<>]+/g);
  if (!tokens) return source;
  const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const output: string[] = [];
  let depth = 0;
  for (const token of tokens) {
    const value = token.trim();
    if (!value) continue;
    const closing = /^<\//.test(value);
    const opening = /^<[A-Za-z]/.test(value);
    const selfClosing = /\/>$/.test(value) || (opening && voidElements.has(value.match(/^<([\w:-]+)/)?.[1]?.toLowerCase() ?? ''));
    if (closing) depth = Math.max(0, depth - 1);
    output.push(`${'  '.repeat(Math.min(depth, 40))}${value}`);
    if (opening && !closing && !selfClosing && !/^<(?:script|style)\b/i.test(value)) depth += 1;
  }
  return output.join('\n');
}

export function countJsonNodes(value: unknown, limit = 1500): number {
  let count = 0;
  const pending: unknown[] = [value];
  while (pending.length && count < limit) {
    const current = pending.pop();
    count += 1;
    if (current && typeof current === 'object') {
      const values = Array.isArray(current) ? current : Object.values(current);
      pending.push(...values.slice(0, limit - count));
    }
  }
  return count;
}

export function toJsonPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`;
  const name = String(key);
  return /^[A-Za-z_$][\w$]*$/.test(name) ? `${parent}.${name}` : `${parent}[${JSON.stringify(name)}]`;
}
