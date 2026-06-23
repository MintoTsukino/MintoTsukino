import { dbToGain } from "./analysis.js";

function cloneChannels(channels) {
  return channels.map((channel) => new Float32Array(channel));
}

export function applyTransientPunch(channels, sampleRate, amount = 0) {
  const normalized = Math.max(0, Math.min(1, amount / 100));
  if (normalized === 0 || channels.length === 0) return cloneChannels(channels);

  const output = channels.map((channel) => new Float32Array(channel.length));
  const fastAttack = 1 - Math.exp(-1 / (sampleRate * 0.0015));
  const fastRelease = 1 - Math.exp(-1 / (sampleRate * 0.035));
  const slowAttack = 1 - Math.exp(-1 / (sampleRate * 0.018));
  const slowRelease = 1 - Math.exp(-1 / (sampleRate * 0.16));
  const maximumBoostDb = 3 * normalized;
  let fastEnvelope = 0;
  let slowEnvelope = 0;
  const length = channels[0]?.length ?? 0;

  for (let index = 0; index < length; index += 1) {
    let framePeak = 0;
    for (const channel of channels) {
      const sample = Number.isFinite(channel[index]) ? channel[index] : 0;
      framePeak = Math.max(framePeak, Math.abs(sample));
    }

    const fastCoefficient = framePeak > fastEnvelope ? fastAttack : fastRelease;
    const slowCoefficient = framePeak > slowEnvelope ? slowAttack : slowRelease;
    fastEnvelope += (framePeak - fastEnvelope) * fastCoefficient;
    slowEnvelope += (framePeak - slowEnvelope) * slowCoefficient;
    const transientRatio = Math.max(0, Math.min(1, (fastEnvelope - slowEnvelope) / Math.max(0.03, slowEnvelope)));
    const gain = dbToGain(maximumBoostDb * transientRatio);

    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      const sample = Number.isFinite(channels[channelIndex][index])
        ? channels[channelIndex][index]
        : 0;
      output[channelIndex][index] = sample * gain;
    }
  }

  return output;
}
