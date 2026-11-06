import {
  SlidingLevelMeter,
  dbToLinear,
  linearToDb,
  measureLevel,
  type LevelMeasurement,
  type MeterSnapshot,
  type SlidingMeterConfig,
} from '@lp-labs/loudness-meter';
const level: LevelMeasurement = measureLevel([new Float32Array([0.5, -0.5])], { floorDb: -90 });
level.rmsDb.toFixed();
const config: SlidingMeterConfig = { sampleRate: 1000, windowSeconds: 0.1, channelCount: 1 };
const meter = new SlidingLevelMeter(config);
meter.push([[0.1, 0.2]]);
const snapshot: MeterSnapshot = meter.snapshot();
snapshot.heldPeakDb.toFixed();
linearToDb(1).toFixed();
dbToLinear(-6).toFixed();
// @ts-expect-error channels are planar arrays, not a flat buffer
measureLevel(new Float32Array(2));
// @ts-expect-error windowFrames is read-only
meter.windowFrames = 1;
// @ts-expect-error channelCount is required
new SlidingLevelMeter({ sampleRate: 1, windowSeconds: 1 });
