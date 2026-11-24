// Elevation colour (data visuals only): 0 = low / expected, 1 = peak / surprising. 101-step lookup table.
const STOPS: [number, [number, number, number]][] = [
  [0, [0x12, 0xb5, 0xa6]], // deep teal
  [0.35, [0x9b, 0xe5, 0x64]], // lime
  [0.7, [0xff, 0xb2, 0x38]], // amber
  [1, [0xff, 0x4f, 0x4f]], // hot red
];

export const LUT_RGB: [number, number, number][] = Array.from({ length: 101 }, (_, i) => {
  const v = i / 100;
  let s = 0;
  while (s < STOPS.length - 2 && v > STOPS[s + 1][0]) s++;
  const [v0, a] = STOPS[s], [v1, b] = STOPS[s + 1], f = (v - v0) / (v1 - v0);
  return a.map((c, j) => Math.round(c + (b[j] - c) * f)) as [number, number, number];
});
const LUT = LUT_RGB.map(([r, g, b]) => `rgb(${r},${g},${b})`);

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lutIndex = (v: number) => Math.round(clamp01(v) * 100);
export const elevation = (v: number) => LUT[lutIndex(v)];
export const elevationA = (v: number, a: number) => { const [r, g, b] = LUT_RGB[lutIndex(v)]; return `rgba(${r},${g},${b},${a})`; };

/** Surprisal (nats) that maps to the top of the colour scale. Fixed, so colours compare across runs. */
export const H_MAX = 6;
export const hToV = (h: number) => clamp01(h / H_MAX);

export const INK = '#EEF1EC', INK_DIM = '#A6ACA8', INK_FAINT = '#7F8682', LINE = '#22262B', LINE_HI = '#363C44', DECK = '#0B0D0F';
export const WATER_FILL = 'rgba(18,181,166,0.18)', WATER_LINE = 'rgba(238,241,236,0.4)';
export const SCAN = '#EEF1EC', SCAN_GLOW = 'rgba(238,241,236,0.25)';
export const OK = '#6EE7A8', CAUTION = '#FFB020', FAULT = '#FF4D6D';

// ---- noise ----
const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
/** Smooth 2-D value noise in [0, 1]. */
export function noise2(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Two octaves of value noise in [0, 1]. */
export const fbm = (x: number, y: number) => noise2(x, y) * 0.68 + noise2(x * 2.1 + 5.2, y * 2.1 + 1.3) * 0.32;
/** Deterministic jitter in [-0.5, 0.5) for LIDAR-style scattered samples. */
export const jitter = (i: number, k: number) => hash(i * 0.731 + k, k * 1.37 - i) - 0.5;
