import assert from "node:assert/strict";
import test from "node:test";

import { analyzeAudio } from "../js/workers/analysis.js";
import { applyDeharsh } from "../js/workers/deharsh.js";
import { processAudio } from "../js/workers/dsp-core.js";
import { applyStereoWidth } from "../js/workers/stereo.js";
import { applyTransientPunch } from "../js/workers/transient.js";

function makeTone(frequency, amplitude, seconds = 1, sampleRate = 48_000) {
  const channel = new Float32Array(sampleRate * seconds);
  for (let index = 0; index < channel.length; index += 1) {
    channel[index] = Math.sin(2 * Math.PI * frequency * index / sampleRate) * amplitude;
  }
  return channel;
}

function maximumAbsolute(channels) {
  let maximum = 0;
  for (const channel of channels) {
    for (const sample of channel) maximum = Math.max(maximum, Math.abs(sample));
  }
  return maximum;
}

test("deharsh is neutral at zero and bounded at full amount", () => {
  const source = makeTone(8_000, 0.5);
  const neutral = applyDeharsh([source], 48_000, 0);
  assert.deepEqual([...neutral.channels[0]], [...source]);

  const reduced = applyDeharsh([source], 48_000, 100);
  assert.ok(reduced.maxReductionDb > 0);
  assert.ok(reduced.maxReductionDb <= 3.0001);
  assert.ok(
    analyzeAudio(reduced.channels, 48_000).rmsDb
      < analyzeAudio([source], 48_000).rmsDb,
  );
});

test("transient punch is stereo-linked and limited to a small boost", () => {
  const left = new Float32Array(48_000);
  const right = new Float32Array(48_000);
  left[2_000] = 0.4;
  right[2_000] = -0.2;
  const output = applyTransientPunch([left, right], 48_000, 100);
  const leftRatio = output[0][2_000] / left[2_000];
  const rightRatio = output[1][2_000] / right[2_000];
  assert.ok(leftRatio > 1);
  assert.ok(leftRatio <= 10 ** (3 / 20) + 1e-5);
  assert.ok(Math.abs(leftRatio - rightRatio) < 1e-6);
});

test("stereo width keeps mono input mono and neutral stereo sample-identical", () => {
  const mono = makeTone(440, 0.2);
  const monoOutput = applyStereoWidth([mono], 48_000, 100);
  assert.deepEqual([...monoOutput[0]], [...mono]);

  const left = makeTone(220, 0.2);
  const right = makeTone(330, 0.2);
  const neutral = applyStereoWidth([left, right], 48_000, 50);
  assert.deepEqual([...neutral[0]], [...left]);
  assert.deepEqual([...neutral[1]], [...right]);
});

test("full Gate 2 chain stays finite and below the ceiling", () => {
  const left = makeTone(220, 0.9);
  const right = makeTone(330, 0.9);
  const result = processAudio([left, right], 48_000, {
    lowCleanup: 80,
    clarity: 80,
    deharsh: 80,
    punch: 80,
    stereoWidth: 85,
    peakSafe: true,
  }, 6);

  assert.ok(result.channels.every((channel) => channel.every(Number.isFinite)));
  assert.ok(maximumAbsolute(result.channels) <= 10 ** (-1 / 20) + 1e-6);
  assert.ok(result.maxReductionDb > 0);
});

test("common-gain processing keeps the track difference within one LU", () => {
  const quiet = makeTone(440, 0.08);
  const loud = makeTone(440, 0.16);
  const settings = {
    lowCleanup: 40,
    clarity: 55,
    deharsh: 60,
    punch: 50,
    stereoWidth: 55,
    peakSafe: true,
  };
  const beforeDifference = analyzeAudio([loud], 48_000).referenceLoudness
    - analyzeAudio([quiet], 48_000).referenceLoudness;
  const afterQuiet = processAudio([quiet], 48_000, settings, 2).analysis.referenceLoudness;
  const afterLoud = processAudio([loud], 48_000, settings, 2).analysis.referenceLoudness;
  assert.ok(Math.abs((afterLoud - afterQuiet) - beforeDifference) <= 1);
});
