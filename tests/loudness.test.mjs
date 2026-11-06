import test from 'node:test';
import assert from 'node:assert/strict';
import { SlidingLevelMeter, dbToLinear, linearToDb, measureLevel } from '../dist/esm/index.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);
const lcg = (seed) => {
  let s = seed;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
};

test('rejects malformed channels, options and configs', () => {
  assert.throws(() => measureLevel(new Float32Array(2)), TypeError);
  assert.throws(() => measureLevel([]), TypeError);
  assert.throws(() => measureLevel([new Int8Array(1)]), TypeError);
  assert.throws(() => measureLevel([[0, Number.NaN]]), RangeError);
  assert.throws(() => measureLevel([new Float32Array([Infinity])]), RangeError);
  assert.throws(() => measureLevel([[1], [1, 2]]), RangeError);
  assert.throws(() => measureLevel([[1]], { floorDb: 3 }), RangeError);
  assert.throws(() => linearToDb(-1), RangeError);
  assert.throws(() => linearToDb(Number.NaN), RangeError);
  assert.throws(() => dbToLinear(Infinity), RangeError);
  for (const bad of [
    { sampleRate: 0 },
    { windowSeconds: -1 },
    { channelCount: 0 },
    { channelCount: 1.5 },
    { maxWindowFrames: 0 },
  ]) {
    assert.throws(
      () => new SlidingLevelMeter({ sampleRate: 100, windowSeconds: 1, channelCount: 1, ...bad }),
      RangeError,
    );
  }
  assert.throws(() => new SlidingLevelMeter(null), TypeError);
  assert.throws(
    () => new SlidingLevelMeter({ sampleRate: 1e6, windowSeconds: 100, channelCount: 1 }),
    RangeError,
  );
  const meter = new SlidingLevelMeter({ sampleRate: 10, windowSeconds: 1, channelCount: 2 });
  assert.throws(() => meter.push([[1]]), RangeError);
  assert.throws(() => meter.push([[1], [Number.NaN]]), RangeError);
  assert.equal(meter.snapshot().frames, 0);
});

test('RMS and peak match hand-computed dBFS values', () => {
  const full = measureLevel([[1, 1, 1, 1]]);
  assert.equal(full.rmsDb, 0);
  assert.equal(full.peakDb, 0);
  assert.equal(full.crestDb, 0);
  const sine = measureLevel([
    Float64Array.from({ length: 1000 }, (_, i) => Math.sin((2 * Math.PI * 10 * i) / 1000)),
  ]);
  near(sine.rmsDb, -3.0103, 1e-3);
  near(sine.crestDb, 3.0103, 1e-3);
  const half = measureLevel([
    [0.5, -0.5],
    [0, 0],
  ]);
  near(half.rms, Math.sqrt(0.125));
  near(half.peakDb, 20 * Math.log10(0.5));
  assert.equal(half.channelCount, 2);
});

test('silence and empty input use the configured floor', () => {
  const silent = measureLevel([[0, 0]], { floorDb: -90 });
  assert.equal(silent.rmsDb, -90);
  assert.equal(silent.crestDb, 0);
  const empty = measureLevel([[]]);
  assert.equal(empty.length, 0);
  assert.equal(empty.rmsDb, -120);
  assert.equal(linearToDb(1e-9, -60), -60);
  near(dbToLinear(linearToDb(0.25)), 0.25);
});

test('sliding window equals recomputing the last N frames in any chunking', () => {
  const rand = lcg(3);
  const frames = 1234;
  const data = [
    Float64Array.from({ length: frames }, () => rand() * 0.8),
    Float64Array.from({ length: frames }, () => rand() * 0.3),
  ];
  const window = 100;
  const meter = new SlidingLevelMeter({ sampleRate: 1000, windowSeconds: 0.1, channelCount: 2 });
  assert.equal(meter.windowFrames, window);
  let at = 0;
  for (const chunk of [1, 7, 99, 100, 101, 300, 626]) {
    meter.push(data.map((c) => c.subarray(at, at + chunk)));
    at += chunk;
    const from = Math.max(0, at - window);
    const slice = data.map((c) => Array.from(c.subarray(from, at)));
    const expected = measureLevel(slice);
    const snap = meter.snapshot();
    assert.equal(snap.frames, at - from);
    near(snap.rms, expected.rms, 1e-9);
    near(snap.peak, expected.peak, 0);
    near(snap.rmsDb, expected.rmsDb, 1e-7);
  }
  assert.equal(at, frames);
});

test('held peak survives the window while window peak decays; reset clears state', () => {
  const meter = new SlidingLevelMeter({ sampleRate: 10, windowSeconds: 0.5, channelCount: 1 });
  meter.push([[0.9, 0, 0, 0, 0, 0]]);
  const snap = meter.snapshot();
  assert.equal(snap.peak, 0);
  near(snap.heldPeakDb, 20 * Math.log10(0.9));
  assert.equal(snap.rmsDb, -120);
  meter.reset();
  assert.deepEqual(meter.snapshot(), {
    frames: 0,
    rms: 0,
    rmsDb: -120,
    peak: 0,
    peakDb: -120,
    heldPeakDb: -120,
  });
});

test('long runs stay accurate (running sum recomputation bounds drift)', () => {
  const meter = new SlidingLevelMeter({ sampleRate: 1000, windowSeconds: 0.05, channelCount: 1 });
  const rand = lcg(11);
  let last = [];
  for (let block = 0; block < 400; block++) {
    last = Float64Array.from({ length: 50 }, () => rand() * (block % 2 ? 1e3 : 1e-3));
    meter.push([last]);
  }
  near(meter.snapshot().rms, measureLevel([last]).rms, 1e-6 * measureLevel([last]).rms);
});

test('measurement does not retain or mutate input', () => {
  const input = new Float32Array([0.5, 0.25]);
  const before = Array.from(input);
  const result = measureLevel([input]);
  result.rms = 0;
  assert.deepEqual(Array.from(input), before);
});
