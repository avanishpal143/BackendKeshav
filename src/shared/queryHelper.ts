/** Safe extraction of a single string from any Express req.query value */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function qs(val: any): string | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  if (Array.isArray(val)) return val.length > 0 ? String(val[0]) : undefined;
  if (typeof val === 'object') return undefined;
  return String(val);
}

/** Safe extraction of integer from any Express req.query value */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function qi(val: any, def: number): number {
  const s = qs(val);
  if (!s) return def;
  const n = parseInt(s, 10);
  return isNaN(n) ? def : n;
}

/** Force any value to a string — for req.params, req.user.userId etc. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function str(val: any): string {
  if (Array.isArray(val)) return String(val[0] ?? '');
  return String(val ?? '');
}
