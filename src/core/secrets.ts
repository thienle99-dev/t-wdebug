import type { HeaderEntry, RequestRecord, SecretType } from '../shared/types';

const SENSITIVE_NAMES: Array<[RegExp, SecretType]> = [
  [/^authorization$/i, 'bearer-token'], [/^proxy-authorization$/i, 'basic-auth'], [/^(cookie|set-cookie)$/i, 'cookie'],
  [/^(x-api-key|api-key|apikey)$/i, 'api-key'], [/^(x-auth-token|access-token|refresh-token)$/i, 'bearer-token'],
  [/(client[-_]?secret|password|passwd|secret)/i, 'client-secret'],
];
const JWT_RE = /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/;

export function detectSecret(name: string, value: string): SecretType | undefined {
  for (const [pattern, type] of SENSITIVE_NAMES) if (pattern.test(name)) return type;
  if (/^\s*Bearer\s+/i.test(value)) return 'bearer-token';
  if (/^\s*Basic\s+/i.test(value)) return 'basic-auth';
  if (JWT_RE.test(value)) return 'jwt';
  return undefined;
}

export function markHeaders(headers: HeaderEntry[]): HeaderEntry[] {
  return headers.map((header) => {
    const secretType = detectSecret(header.name, header.value);
    return secretType ? { ...header, sensitive: true, secretType } : { ...header, sensitive: false };
  });
}

export function redactText(value: string, replacement = '[REDACTED]'): string {
  return value.replace(JWT_RE, '[REDACTED_JWT]').replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, (_all, scheme: string) => `${scheme} ${replacement}`);
}

export function redactRecord(record: RequestRecord): RequestRecord {
  const redactHeaders = (headers: HeaderEntry[]) => headers.map((header) => header.sensitive || detectSecret(header.name, header.value)
    ? { ...header, value: `[REDACTED_${(header.secretType ?? detectSecret(header.name, header.value) ?? 'unknown').toUpperCase().replaceAll('-', '_')}]` }
    : { ...header, value: redactText(header.value) });
  const redactBody = <T extends { text?: string; json?: unknown } | undefined>(body: T): T => {
    if (!body) return body;
    const text = body.text ? redactText(body.text) : undefined;
    return { ...body, ...(text ? { text } : {}), ...(body.json !== undefined ? { json: redactObject(body.json) } : {}) } as T;
  };
  const copy: RequestRecord = structuredClone(record);
  copy.request.headers = redactHeaders(copy.request.headers);
  copy.response.headers = redactHeaders(copy.response.headers);
  copy.request.cookies = copy.request.cookies.map((cookie) => ({ ...cookie, value: '[REDACTED_COOKIE]' }));
  copy.request.body = redactBody(copy.request.body);
  copy.response.body = redactBody(copy.response.body);
  if (copy.request.auth) copy.request.auth.value = '[REDACTED_AUTH]';
  return copy;
}

function redactObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactObject);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (/(token|secret|password|authorization|cookie|api[-_]?key)/i.test(key)) return [key, '[REDACTED]'];
    return [key, redactObject(child)];
  }));
  return typeof value === 'string' ? redactText(value) : value;
}
