import { beforeEach, describe, expect, it } from 'vitest';
import { bus, emit, makeTerrain, ORBIT_SPEED, step, type TerrainState } from './bus';
import { buildField, depthOrder, makeView, needsSort, pointCap, project, ridgeProfile, unprojectGround, type Projected } from './project';
import { elevation, LUT_RGB } from './color';

const run = (seconds: number) => { for (let t = 0; t < seconds; t += 1 / 60) step(1 / 60); };
const toks = (ps: number[]) => ps.map((p, i) => ({ p, h: -Math.log(p), token: `t${i}` }));
const mean = (ps: number[]) => ps.reduce((s, p) => s - Math.log(p), 0) / ps.length;

describe('signal bus', () => {
  let t: TerrainState;
  beforeEach(() => { bus.reduced = false; t = bus.terrains.console = makeTerrain(); });

  it('ridges rise one by one as the scan passes, then the water fills to the mean', () => {
    const ps = [0.9, 0.9, 0.9, 0.01];
    emit.result(t, toks(ps), mean(ps), Math.exp(mean(ps)));
    run(0.4);
    expect(t.rise[0]).toBeGreaterThan(t.rise[3]);
    expect(t.water).toBe(0);
    run(4);
    expect(t.rise.every((r) => r > 0.99)).toBe(true);
    expect(t.water).toBeCloseTo(mean(ps), 3);
  });

  it('a flat plateau of 1/8 floods to exactly ln 8', () => {
    emit.result(t, toks(Array(8).fill(0.125)), Math.log(8), 8);
    run(5);
    expect(t.water).toBeCloseTo(Math.log(8), 4);
  });

  it('a fault drops the terrain flat until the next run', () => {
    emit.result(t, toks([0.5, 0.2]), mean([0.5, 0.2]), 1); run(4);
    emit.fault(t); run(1);
    expect(Math.max(...t.rise)).toBeLessThan(0.01);
    expect(t.water).toBeLessThan(0.01);
    emit.run(t);
    expect(t.faulted).toBe(false);
  });

  it('appended (generated) tokens grow a new ridge at the far edge', () => {
    emit.result(t, toks([0.5]), mean([0.5]), 2); run(3);
    emit.append(t, { p: 0.1, h: -Math.log(0.1), token: 'x', generated: true }, mean([0.5, 0.1]), 1);
    expect(t.h).toHaveLength(2);
    expect(t.rise[1]).toBe(0);
    run(2);
    expect(t.rise[1]).toBeGreaterThan(0.99);
    expect(t.generated).toEqual([false, true]);
  });

  it('orbit turns the camera slowly; Side snaps it with the shortest turn', () => {
    const y0 = t.camTarget.yaw;
    run(1);
    expect(t.camTarget.yaw - y0).toBeCloseTo(ORBIT_SPEED, 1);
    t.cam.yaw = t.camTarget.yaw = Math.PI * 2 + 0.3;
    emit.preset(t, 'side');
    expect(t.camTarget.yaw).toBeCloseTo(Math.PI * 2, 10);
    run(3);
    expect(t.cam.pitch).toBeCloseTo(0.1, 2);
  });

  it('arrow-key rotation clamps the pitch', () => {
    emit.rotate(t, 0, 10);
    expect(t.camTarget.pitch).toBe(1.5);
  });

  it('reduced motion shows a static snapshot: no sweep, no orbit', () => {
    bus.reduced = true;
    emit.preset(t, 'side');
    emit.result(t, toks([0.5, 0.2]), mean([0.5, 0.2]), 1);
    step(1 / 60);
    const yaw = t.cam.yaw;
    expect(t.rise).toEqual([1, 1]);
    expect(t.water).toBeCloseTo(mean([0.5, 0.2]), 10);
    run(1);
    expect(t.cam.yaw).toBe(yaw);
  });

  it('scroll velocity boosts the hero flight, then it eases back', () => {
    bus.scrollVelocity = 50; step(1 / 60);
    expect(bus.hero.boost).toBeGreaterThan(0.9);
    run(4);
    expect(bus.hero.boost).toBeLessThan(0.05);
  });
});

describe('projection', () => {
  const p: Projected = { x: 0, y: 0, depth: 0, scale: 0 };
  it('the target lands at the screen centre; nearer points are larger', () => {
    const v = makeView({ yaw: 0.4, pitch: 0.5, dist: 8 }, 800, 400);
    project(v, 0, 0, 0, p);
    expect(p.x).toBeCloseTo(400); expect(p.y).toBeCloseTo(200);
    const far = { ...p }; project(v, 0, 0, -3, far);
    const near = { ...p }; project(v, 0, 0, 3, near);
    expect(near.scale).toBeGreaterThan(far.scale);
  });

  it('points behind the camera are rejected', () => {
    const v = makeView({ yaw: 0, pitch: 0, dist: 5 }, 100, 100);
    expect(project(v, 0, 0, 6, p)).toBe(false);
  });

  it('unprojectGround inverts project on the ground plane', () => {
    const v = makeView({ yaw: 0.7, pitch: 0.6, dist: 9 }, 640, 360, [0.5, 0.4, -1]);
    project(v, 1.3, 0, -2.2, p);
    const g = unprojectGround(v, p.x, p.y)!;
    expect(g.x).toBeCloseTo(1.3, 6); expect(g.z).toBeCloseTo(-2.2, 6);
  });
});

describe('height field', () => {
  it('each ridge column reaches its token height at its centre and falls to the ground beyond the ends', () => {
    const H = [1, 3, 0.5];
    expect(ridgeProfile(H, 0)).toBeCloseTo(1); expect(ridgeProfile(H, 1)).toBeCloseTo(3); expect(ridgeProfile(H, 2)).toBeCloseTo(0.5);
    expect(ridgeProfile(H, 1.2)).toBeCloseTo(3); // flat top
    expect(ridgeProfile(H, -0.5)).toBe(0);
    expect(ridgeProfile(H, 2.5)).toBe(0);
    expect(ridgeProfile([], 0)).toBe(0);
  });

  it('respects the point budget: ~6k desktop, ~2k phone', () => {
    for (const n of [1, 3, 8, 30, 96]) {
      expect(buildField(n, pointCap(false)).count).toBeLessThanOrEqual(6000);
      expect(buildField(n, pointCap(true)).count).toBeLessThanOrEqual(2000);
    }
    expect(buildField(8, 6000).count).toBeGreaterThan(4000);
  });

  it('sorts far to near, and only re-sorts when the camera has turned', () => {
    const f = buildField(4, 600), v = makeView({ yaw: 0, pitch: 0.3, dist: 8 }, 400, 300), o = depthOrder(f, v);
    expect(f.z[o[0]]).toBeLessThan(f.z[o[o.length - 1]]);
    expect(needsSort({ yaw: 0, pitch: 0.3, dist: 8 }, { yaw: 0.01, pitch: 0.3, dist: 8 })).toBe(false);
    expect(needsSort({ yaw: 0, pitch: 0.3, dist: 8 }, { yaw: 0.2, pitch: 0.3, dist: 8 })).toBe(true);
    expect(needsSort(null, { yaw: 0, pitch: 0, dist: 1 })).toBe(true);
  });
});

describe('palette', () => {
  it('elevation LUT has 101 steps from teal to hot red', () => {
    expect(LUT_RGB).toHaveLength(101);
    expect(elevation(0)).toBe('rgb(18,181,166)');
    expect(elevation(0.35)).toBe('rgb(155,229,100)');
    expect(elevation(0.7)).toBe('rgb(255,178,56)');
    expect(elevation(1)).toBe('rgb(255,79,79)');
  });

  // WCAG relative-luminance contrast of the ink tones on the panel colour (deck #0B0D0F).
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  // Panels are deck and void. Ink on the input well (#13161A) is 15.9:1, just under 16 (noted in the README).
  it('meets the contrast targets on panels', () => {
    for (const bg of ['#0B0D0F', '#050607']) {
      expect(contrast('#EEF1EC', bg)).toBeGreaterThanOrEqual(16);
      expect(contrast('#A6ACA8', bg)).toBeGreaterThanOrEqual(7);
      expect(contrast('#7F8682', bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast('#7F8682', '#13161A')).toBeGreaterThanOrEqual(4.5);
  });
});
