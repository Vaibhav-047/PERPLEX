// The camera, a small perspective projection, and the height field built from the tokens.
import { jitter } from './color';

export interface Camera { yaw: number; pitch: number; dist: number }
export interface View { cy: number; sy: number; cp: number; sp: number; dist: number; f: number; cx: number; cyS: number; tx: number; ty: number; tz: number }

/** Orbit camera around a target. yaw turns around the vertical axis; pitch tilts down toward the target. */
export function makeView(cam: Camera, w: number, h: number, target: [number, number, number] = [0, 0, 0], fov = 0.85): View {
  return {
    cy: Math.cos(cam.yaw), sy: Math.sin(cam.yaw), cp: Math.cos(cam.pitch), sp: Math.sin(cam.pitch),
    dist: cam.dist, f: Math.min(w, h * 1.6) / 2 / Math.tan(fov / 2), cx: w / 2, cyS: h / 2,
    tx: target[0], ty: target[1], tz: target[2],
  };
}

export interface Projected { x: number; y: number; depth: number; scale: number }

/** World -> screen. Returns false when the point is behind the camera. Writes into `out` to avoid allocation. */
export function project(v: View, x: number, y: number, z: number, out: Projected): boolean {
  const dx = x - v.tx, dy = y - v.ty, dz = z - v.tz;
  const x1 = dx * v.cy - dz * v.sy;
  const z1 = dx * v.sy + dz * v.cy;
  const y2 = dy * v.cp - z1 * v.sp;
  const z2 = dy * v.sp + z1 * v.cp;
  const depth = v.dist - z2;
  if (depth < 0.05) return false;
  const s = v.f / depth;
  out.x = v.cx + x1 * s; out.y = v.cyS - y2 * s; out.depth = depth; out.scale = s;
  return true;
}

/** Screen -> the world point on the ground plane y = 0 under it, or null if the ray misses the ground. */
export function unprojectGround(v: View, sx: number, sy: number): { x: number; z: number } | null {
  const a = (sx - v.cx) / v.f, b = (v.cyS - sy) / v.f;
  const den = b * v.cp - v.sp;
  if (Math.abs(den) < 1e-9) return null;
  const d = (-v.ty - v.dist * v.sp) / den;
  if (d <= 0) return null;
  const y2 = b * d, z2 = v.dist - d, x1 = a * d;
  const z1 = -y2 * v.sp + z2 * v.cp;
  return { x: x1 * v.cy + z1 * v.sy + v.tx, z: -x1 * v.sy + z1 * v.cy + v.tz };
}

// ---- the token height field ----
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const RIDGE_HALF = 0.9; // ridge depth along z is [-0.9, 0.9]
/** World units of height per nat of surprisal. */
export const Y_SCALE = 0.42;

/**
 * Height of the terrain at token coordinate u (token i is centred at u = i), from per-token heights H.
 * Each token is a flat-topped ridge column (plateau within ±0.25 of its centre) with smooth slopes between,
 * falling to the ground by half a unit beyond the first and last token.
 */
export function ridgeProfile(H: ArrayLike<number>, u: number): number {
  const n = H.length;
  if (!n) return 0;
  if (u < 0) return H[0] * smooth((u + 0.5) / 0.35);
  if (u > n - 1) return H[n - 1] * smooth((n - 1 + 0.5 - u) / 0.35);
  const i = Math.floor(u), f = u - i;
  const s = smooth((f - 0.25) / 0.5);
  return H[i] + ((i + 1 < n ? H[i + 1] : H[i]) - H[i]) * s;
}
/** Ridge falloff along z: a plateau in the middle, down to the ground at the edges. */
export const ridgeEdge = (z: number) => smooth((RIDGE_HALF - Math.abs(z)) / (RIDGE_HALF * 0.55));

export interface Field { n: number; count: number; sx: number; sz: number; u: Float32Array; x: Float32Array; z: Float32Array; e: Float32Array; tok: Uint16Array }

/** Point budget: about 6k on desktop and 2k on phones. */
export const pointCap = (phone: boolean) => (phone ? 2000 : 6000);

/** Sample positions for n tokens, at most `cap` points. Heights are evaluated per frame from ridgeProfile. */
export function buildField(n: number, cap: number): Field {
  const sx = Math.max(2, Math.min(14, Math.round(Math.sqrt(cap / Math.max(1, n) / 2))));
  const sz = Math.max(4, Math.min(40, Math.floor(cap / (Math.max(1, n) * sx))));
  const count = n * sx * sz;
  const f: Field = { n, count, sx, sz, u: new Float32Array(count), x: new Float32Array(count), z: new Float32Array(count), e: new Float32Array(count), tok: new Uint16Array(count) };
  let k = 0;
  for (let a = 0; a < n * sx; a++) {
    for (let b = 0; b < sz; b++, k++) {
      const u = -0.5 + (a + 0.5 + jitter(a, b) * 0.7) / sx;
      const z = -RIDGE_HALF - 0.08 + ((b + 0.5 + jitter(b, a) * 0.7) / sz) * (RIDGE_HALF + 0.08) * 2;
      f.u[k] = u; f.x[k] = u - (n - 1) / 2; f.z[k] = z; f.e[k] = ridgeEdge(z);
      f.tok[k] = Math.max(0, Math.min(n - 1, Math.round(u)));
    }
  }
  return f;
}

/** Indices of the field's points, far to near, for painter's-order drawing. */
export function depthOrder(f: Field, v: View): Uint32Array {
  const depth = new Float32Array(f.count), p: Projected = { x: 0, y: 0, depth: 0, scale: 0 };
  for (let k = 0; k < f.count; k++) depth[k] = project(v, f.x[k], 0, f.z[k], p) ? p.depth : 0;
  return Uint32Array.from({ length: f.count }, (_, k) => k).sort((a, b) => depth[b] - depth[a]);
}

/** Re-sort only when the camera has turned enough to change the order noticeably. */
export const needsSort = (last: Camera | null, cam: Camera) =>
  !last || Math.abs(last.yaw - cam.yaw) > 0.04 || Math.abs(last.pitch - cam.pitch) > 0.04;
