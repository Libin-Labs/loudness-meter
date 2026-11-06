# @lp-labs/loudness-meter

Measures RMS and sample-peak levels in dBFS, with a sliding-window meter. It is plain level metering, not EBU R128 or LUFS loudness. Catalog identity 488; standalone package version 1.0.0.
No runtime, peer, or sibling dependencies. Node >=18, ESM and CommonJS with declarations.

## Install

```sh
npm install @lp-labs/loudness-meter
```

## Quickstart (runnable JavaScript)

```js
import assert from 'node:assert/strict';
import { SlidingLevelMeter, measureLevel } from '@lp-labs/loudness-meter';
const level = measureLevel([new Float32Array([0.5, -0.5, 0.5, -0.5])]);
assert.equal(level.peak, 0.5);
assert.ok(Math.abs(level.rmsDb - -6.0206) < 1e-3);

const meter = new SlidingLevelMeter({ sampleRate: 10, windowSeconds: 0.4, channelCount: 1 });
meter.push([[1, 1, 0, 0, 0, 0]]);
const snapshot = meter.snapshot();
assert.equal(snapshot.frames, 4);
assert.equal(snapshot.peak, 0);
assert.equal(snapshot.heldPeakDb, 0);
```

## Configuration and errors

`measureLevel(channels, { floorDb })` takes planar channels (Float32Array, Float64Array or arrays of equal length) and returns `rms`/`rmsDb` over every sample of every channel, `peak`/`peakDb` as the largest absolute sample, and `crestDb`. `floorDb` (default -120, range -1000..0) is reported for zero or smaller levels. `linearToDb` and `dbToLinear` are the 20 log10 conversions.

`new SlidingLevelMeter({ sampleRate, windowSeconds, channelCount, floorDb?, maxWindowFrames? })` keeps a window of `max(1, round(windowSeconds * sampleRate))` frames (default budget 16777216, 1..64 channels). `push(channels)` validates the whole block before changing state and accepts any block length; `snapshot()` returns window `rms`, `peak` and the held peak since construction/reset; `reset()` clears everything. A window that is not yet full is measured over the frames received so far.

Errors: `TypeError` for wrong container types; `RangeError` for NaN/Infinity samples, unequal channel lengths, wrong channel count, invalid numbers and exceeded budgets.

## Complete public declarations

Every runtime export and public type is shown below. This is the complete emitted declaration surface.

```ts
export type SampleBuffer = Float32Array | Float64Array | readonly number[];
export interface LevelMeasurement {
  length: number;
  channelCount: number;
  rms: number;
  rmsDb: number;
  peak: number;
  peakDb: number;
  crestDb: number;
}
export interface MeterOptions {
  floorDb?: number;
}
export interface SlidingMeterConfig {
  sampleRate: number;
  windowSeconds: number;
  channelCount: number;
  floorDb?: number;
  maxWindowFrames?: number;
}
export interface MeterSnapshot {
  frames: number;
  rms: number;
  rmsDb: number;
  peak: number;
  peakDb: number;
  heldPeakDb: number;
}
export declare const DEFAULT_FLOOR_DB = -120;
export declare function linearToDb(value: number, floorDb?: number): number;
export declare function dbToLinear(db: number): number;
export declare function measureLevel(
  channels: readonly SampleBuffer[],
  options?: MeterOptions,
): LevelMeasurement;
export declare class SlidingLevelMeter {
  #private;
  readonly windowFrames: number;
  readonly channelCount: number;
  constructor(config: SlidingMeterConfig);
  push(channels: readonly SampleBuffer[]): void;
  snapshot(): MeterSnapshot;
  reset(): void;
}
```

## Performance, boundaries and limitations

**These are not loudness units.** Values are unweighted RMS and sample-peak dBFS: there is no K-weighting, no channel weighting, no absolute or relative gating, no 400 ms/3 s block overlap rules, no loudness range and no LUFS/LKFS/LU result, and the output must not be compared with EBU R128 or ITU-R BS.1770 targets. Peak values are sample peaks and miss inter-sample (true) peaks. A full-scale sine measures about -3.01 dBFS RMS. The sliding meter's running sum is recomputed exactly once per window length to bound floating-point drift; `snapshot()` costs O(window) because the window peak is scanned. Memory is two Float64 values per window frame. Inputs are never modified.

## Development

```sh
npm ci --offline
npm run build
npm run typecheck
npm test
npm run format:check
```

The offline install requires the locked development dependencies already in the npm cache.
Build emits separate ESM/CJS and declarations; type checks include bare-package .mts/.cts consumers with negative cases.
Runtime tests import only the single-quoted standalone dist entry and also run against installed offline tarballs.
No build artifacts or development dependencies are required at runtime.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
