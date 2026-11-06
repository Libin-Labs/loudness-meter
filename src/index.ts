export type SampleBuffer = Float32Array | Float64Array | readonly number[];

export interface LevelMeasurement {
  /** Frames per channel. */
  length: number;
  channelCount: number;
  /** Root mean square over every sample of every channel (linear). */
  rms: number;
  rmsDb: number;
  /** Largest absolute sample value (sample peak, not an inter-sample true peak). */
  peak: number;
  peakDb: number;
  /** peakDb - rmsDb; 0 for silence. */
  crestDb: number;
}

export interface MeterOptions {
  /** Level reported for zero or tiny values. Default -120. */
  floorDb?: number;
}

export interface SlidingMeterConfig {
  sampleRate: number;
  windowSeconds: number;
  channelCount: number;
  floorDb?: number;
  /** Upper bound on window frames (default 16777216). */
  maxWindowFrames?: number;
}

export interface MeterSnapshot {
  /** Frames currently inside the window (at most the window length). */
  frames: number;
  rms: number;
  rmsDb: number;
  peak: number;
  peakDb: number;
  /** Largest sample peak seen since construction or reset. */
  heldPeakDb: number;
}

export const DEFAULT_FLOOR_DB = -120;

function floorOf(value: unknown): number {
  const floor = value === undefined ? DEFAULT_FLOOR_DB : value;
  if (typeof floor !== 'number' || !Number.isFinite(floor) || floor > 0 || floor < -1000) {
    throw new RangeError('floorDb must be a finite number from -1000 to 0');
  }
  return floor;
}

/** Linear amplitude to dBFS (20 log10), clamped below at floorDb. */
export function linearToDb(value: number, floorDb: number = DEFAULT_FLOOR_DB): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError('value must be a finite non-negative number');
  }
  const floor = floorOf(floorDb);
  return value === 0 ? floor : Math.max(floor, 20 * Math.log10(value));
}

export function dbToLinear(db: number): number {
  if (typeof db !== 'number' || !Number.isFinite(db)) throw new RangeError('db must be finite');
  return 10 ** (db / 20);
}

function checkChannels(channels: unknown): asserts channels is readonly SampleBuffer[] {
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new TypeError('channels must be a non-empty array of sample buffers');
  }
  let length = -1;
  for (const [c, channel] of (channels as unknown[]).entries()) {
    if (!(
      channel instanceof Float32Array ||
      channel instanceof Float64Array ||
      Array.isArray(channel)
    )) {
      throw new TypeError(`channels[${c}] must be a Float32Array, Float64Array or number array`);
    }
    const values = channel as ArrayLike<unknown>;
    if (length === -1) length = values.length;
    else if (length !== values.length) throw new RangeError('channels must have equal lengths');
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new RangeError(`channels[${c}][${i}] must be a finite number`);
      }
    }
  }
}

/**
 * Plain RMS and sample-peak levels in dBFS. A full-scale sine has an RMS of about -3.01 dBFS.
 * This is NOT ITU-R BS.1770 / EBU R128 loudness: no K-weighting, gating or LUFS.
 */
export function measureLevel(
  channels: readonly SampleBuffer[],
  options: MeterOptions = {},
): LevelMeasurement {
  checkChannels(channels);
  const floor = floorOf(options.floorDb);
  const length = channels[0]!.length;
  let sum = 0;
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < length; i++) {
      const value = channel[i]!;
      sum += value * value;
      const magnitude = Math.abs(value);
      if (magnitude > peak) peak = magnitude;
    }
  }
  const samples = length * channels.length;
  const rms = samples === 0 ? 0 : Math.sqrt(sum / samples);
  const rmsDb = linearToDb(rms, floor);
  const peakDb = linearToDb(peak, floor);
  return {
    length,
    channelCount: channels.length,
    rms,
    rmsDb,
    peak,
    peakDb,
    crestDb: peak === 0 ? 0 : peakDb - rmsDb,
  };
}

/** Rolling RMS/peak over the most recent windowSeconds of planar frames (not R128 momentary loudness). */
export class SlidingLevelMeter {
  readonly windowFrames: number;
  readonly channelCount: number;
  readonly #floor: number;
  readonly #power: Float64Array;
  readonly #peaks: Float64Array;
  #head = 0;
  #filled = 0;
  #sum = 0;
  #sinceRecompute = 0;
  #held = 0;

  constructor(config: SlidingMeterConfig) {
    if (typeof config !== 'object' || config === null)
      throw new TypeError('config must be an object');
    const { sampleRate, windowSeconds, channelCount } = config;
    if (typeof sampleRate !== 'number' || !Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError('sampleRate must be a positive finite number');
    }
    if (
      typeof windowSeconds !== 'number' ||
      !Number.isFinite(windowSeconds) ||
      windowSeconds <= 0
    ) {
      throw new RangeError('windowSeconds must be a positive finite number');
    }
    if (!Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 64) {
      throw new RangeError('channelCount must be an integer from 1 to 64');
    }
    const maxFrames = config.maxWindowFrames ?? 16_777_216;
    if (!Number.isSafeInteger(maxFrames) || maxFrames < 1)
      throw new RangeError('maxWindowFrames must be a positive integer');
    const frames = Math.max(1, Math.round(windowSeconds * sampleRate));
    if (frames > maxFrames) throw new RangeError('window exceeds maxWindowFrames');
    this.windowFrames = frames;
    this.channelCount = channelCount;
    this.#floor = floorOf(config.floorDb);
    this.#power = new Float64Array(frames);
    this.#peaks = new Float64Array(frames);
  }

  /** Appends planar frames; input is validated completely before any state changes. */
  push(channels: readonly SampleBuffer[]): void {
    checkChannels(channels);
    if (channels.length !== this.channelCount)
      throw new RangeError(`expected ${this.channelCount} channels`);
    const length = channels[0]!.length;
    for (let i = 0; i < length; i++) {
      let power = 0;
      let peak = 0;
      for (const channel of channels) {
        const value = channel[i]!;
        power += value * value;
        peak = Math.max(peak, Math.abs(value));
      }
      power /= this.channelCount;
      this.#sum += power - this.#power[this.#head]!;
      this.#power[this.#head] = power;
      this.#peaks[this.#head] = peak;
      if (peak > this.#held) this.#held = peak;
      this.#head = (this.#head + 1) % this.windowFrames;
      if (this.#filled < this.windowFrames) this.#filled++;
      if (++this.#sinceRecompute >= this.windowFrames) this.#recompute();
    }
  }

  #recompute(): void {
    let sum = 0;
    for (let i = 0; i < this.windowFrames; i++) sum += this.#power[i]!;
    this.#sum = sum;
    this.#sinceRecompute = 0;
  }

  snapshot(): MeterSnapshot {
    let peak = 0;
    for (let i = 0; i < this.#filled; i++) peak = Math.max(peak, this.#peaks[i]!);
    const rms = this.#filled === 0 ? 0 : Math.sqrt(Math.max(0, this.#sum) / this.#filled);
    return {
      frames: this.#filled,
      rms,
      rmsDb: linearToDb(rms, this.#floor),
      peak,
      peakDb: linearToDb(peak, this.#floor),
      heldPeakDb: linearToDb(this.#held, this.#floor),
    };
  }

  reset(): void {
    this.#power.fill(0);
    this.#peaks.fill(0);
    this.#head = 0;
    this.#filled = 0;
    this.#sum = 0;
    this.#sinceRecompute = 0;
    this.#held = 0;
  }
}
