// All canvas drawing. Visuals read the bus; they never write app state.
import { bus, camAim, camDist, maxOf, type TerrainState } from './bus';
import { clamp01, elevation, fbm, FAULT, hToV, H_MAX, INK, INK_DIM, INK_FAINT, LINE_HI, SCAN, SCAN_GLOW, WATER_FILL, WATER_LINE } from './color';
import { buildField, depthOrder, makeView, needsSort, pointCap, project, ridgeEdge, ridgeProfile, RIDGE_HALF, unprojectGround, Y_SCALE, type Camera, type Field, type Projected, type View } from './project';
import { displayToken, fixed, formatNum } from '../lib/format';

const mk = (): Projected => ({ x: 0, y: 0, depth: 0, scale: 0 });
const A = mk(), B = mk();
const MONO = '"JetBrains Mono", ui-monospace, monospace';

function line(ctx: CanvasRenderingContext2D, v: View, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  if (!project(v, x0, y0, z0, A) || !project(v, x1, y1, z1, B)) return;
  ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
}

function quad(ctx: CanvasRenderingContext2D, v: View, xs: number, zs: number, y: number) {
  const pts: [number, number][] = [[-xs, -zs], [xs, -zs], [xs, zs], [-xs, zs]];
  ctx.beginPath();
  pts.forEach(([x, z], i) => { if (project(v, x, y, z, A)) { if (i) ctx.lineTo(A.x, A.y); else ctx.moveTo(A.x, A.y); } });
  ctx.closePath();
}

function glowLine(ctx: CanvasRenderingContext2D, color: string, draw: () => void) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.shadowColor = color === SCAN ? SCAN_GLOW : color; ctx.shadowBlur = 8;
  ctx.beginPath(); draw(); ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- terrain

interface Cache { field: Field | null; n: number; cap: number; order: Uint32Array; sorted: Camera | null; H: Float32Array }
const caches = new WeakMap<TerrainState, Cache>();

export interface TerrainOpts {
  phone: boolean;
  /** ridge labels: P values (console), token text on the ground (story step 1), or none */
  labels?: 'p' | 'token' | 'none';
  waterLabel?: 'ppl' | 'level' | 'convert';
  /** override the scan-line position, in token units */
  scanU?: number | null;
}

export function scanPosition(t: TerrainState, n: number): number | null {
  if (bus.reduced) return null;
  const now = bus.now;
  if (t.running) return -0.5 + (((now - t.runAt) / 1.6) % 1) * n;
  if (now < t.sweepAt + t.sweepDur) return -0.5 + ((now - t.sweepAt) / t.sweepDur) * n;
  return null;
}

export function drawTerrain(ctx: CanvasRenderingContext2D, w: number, h: number, t: TerrainState, o: TerrainOpts) {
  const n = t.h.length, nf = n || 8, cap = pointCap(o.phone);
  let c = caches.get(t);
  if (!c) { c = { field: null, n: 0, cap: 0, order: new Uint32Array(0), sorted: null, H: new Float32Array(0) }; caches.set(t, c); }
  if (!c.field || c.n !== nf || c.cap !== cap) { c.field = buildField(nf, cap); c.n = nf; c.cap = cap; c.sorted = null; c.H = new Float32Array(nf); }
  const f = c.field, H = c.H;
  const v = makeView(t.cam, w, h, [0, camAim(Math.max(maxOf(t.h), maxOf(t.ghost?.h ?? []))), 0]);
  if (needsSort(c.sorted, t.cam)) { c.order = depthOrder(f, v); c.sorted = { ...t.cam }; }
  let maxH = 0, peak = -1;
  for (let i = 0; i < nf; i++) {
    H[i] = i < n ? t.h[i] * Y_SCALE * t.rise[i] : 0;
    if (i < n && t.h[i] > maxH) { maxH = t.h[i]; peak = i; }
  }
  const half = nf / 2, zEdge = RIDGE_HALF + 0.1, off = (nf - 1) / 2;
  const waterY = t.water * Y_SCALE;
  const hover = t.hover, sel = t.selected;
  const scanU = o.scanU !== undefined ? o.scanU : scanPosition(t, nf);

  // ground frame
  ctx.strokeStyle = LINE_HI; ctx.lineWidth = 1;
  quad(ctx, v, half, zEdge, 0); ctx.stroke();

  // wireframe: lines along the sentence, and one across each ridge column
  ctx.lineWidth = 1;
  const seg = (u0: number, z0: number, u1: number, z1: number) => {
    const y0 = ridgeProfile(H, u0) * ridgeEdge(z0), y1 = ridgeProfile(H, u1) * ridgeEdge(z1);
    if (!project(v, u0 - off, y0, z0, A) || !project(v, u1 - off, y1, z1, B)) return;
    const tok = Math.round((u0 + u1) / 2);
    ctx.globalAlpha = hover >= 0 && tok !== hover ? 0.12 : 0.32;
    ctx.strokeStyle = elevation(hToV((y0 + y1) / 2 / Y_SCALE));
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  };
  const du = 1 / 4;
  for (const z of [-0.6, -0.3, 0, 0.3, 0.6]) for (let u = -0.5; u < nf - 0.5 - 1e-6; u += du) seg(u, z, u + du, z);
  if (n) for (let i = 0; i < n; i++) for (let k = 0; k < 8; k++) seg(i, -RIDGE_HALF + (k * 2 * RIDGE_HALF) / 8, i, -RIDGE_HALF + ((k + 1) * 2 * RIDGE_HALF) / 8);
  ctx.globalAlpha = 1;

  // points: below the water first, then the water plane, then the points above it
  const order = c.order;
  const drawPoints = (below: boolean) => {
    for (let j = 0; j < order.length; j++) {
      const k = order[j];
      const y = ridgeProfile(H, f.u[k]) * f.e[k];
      if (waterY > 0.001 && (y < waterY) !== below) continue;
      if (waterY <= 0.001 && below) continue;
      if (!project(v, f.x[k], y, f.z[k], A)) continue;
      let a = clamp01(1.45 - A.depth / (v.dist * 1.25)) * (n ? 0.85 : 0.35) + 0.12;
      let s = Math.max(0.8, Math.min(2.6, A.scale * 0.02));
      const tok = f.tok[k];
      if (hover >= 0) { if (tok === hover) { a = 1; s *= 1.25; } else a *= 0.4; }
      if (scanU !== null) { const d = Math.abs(f.u[k] - scanU); if (d < 0.6) { a = Math.min(1, a + 0.6 * (1 - d / 0.6)); s *= 1.2; } }
      if (below) a *= 0.5;
      ctx.globalAlpha = a;
      ctx.fillStyle = n ? elevation(hToV(y / Y_SCALE)) : INK_FAINT;
      ctx.fillRect(A.x - s / 2, A.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  };
  drawPoints(true);

  // water plane at the mean height
  if (waterY > 0.001) {
    quad(ctx, v, half, zEdge, waterY);
    ctx.fillStyle = WATER_FILL; ctx.fill();
    ctx.strokeStyle = WATER_LINE; ctx.lineWidth = 1; ctx.stroke();
    // faint animated surface
    ctx.strokeStyle = 'rgba(238,241,236,0.1)'; ctx.beginPath();
    for (let j = 0; j < 4; j++) {
      const z = -zEdge + ((((bus.reduced ? 0 : bus.now) * 0.08 + j / 4) % 1) * 2 * zEdge);
      line(ctx, v, -half, waterY, z, half, waterY, z);
    }
    ctx.stroke();
    labelEdge(ctx, v, half, zEdge, waterY, o.waterLabel === 'level' ? `level ${fixed(t.water)}`
      : o.waterLabel === 'convert' ? `e^${fixed(t.mean)} = PPL ${fixed(t.ppl, 1)}` : `PPL ${fixed(t.ppl, 1)}`, INK, 1);
  }
  drawPoints(false);

  // compare: the other model's terrain as a wireframe ghost, with its own water level
  if (t.ghost && t.ghost.h.length) {
    const g = t.ghost, m = g.h.length, GH = g.h.map((x) => x * Y_SCALE * Math.min(1, t.ghostWater / Math.max(1e-6, g.mean)));
    const gu = (u: number) => ((u + 0.5) / nf) * m - 0.5;
    ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(238,241,236,0.5)'; ctx.beginPath();
    for (const z of [-0.45, 0, 0.45]) {
      for (let u = -0.5; u < nf - 0.5 - 1e-6; u += du) {
        line(ctx, v, u - off, ridgeProfile(GH, gu(u)) * ridgeEdge(z), z, u + du - off, ridgeProfile(GH, gu(u + du)) * ridgeEdge(z), z);
      }
    }
    ctx.stroke();
    if (t.ghostWater > 0.001) {
      quad(ctx, v, half, zEdge, t.ghostWater * Y_SCALE);
      ctx.strokeStyle = 'rgba(238,241,236,0.45)'; ctx.stroke();
      labelEdge(ctx, v, -half, -zEdge, t.ghostWater * Y_SCALE, `${g.name} PPL ${fixed(g.ppl, 1)}`, INK_DIM, -1);
    }
    ctx.restore();
  }

  // laser scan line
  if (scanU !== null) {
    const x = scanU - off;
    glowLine(ctx, SCAN, () => { line(ctx, v, x, 0, -zEdge, x, 0, zEdge); line(ctx, v, x, 0, 0, x, Math.max(0.6, maxH * Y_SCALE + 0.3), 0); });
  }
  // fault: the scan line flickers once in the fault colour
  const ft = bus.now - t.faultAt;
  if (t.faulted && !bus.reduced && ft < 0.6 && Math.floor(ft / 0.1) % 2 === 0) {
    glowLine(ctx, FAULT, () => { line(ctx, v, -half, 0, 0, half, 0, 0); });
  }

  // ridge labels and hit-test positions
  if (t.screen.length !== n * 4) t.screen = new Float32Array(n * 4);
  ctx.font = `10px ${MONO}`; ctx.textAlign = 'center';
  for (let i = 0; i < n; i++) {
    const x = i - off;
    project(v, x, 0, 0, A); project(v, x, H[i] + 0.04, 0, B);
    t.screen[i * 4] = A.x; t.screen[i * 4 + 1] = A.y; t.screen[i * 4 + 2] = B.x; t.screen[i * 4 + 3] = B.y;
    const show = o.labels !== 'none' && (n <= (o.phone ? 10 : 24) || i === hover || i === sel || i === peak);
    if (!show) continue;
    if (o.labels === 'token') {
      project(v, x, 0, zEdge + 0.25, A);
      ctx.fillStyle = INK_DIM; ctx.fillText(displayToken(t.labels[i]).slice(0, 10), A.x, A.y + 10);
    } else if (t.rise[i] > 0.3) {
      ctx.fillStyle = i === hover || i === sel ? INK : INK_DIM;
      ctx.fillText(formatNum(t.p[i], 2), B.x, B.y - 6);
    }
  }
  ctx.textAlign = 'start';
}

function labelEdge(ctx: CanvasRenderingContext2D, v: View, x: number, z: number, y: number, text: string, color: string, side: 1 | -1) {
  if (!project(v, x, y, z, A)) return;
  ctx.font = `11px ${MONO}`;
  const tw = ctx.measureText(text).width;
  const lx = side > 0 ? A.x + 8 : A.x - 8 - tw;
  ctx.strokeStyle = color; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(side > 0 ? lx - 2 : lx + tw + 2, A.y); ctx.stroke();
  ctx.globalAlpha = 1; ctx.fillStyle = color; ctx.fillText(text, lx, A.y + 4);
}

// ---------------------------------------------------------------- story

/** The 4-step scoring scene, scrubbed by p in [0, 1]. Writes only into its own local terrain object. */
export function drawStory(ctx: CanvasRenderingContext2D, w: number, h: number, p: number, st: TerrainState, phone: boolean) {
  const n = st.h.length;
  const grow = clamp01((p - 0.25) / 0.25);
  for (let i = 0; i < n; i++) st.rise[i] = clamp01(grow * (n + 1) - i);
  st.water = st.mean * clamp01((p - 0.5) / 0.2);
  st.cam.yaw = 0.45 + p * 0.35; st.cam.pitch = 0.4; st.cam.dist = camDist(n, maxOf(st.h));
  drawTerrain(ctx, w, h, st, {
    phone, labels: p < 0.25 ? 'token' : 'p', waterLabel: p >= 0.75 ? 'convert' : 'level',
    scanU: grow > 0 && grow < 1 && !bus.reduced ? -0.5 + grow * n : null,
  });
}

// ---------------------------------------------------------------- inspector

export interface Peak { token: string; p: number; actual: boolean }

/** The alternatives at one position as ghost peaks: how tall each would have been (-ln p). */
export function drawPeaks(ctx: CanvasRenderingContext2D, w: number, h: number, peaks: Peak[]) {
  const m = peaks.length;
  if (!m) return;
  const scale = Math.max(H_MAX, ...peaks.map((k) => -Math.log(k.p)));
  const base = h - 28, top = 22, colW = w / m;
  ctx.strokeStyle = LINE_HI; ctx.beginPath(); ctx.moveTo(0, base + 0.5); ctx.lineTo(w, base + 0.5); ctx.stroke();
  ctx.font = `10px ${MONO}`; ctx.textAlign = 'center';
  peaks.forEach((k, i) => {
    const hh = -Math.log(k.p), cx = (i + 0.5) * colW, ph = Math.max(2, (hh / scale) * (base - top)), half = colW * 0.46;
    const col = elevation(hToV(hh));
    ctx.globalAlpha = k.actual ? 1 : 0.55;
    for (let x = -half; x <= half; x += 3) {
      const y = ph * Math.exp(-((x / half) ** 2) * 3.2);
      ctx.fillStyle = col; ctx.fillRect(cx + x - 0.8, base - y - 0.8, 1.6, 1.6); // ridge line
      for (let yy = 4; yy < y; yy += 6) { ctx.globalAlpha = (k.actual ? 0.5 : 0.22) * (1 - yy / (y + 1)); ctx.fillRect(cx + x - 0.5, base - yy, 1, 1); }
      ctx.globalAlpha = k.actual ? 1 : 0.55;
    }
    ctx.globalAlpha = 1;
    if (k.actual) { ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(cx, base); ctx.lineTo(cx, base - ph - 4); ctx.stroke(); }
    ctx.fillStyle = k.actual ? INK : INK_DIM;
    ctx.fillText(formatNum(hh, 2), cx, base - ph - 8);
    ctx.fillText(displayToken(k.token).slice(0, 8), cx, base + 14);
    if (k.actual) { ctx.fillStyle = INK; ctx.fillText('actual', cx, base + 25); }
  });
  ctx.textAlign = 'start';
}

// ---------------------------------------------------------------- hero

const HERO_DEPTH = 36;
let shadow: { key: string; pts: [number, number][] } = { key: '', pts: [] };

/** Wordmark rasterised to dots, placed on the ground under the floating wordmark (recomputed on resize / font load). */
function shadowDots(v: View, w: number, wordWidth: number, zc: number) {
  const key = `${w}|${wordWidth}|${document.fonts?.check?.('600 40px "Chakra Petch"')}`;
  if (shadow.key === key) return shadow.pts;
  const c = document.createElement('canvas'); c.width = 420; c.height = 80;
  const g = c.getContext('2d')!;
  g.font = '600 72px "Chakra Petch", sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText('PERPLEX', 210, 42);
  const tw = g.measureText('PERPLEX').width;
  const d = g.getImageData(0, 0, 420, 80).data;
  project(v, 0, 0, zc, A);
  const worldW = wordWidth / A.scale, step = 4;
  const pts: [number, number][] = [];
  for (let y = 0; y < 80; y += step) for (let x = 0; x < 420; x += step) {
    if (d[(y * 420 + x) * 4 + 3] > 128) pts.push([((x - 210) / tw) * worldW, zc + ((y - 40) / 80) * 4]);
  }
  shadow = { key, pts };
  return pts;
}

let lastGround: { x: number; z: number } = { x: 0, z: -6 };

export function drawHero(ctx: CanvasRenderingContext2D, w: number, h: number, phone: boolean, wordWidth: number) {
  const hero = bus.hero;
  const cols = phone ? 46 : 104, rows = phone ? 42 : 56;
  const v = makeView({ yaw: 0, pitch: 0.3, dist: 9 }, w, h, [0, 0, -9], 0.9);
  const sp = HERO_DEPTH / rows, off = hero.offset * 1.2;
  const height = (x: number, z: number) => (fbm(x * 0.18, (z - off) * 0.18) - 0.45) * 3.6;
  if (hero.inside && hero.px >= 0) { const g = unprojectGround(v, hero.px, hero.py); if (g) lastGround = g; }
  const hill = (x: number, z: number) => hero.hill * 1.5 * Math.exp(-((x - lastGround.x) ** 2 + (z - lastGround.z) ** 2) / 3);

  project(v, 0, 0, -HERO_DEPTH, A);
  const horizon = A.y;
  const scanY = bus.reduced ? -1 : horizon + (((bus.now / 3.4) % 1) * (h - horizon + 20));
  const halfW = phone ? 4.5 : 6.5;
  const r0 = (rows - (Math.floor(off / sp) % rows)) % rows; // the farthest row, drawn first
  for (let q = 0; q < rows; q++) {
    const r = (r0 + q) % rows;
    const z = -HERO_DEPTH + ((r * sp + off) % HERO_DEPTH);
    const fog = (1 + z / HERO_DEPTH) ** 1.6;
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const x = (-1 + (cIdx / (cols - 1)) * 2) * halfW * (1 + (-z / HERO_DEPTH) * 2.6);
      const y = height(x, z) + hill(x, z);
      if (!project(v, x, y, z, A) || A.x < -4 || A.x > w + 4 || A.y > h + 4) continue;
      let a = fog * 0.95, s = Math.max(0.8, Math.min(2.6, A.scale * 0.03));
      if (scanY >= 0) { const d = Math.abs(A.y - scanY); if (d < 16) { a = Math.min(1, a + 0.7 * (1 - d / 16)); s *= 1.35; } }
      ctx.globalAlpha = a;
      ctx.fillStyle = elevation(clamp01((y + 1) / 3.2));
      ctx.fillRect(A.x - s / 2, A.y - s / 2, s, s);
    }
  }
  // the wordmark's faint dotted shadow on the ground below it
  ctx.fillStyle = INK; ctx.globalAlpha = 0.3;
  for (const [x, z] of shadowDots(v, w, wordWidth, -9)) {
    if (project(v, x, height(x, z) + hill(x, z) + 0.02, z, A)) ctx.fillRect(A.x - 0.7, A.y - 0.7, 1.4, 1.4);
  }
  ctx.globalAlpha = 1;
  if (scanY >= 0 && scanY <= h) glowLine(ctx, SCAN, () => { ctx.globalAlpha = 0.7; ctx.moveTo(0, scanY); ctx.lineTo(w, scanY); });
  ctx.globalAlpha = 1;
}
