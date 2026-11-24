// The signal bus: a plain mutable store of live values the visuals read every frame.
// The app writes to it (through `emit`) from its own state and worker callbacks; visuals never write back into app state.
import { Y_SCALE, type Camera } from './project';

export type Preset = 'orbit' | 'side' | 'top';
const TAU = Math.PI * 2;
export const PRESET_CAM: Record<Preset, { yaw: number | null; pitch: number }> = {
  orbit: { yaw: null, pitch: 0.5 }, // keeps the current yaw and turns slowly
  side: { yaw: 0, pitch: 0.1 },
  top: { yaw: 0, pitch: 1.48 }, // map view
};
export const ORBIT_SPEED = 0.1; // rad/s
export const PITCH_MIN = 0.04, PITCH_MAX = 1.5;

export interface Ghost { h: number[]; mean: number; ppl: number; name: string }

export interface TerrainState {
  h: number[]; p: number[]; labels: string[]; generated: boolean[];
  rise: number[]; riseAt: number[];
  mean: number; ppl: number; water: number; hasData: boolean;
  ghost: Ghost | null; ghostWater: number;
  cam: Camera; camTarget: Camera; preset: Preset; dragging: boolean;
  hover: number; selected: number;
  running: boolean; runAt: number; sweepAt: number; sweepDur: number;
  faulted: boolean; faultAt: number;
  /** Ridge screen positions from the last draw (baseX, baseY, topX, topY per ridge), for hit-testing. */
  screen: Float32Array;
}

/** Camera distance that frames n ridges up to the tallest height hMax (nats). Heights stay linear in -ln P. */
export const camDist = (n: number, hMax = 0) => Math.max(5.2, 2.6 + n * 0.82, 3.2 + hMax * Y_SCALE * 1.7);
/** World height the camera aims at: a little under the middle of the tallest ridge. */
export const camAim = (hMax: number) => Math.max(0.55, hMax * Y_SCALE * 0.42);
export const maxOf = (a: readonly number[]) => a.reduce((m, v) => (v > m ? v : m), 0);

export function makeTerrain(preset: Preset = 'orbit'): TerrainState {
  const cam = { yaw: 0.55, pitch: PRESET_CAM[preset].pitch, dist: camDist(0) };
  return {
    h: [], p: [], labels: [], generated: [], rise: [], riseAt: [],
    mean: 0, ppl: 1, water: 0, hasData: false, ghost: null, ghostWater: 0,
    cam, camTarget: { ...cam }, preset, dragging: false, hover: -1, selected: -1,
    running: false, runAt: -99, sweepAt: -99, sweepDur: 0, faulted: false, faultAt: -99,
    screen: new Float32Array(0),
  };
}

export const bus = {
  reduced: false,
  version: 0, // bumped on discrete changes; reduced-motion canvases redraw only when it changes
  now: 0,
  scrollVelocity: 0,
  storyProgress: 0,
  cursorH: null as number | null, // live elevation under the pointer, for the custom cursor
  hero: { offset: 0, boost: 0, hill: 0, inside: false, px: -1, py: -1 },
  terrains: { console: makeTerrain(), lab: makeTerrain() } as Record<'console' | 'lab', TerrainState>,
};

export const markDirty = () => { bus.version++; };

export interface TokenIn { h: number; p: number; token: string; generated?: boolean }

export const emit = {
  /** A model run started: the scan line sweeps the ground until the result arrives. */
  run(t: TerrainState) { t.running = true; t.runAt = bus.now; t.faulted = false; markDirty(); },
  /** Scored tokens arrived: ridges rise from the ground one by one as the scan line passes. */
  result(t: TerrainState, tokens: TokenIn[], mean: number, ppl: number, sweep = true) {
    const n = tokens.length;
    const animate = sweep && !bus.reduced;
    const dur = animate ? Math.min(2.2, Math.max(0.8, n * 0.16)) : 0;
    t.h = tokens.map((x) => x.h); t.p = tokens.map((x) => x.p); t.labels = tokens.map((x) => x.token);
    t.generated = tokens.map((x) => !!x.generated);
    t.rise = tokens.map(() => (animate ? 0 : 1));
    t.riseAt = tokens.map((_, i) => bus.now + (n ? ((i + 0.5) / n) * dur : 0));
    t.sweepAt = bus.now; t.sweepDur = dur;
    t.mean = mean; t.ppl = ppl; t.hasData = n > 0; t.running = false; t.faulted = false;
    if (!animate) t.water = mean;
    if (t.hover >= n) t.hover = -1;
    markDirty();
  },
  /** A generated token streamed in: a new ridge grows at the far edge. */
  append(t: TerrainState, x: TokenIn, mean: number, ppl: number) {
    t.h.push(x.h); t.p.push(x.p); t.labels.push(x.token); t.generated.push(!!x.generated);
    t.rise.push(bus.reduced ? 1 : 0); t.riseAt.push(bus.now);
    t.mean = mean; t.ppl = ppl; t.hasData = true;
    if (bus.reduced) t.water = mean;
    markDirty();
  },
  done(t: TerrainState) { t.running = false; markDirty(); },
  /** Loading or running failed: the terrain drops flat and the scan line flickers once in the fault colour. */
  fault(t: TerrainState) { t.running = false; t.faulted = true; t.faultAt = bus.now; if (bus.reduced) { t.rise = t.rise.map(() => 0); t.water = 0; } markDirty(); },
  reset(t: TerrainState) {
    Object.assign(t, { h: [], p: [], labels: [], generated: [], rise: [], riseAt: [], mean: 0, ppl: 1, water: 0, hasData: false, ghost: null, ghostWater: 0, hover: -1, selected: -1, running: false, faulted: false });
    markDirty();
  },
  ghost(t: TerrainState, g: Ghost | null) { t.ghost = g; if (bus.reduced || !g) t.ghostWater = g?.mean ?? 0; markDirty(); },
  preset(t: TerrainState, p: Preset) {
    t.preset = p;
    const c = PRESET_CAM[p];
    t.camTarget.pitch = c.pitch;
    if (c.yaw !== null) t.camTarget.yaw = c.yaw + TAU * Math.round((t.cam.yaw - c.yaw) / TAU); // shortest turn
    else if (bus.reduced) t.camTarget.yaw = 0.55;
    markDirty();
  },
  rotate(t: TerrainState, dyaw: number, dpitch: number) {
    t.camTarget.yaw += dyaw;
    t.camTarget.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, t.camTarget.pitch + dpitch));
    markDirty();
  },
  drag(t: TerrainState, on: boolean) { t.dragging = on; },
  hover(t: TerrainState, i: number) { if (t.hover !== i) { t.hover = i; markDirty(); } },
  select(t: TerrainState, i: number) { t.selected = i; markDirty(); },
};

const ease = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-dt * rate));

function stepTerrain(t: TerrainState, dt: number) {
  const r = bus.reduced, now = bus.now;
  for (let i = 0; i < t.h.length; i++) {
    const target = t.faulted ? 0 : now >= t.riseAt[i] ? 1 : 0;
    t.rise[i] = r ? target : ease(t.rise[i], target, t.faulted ? 10 : 7, dt);
  }
  const waterTarget = t.faulted || !t.hasData || now < t.sweepAt + t.sweepDur ? 0 : t.mean;
  t.water = r ? waterTarget : ease(t.water, waterTarget, t.faulted ? 10 : 3.2, dt);
  const ghostTarget = t.ghost && !t.faulted ? t.ghost.mean : 0;
  t.ghostWater = r ? ghostTarget : ease(t.ghostWater, ghostTarget, 3.2, dt);

  t.camTarget.dist = camDist(Math.max(t.h.length, t.ghost?.h.length ?? 0), Math.max(maxOf(t.h), maxOf(t.ghost?.h ?? [])));
  if (t.preset === 'orbit' && !t.dragging && !r) t.camTarget.yaw += dt * ORBIT_SPEED;
  if (r) Object.assign(t.cam, t.camTarget);
  else {
    t.cam.yaw = ease(t.cam.yaw, t.camTarget.yaw, 5, dt);
    t.cam.pitch = ease(t.cam.pitch, t.camTarget.pitch, 5, dt);
    t.cam.dist = ease(t.cam.dist, t.camTarget.dist, 4, dt);
  }
}

/** Advance the data model one frame. Runs once per frame before any canvas draws. */
export function step(dt: number) {
  bus.now += dt;
  for (const t of Object.values(bus.terrains)) stepTerrain(t, dt);
  const h = bus.hero;
  bus.scrollVelocity *= Math.exp(-dt * 6);
  if (bus.reduced) { h.boost = 0; h.hill = 0; return; }
  // scroll velocity speeds up the flight, then eases back
  h.boost = Math.max(h.boost * Math.exp(-dt * 1.4), Math.min(1, Math.abs(bus.scrollVelocity) / 25));
  h.offset += dt * (0.8 + 5 * h.boost);
  h.hill = ease(h.hill, h.inside ? 1 : 0, h.inside ? 4 : 1.6, dt);
}
