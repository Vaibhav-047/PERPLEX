/** Make whitespace inside a token visible: spaces as ␣, newlines as ↵, tabs as ⇥. */
export function displayToken(token: string): string {
  if (token === '') return '∅';
  return token.replace(/\r?\n/g, '↵').replace(/\t/g, '⇥').replace(/ /g, '␣');
}

/** Plain decimals in the readable range, scientific notation below 0.001 or above 1e6. */
export function formatNum(n: number, digits = 3): string {
  if (Number.isNaN(n)) return '–';
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞';
  const a = Math.abs(n);
  if (a !== 0 && (a < 0.001 || a > 1e6)) return n.toExponential(2).replace('e+', 'e');
  if (a >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return Number(n.toPrecision(digits + (a >= 1 ? Math.floor(Math.log10(a)) : 0))).toString();
}

/** Fixed decimals for counters and levels, still switching to scientific outside the readable range. */
export function fixed(n: number, d = 2): string {
  const a = Math.abs(n);
  if (!Number.isFinite(n)) return formatNum(n);
  if (a !== 0 && (a < 0.001 || a > 1e6)) return formatNum(n);
  return n.toFixed(d);
}

export const formatMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);
export const formatMB = (bytes: number) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
