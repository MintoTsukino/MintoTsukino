import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateAlbumAnalyses,
  analyzeAudio,
  createRenderPlan,
} from "../js/workers/analysis.js";

function sine(amplitude, frequency = 440, seconds = 1, sampleRate = 48_000) {
  const output = new Float32Array(seconds * sampleRate);
  for (let i = 0; i < output.length; i += 1) {
    output[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude;
  }
  return output;
}

test("album analysis preserves the intended inter-track difference", () => {
  const quiet = analyzeAudio([sine(0.1), sine(0.1)], 48_000);
  const loud = analyzeAudio([sine(0.2), sine(0.2)], 48_000);
  const beforeDifference = loud.referenceLoudness - quiet.referenceLoudness;
  assert.ok(Math.abs(beforeDifference - 6.0206) < 0.05);

  const album = aggregateAlbumAnalyses([quiet, loud]);
  const plan = createRenderPlan(album, -14);
  assert.ok(Number.isFinite(plan.sharedGainDb));
  assert.equal(plan.sharedGainDb, Math.min(plan.desiredGainDb, plan.safeGainDb));

  const afterDifference = (loud.referenceLoudness + plan.sharedGainDb)
    - (quiet.referenceLoudness + plan.sharedGainDb);
  assert.ok(Math.abs(afterDifference - beforeDifference) < 1e-10);
});

test("unsafe loudness targets reduce the common gain instead of track differences", () => {
  const analysis = {
    referenceLoudness: -20,
    peakDb: -0.2,
  };
  const plan = createRenderPlan(analysis, -8, { ceilingDb: -1, maxReductionDb: 3 });
  assert.equal(plan.safetyLimited, true);
  assert.ok(plan.predictedReductionDb <= 3 + 1e-10);
});

test("silence analysis stays finite", () => {
  const result = analyzeAudio([new Float32Array(48_000)], 48_000);
  for (const value of Object.values(result)) {
    if (typeof value === "number") assert.ok(Number.isFinite(value));
  }
  assert.equal(result.referenceLoudness, -120);
});
