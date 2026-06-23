import assert from "node:assert/strict";
import test from "node:test";

import { processAudio } from "../js/workers/dsp-core.js";

const NEUTRAL = {
  lowCleanup: 0,
  clarity: 0,
  deharsh: 0,
  punch: 0,
  stereoWidth: 50,
  peakSafe: false,
};

function source(length = 48_000, amplitude = 0.4) {
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    output[i] = (
      Math.sin(i * 0.043) * amplitude
      + Math.cos(i * 0.117) * amplitude * 0.2
    );
  }
  return output;
}

test("neutral processing is sample-identical at 48 kHz", () => {
  const left = source();
  const right = source();
  const result = processAudio([left, right], 48_000, NEUTRAL, 0);
  assert.deepEqual(result.channels[0], left);
  assert.deepEqual(result.channels[1], right);
});

test("silence remains silent and finite", () => {
  const settings = { ...NEUTRAL, lowCleanup: 50, clarity: 50, peakSafe: true };
  const result = processAudio([new Float32Array(12_000)], 48_000, settings, 6);
  assert.ok(result.channels[0].every((sample) => sample === 0));
  assert.ok(result.channels[0].every(Number.isFinite));
});

test("peak safe output never exceeds -1 dBFS", () => {
  const hot = source(48_000, 1.8);
  const settings = { ...NEUTRAL, peakSafe: true };
  const result = processAudio([hot, hot], 48_000, settings, 8);
  const peak = Math.max(...result.channels[0].map(Math.abs));
  const ceiling = 10 ** (-1 / 20);
  assert.ok(peak <= ceiling + 1e-6);
  assert.ok(result.maxReductionDb > 0);
});

test("mono input stays mono and finite after resampling", () => {
  const mono = source(44_100);
  const settings = { ...NEUTRAL, lowCleanup: 25, clarity: 40, peakSafe: true };
  const result = processAudio([mono], 44_100, settings, 0);
  assert.equal(result.channels.length, 1);
  assert.equal(result.channels[0].length, 48_000);
  assert.ok(result.channels[0].every(Number.isFinite));
});
