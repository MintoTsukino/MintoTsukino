import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateOutputBytes,
  LARGE_OUTPUT_BYTES,
  shouldUseIndividualDownloads,
} from "../js/output-policy.js";

test("output estimate reflects 24-bit 48 kHz channel data", () => {
  const bytes = estimateOutputBytes([{ duration: 10, channels: 2 }]);
  assert.equal(bytes, 10 * 48_000 * 2 * 3 + 44);
});

test("large albums switch to individual downloads", () => {
  const duration = (LARGE_OUTPUT_BYTES + 1) / (48_000 * 2 * 3);
  assert.equal(shouldUseIndividualDownloads([{ duration, channels: 2 }]), true);
  assert.equal(shouldUseIndividualDownloads([{ duration: 1, channels: 2 }]), false);
});
