export type BodyViewMode = 'pretty' | 'raw';

/** Pretty-print valid JSON without changing or rejecting non-JSON response text. */
export function formatBody(text: string | undefined, mode: BodyViewMode): string {
  if (text === undefined || mode === 'raw') return text ?? '';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
