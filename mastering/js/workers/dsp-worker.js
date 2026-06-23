import { analyzeAudio, resampleChannels } from "./analysis.js";
import { processAudio } from "./dsp-core.js";
import { encodeWav24, inspectWav24 } from "./wav-encoder.js";

self.addEventListener("message", (event) => {
  const { id, action, channels, sampleRate, settings, sharedGainDb } = event.data;
  try {
    if (action === "analyze") {
      const resampled = resampleChannels(channels, sampleRate, 48_000);
      const analysis = analyzeAudio(resampled, 48_000);
      self.postMessage({ id, type: "result", analysis });
      return;
    }

    if (action === "process") {
      const result = processAudio(
        channels,
        sampleRate,
        settings,
        sharedGainDb,
        (progress) => self.postMessage({ id, type: "progress", progress }),
      );
      const wav = encodeWav24(result.channels, result.sampleRate);
      const wavInfo = inspectWav24(wav);
      if (result.channels.some((channel) => channel.some((sample) => !Number.isFinite(sample)))) {
        throw new Error("処理後の音声に不正な値があります。");
      }
      self.postMessage({
        id,
        type: "result",
        wav,
        analysis: result.analysis,
        maxReductionDb: result.maxReductionDb,
        wavInfo,
      }, [wav]);
      return;
    }

    if (action === "preview") {
      const result = processAudio(
        channels,
        sampleRate,
        settings,
        sharedGainDb,
        (progress) => self.postMessage({ id, type: "progress", progress }),
      );
      const transfer = result.channels.map((channel) => channel.buffer);
      self.postMessage({
        id,
        type: "result",
        channels: result.channels,
        sampleRate: result.sampleRate,
        analysis: result.analysis,
        maxReductionDb: result.maxReductionDb,
        deharshReductionDb: result.deharshReductionDb,
      }, transfer);
      return;
    }

    throw new Error(`未対応の処理です: ${action}`);
  } catch (error) {
    self.postMessage({
      id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
