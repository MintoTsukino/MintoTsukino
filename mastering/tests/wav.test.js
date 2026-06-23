import assert from "node:assert/strict";
import test from "node:test";

import { encodeWav24, inspectWav24 } from "../js/workers/wav-encoder.js";

test("24-bit WAV header and sample count are correct", () => {
  const left = new Float32Array([0, 0.25, -0.25, 0.9]);
  const right = new Float32Array([0.1, -0.1, 0.5, -0.5]);
  const wav = encodeWav24([left, right], 48_000);
  const info = inspectWav24(wav);
  assert.deepEqual(info, {
    channelCount: 2,
    sampleRate: 48_000,
    bitsPerSample: 24,
    dataSize: 24,
    sampleFrames: 4,
  });
  assert.equal(wav.byteLength, 68);
});

test("non-finite source samples encode safely", () => {
  const wav = encodeWav24([
    new Float32Array([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]),
  ]);
  const bytes = new Uint8Array(wav, 44);
  assert.ok(bytes.every((value) => value === 0));
});
