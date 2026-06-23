import { dbToGain, gainToDb } from "./analysis.js";

export function applyPeakLimiter(channels, sampleRate, ceilingDb = -1) {
  const ceiling = dbToGain(ceilingDb);
  const output = channels.map((channel) => new Float32Array(channel.length));
  const release = 1 - Math.exp(-1 / (sampleRate * 0.08));
  let gain = 1;
  let minimumGain = 1;
  const length = channels[0]?.length ?? 0;

  for (let i = 0; i < length; i += 1) {
    let framePeak = 0;
    for (const channel of channels) framePeak = Math.max(framePeak, Math.abs(channel[i]));
    const required = framePeak > ceiling ? ceiling / framePeak : 1;
    gain = required < gain ? required : gain + (1 - gain) * release;
    minimumGain = Math.min(minimumGain, gain);
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      const sample = channels[channelIndex][i] * gain;
      output[channelIndex][i] = Math.max(-ceiling, Math.min(ceiling, Number.isFinite(sample) ? sample : 0));
    }
  }

  return {
    channels: output,
    maxReductionDb: Math.max(0, -gainToDb(minimumGain)),
  };
}
