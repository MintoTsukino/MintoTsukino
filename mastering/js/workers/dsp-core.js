import { analyzeAudio, dbToGain, resampleChannels } from "./analysis.js";
import { applyBiquad } from "./biquad.js";
import { applyPeakLimiter } from "./limiter.js";

function amountCurve(value) {
  const normalized = Math.max(0, Math.min(1, value / 100));
  return normalized * normalized * (3 - 2 * normalized);
}

function cloneChannels(channels) {
  return channels.map((channel) => new Float32Array(channel));
}

export function processAudio(channels, sourceRate, settings, sharedGainDb, onProgress = () => {}) {
  const sampleRate = 48_000;
  let output = resampleChannels(channels, sourceRate, sampleRate);
  onProgress(0.15);

  const lowAmount = amountCurve(settings.lowCleanup ?? 0);
  if (lowAmount > 0) {
    const cutoff = 18 + 17 * lowAmount;
    output = output.map((channel) => applyBiquad(channel, "highpass", sampleRate, cutoff, Math.SQRT1_2));
    output = output.map((channel) => applyBiquad(channel, "lowshelf", sampleRate, 120, Math.SQRT1_2, -1.5 * lowAmount));
  } else {
    output = cloneChannels(output);
  }
  onProgress(0.38);

  const clarityAmount = amountCurve(settings.clarity ?? 0);
  if (clarityAmount > 0) {
    output = output.map((channel) => applyBiquad(channel, "peaking", sampleRate, 3_000, 0.75, 2 * clarityAmount));
  }
  onProgress(0.58);

  const sharedGain = dbToGain(sharedGainDb);
  for (const channel of output) {
    for (let i = 0; i < channel.length; i += 1) channel[i] *= sharedGain;
  }
  onProgress(0.76);

  let maxReductionDb = 0;
  if (settings.peakSafe !== false) {
    const limited = applyPeakLimiter(output, sampleRate, -1);
    output = limited.channels;
    maxReductionDb = limited.maxReductionDb;
  }
  onProgress(1);

  return {
    channels: output,
    sampleRate,
    maxReductionDb,
    analysis: analyzeAudio(output, sampleRate),
  };
}
