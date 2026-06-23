import { dbToGain } from "./analysis.js";

function cloneChannels(channels) {
  return channels.map((channel) => new Float32Array(channel));
}

export function applyDeharsh(channels, sampleRate, amount = 0) {
  const normalized = Math.max(0, Math.min(1, amount / 100));
  if (normalized === 0 || channels.length === 0) {
    return { channels: cloneChannels(channels), maxReductionDb: 0 };
  }

  const output = channels.map((channel) => new Float32Array(channel.length));
  const lowStates = channels.map(() => 0);
  const lowCoefficient = Math.exp(-2 * Math.PI * 4_200 / sampleRate);
  const attack = 1 - Math.exp(-1 / (sampleRate * 0.004));
  const release = 1 - Math.exp(-1 / (sampleRate * 0.09));
  const threshold = 0.018 + (1 - normalized) * 0.04;
  const maximumReductionDb = 3 * normalized;
  let envelope = 0;
  let appliedReductionDb = 0;
  const length = channels[0]?.length ?? 0;

  for (let index = 0; index < length; index += 1) {
    let frameHigh = 0;
    const highs = new Array(channels.length);
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      const sample = Number.isFinite(channels[channelIndex][index])
        ? channels[channelIndex][index]
        : 0;
      lowStates[channelIndex] = lowCoefficient * lowStates[channelIndex]
        + (1 - lowCoefficient) * sample;
      highs[channelIndex] = sample - lowStates[channelIndex];
      frameHigh = Math.max(frameHigh, Math.abs(highs[channelIndex]));
    }

    const coefficient = frameHigh > envelope ? attack : release;
    envelope += (frameHigh - envelope) * coefficient;
    const intensity = Math.max(0, Math.min(1, (envelope - threshold) / Math.max(threshold, 1e-6)));
    const reductionDb = maximumReductionDb * intensity;
    appliedReductionDb = Math.max(appliedReductionDb, reductionDb);
    const highGain = dbToGain(-reductionDb);

    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      output[channelIndex][index] = lowStates[channelIndex] + highs[channelIndex] * highGain;
    }
  }

  return { channels: output, maxReductionDb: appliedReductionDb };
}
