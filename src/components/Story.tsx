import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { bus, makeTerrain } from '../viz/bus';
import { drawStory } from '../viz/scenes';
import { useCanvas } from '../viz/useCanvas';
import { summarize } from '../lib/tokens';
import { fixed } from '../lib/format';
import { EASE, Label, Reveal, useMedia } from './ui';

// Example probabilities (the Lab's "One surprising word" preset), so the steps have real numbers to show.
const EXAMPLE = [['The', 0.9], ['␣cat', 0.9], ['␣sat', 0.9], ['␣quietly', 0.01]] as const;
const S = summarize(EXAMPLE.map(([, p]) => ({ h: -Math.log(p) })));

const STEPS = [
  { title: 'Lay the sentence flat', note: 'The sentence is split into tokens and laid on the ground in order. Nothing is measured yet.', alt: 'Four tokens lie flat on the ground: The, cat, sat, quietly.' },
  { title: 'Each token rises to its surprise', note: 'The model gives each token a probability P. Its height is -ln P: expected tokens stay low, surprising ones become peaks.', alt: "Three low ridges at P 0.9 and one tall peak, 'quietly', at P 0.01." },
  { title: 'Flood to the average height', note: `Water fills the terrain up to the mean height, the average surprise: here ${fixed(S.meanSurprisal)}.`, alt: `A water plane fills to height ${fixed(S.meanSurprisal)}, covering the low ridges but not the peak.` },
  { title: 'The water level is perplexity', note: `Perplexity is e raised to the water level: e^${fixed(S.meanSurprisal)} ≈ ${fixed(S.perplexity, 1)}. Higher water means a more surprised model.`, alt: `The water edge is labelled e^${fixed(S.meanSurprisal)} = perplexity ${fixed(S.perplexity, 1)}.` },
];

function example() {
  const t = makeTerrain('orbit');
  t.h = EXAMPLE.map(([, p]) => -Math.log(p)); t.p = EXAMPLE.map(([, p]) => p); t.labels = EXAMPLE.map(([w]) => w.replace('␣', ' '));
  t.rise = t.h.map(() => 0); t.riseAt = t.h.map(() => 0); t.generated = t.h.map(() => false);
  t.mean = S.meanSurprisal; t.ppl = S.perplexity; t.hasData = true;
  return t;
}

function StaticScene({ p }: { p: number }) {
  const phone = useMedia('(max-width: 767px)');
  const st = useMemo(example, []);
  const ref = useCanvas((ctx, w, h) => drawStory(ctx, w, h, p, st, phone));
  return <div aria-hidden="true" className="relative h-52 rounded-md bg-deck border border-line overflow-hidden"><canvas ref={ref} className="w-full h-full block" /></div>;
}

const Caption = ({ i }: { i: number }) => (
  <>
    <p className="mono text-[13px] text-ink-faint">{String(i + 1).padStart(2, '0')} / 04</p>
    <h3 className="display text-xl text-ink mt-2">{STEPS[i].title}</h3>
    <p className="text-sm text-ink-dim mt-3 leading-relaxed">{STEPS[i].note}</p>
    <p className="sr-only">{STEPS[i].alt}</p>
  </>
);

const Title = () => (
  <Reveal>
    <Label className="mb-3">SECTOR 02 · METHOD</Label>
    <h2 id="story-title" className="display text-[clamp(28px,4vw,52px)] leading-[1.05] text-ink">How a sentence is scored</h2>
    <p className="text-xs text-ink-faint mt-3">Example probabilities, not from the model.</p>
  </Reveal>
);

export function Story({ pinned }: { pinned: boolean }) {
  const phone = useMedia('(max-width: 767px)');
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLSpanElement>(null);
  const [step, setStep] = useState(0);
  const st = useMemo(example, []);
  const canvasRef = useCanvas((ctx, w, h) => drawStory(ctx, w, h, bus.storyProgress, st, phone));

  useEffect(() => {
    if (!pinned || !section.current || !stage.current) return;
    const trig = ScrollTrigger.create({
      trigger: section.current, start: 'top top', end: '+=300%', pin: stage.current, scrub: true,
      onUpdate: (self) => {
        bus.storyProgress = self.progress;
        setStep(Math.min(3, Math.floor(self.progress * 4)));
        if (rail.current) rail.current.style.transform = `scaleY(${self.progress})`;
      },
    });
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
    return () => trig.kill();
  }, [pinned]);

  if (!pinned) {
    return (
      <section aria-labelledby="story-title" className="px-4 py-20 max-w-3xl mx-auto">
        <div className="mb-10"><Title /></div>
        <ol className="space-y-12">
          {STEPS.map((_, i) => (
            <li key={i}><Reveal><Caption i={i} /><div className="mt-4"><StaticScene p={(i + 0.999) / 4} /></div></Reveal></li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <section ref={section} aria-labelledby="story-title" className="relative">
      <div ref={stage} className="h-[100dvh] flex flex-col justify-center px-6 md:px-16 relative">
        <Title />
        <div className="mt-8 grid md:grid-cols-[minmax(0,1fr)_320px] gap-10 items-center">
          <div aria-hidden="true" className="relative h-[clamp(240px,46vh,460px)] rounded-md bg-deck border border-line overflow-hidden"><canvas ref={canvasRef} className="w-full h-full block" /></div>
          <div aria-live="polite" className="min-h-[170px]">
            <motion.div key={step} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE }}>
              <Caption i={step} />
            </motion.div>
          </div>
        </div>
        <div aria-hidden="true" className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 h-48 w-px bg-line">
          <span ref={rail} className="absolute inset-0 bg-ink origin-top" style={{ transform: 'scaleY(0)' }} />
          {STEPS.map((_, i) => (
            <span key={i} className={`absolute -left-[3px] w-[7px] h-[7px] rounded-full border ${i <= step ? 'bg-ink border-ink' : 'bg-void border-line-hi'}`} style={{ top: `${(i / 3) * 100}%`, marginTop: -3 }} />
          ))}
        </div>
      </div>
    </section>
  );
}
