import assert from "node:assert/strict";
import test from "node:test";

import { recommendSettings } from "../js/auto-finish.js";
import { copySettings } from "../js/finish-types.js";

test("auto finish keeps the chosen target and bounds every adjustment", () => {
  const base = copySettings("streaming");
  const result = recommendSettings(base, {
    lowRatio: 0.8,
    presenceRatio: 0.08,
    highRatio: 0.4,
    crestDb: 4,
    correlation: -0.2,
    sideRatio: 0.4,
  });

  assert.equal(result.settings.targetLoudness, base.targetLoudness);
  for (const property of ["lowCleanup", "clarity", "deharsh", "punch", "stereoWidth"]) {
    assert.ok(Math.abs(result.settings[property] - base[property]) <= 15);
    assert.ok(result.settings[property] >= 0 && result.settings[property] <= 100);
  }
  assert.ok(result.reasons.length >= 1);
});
