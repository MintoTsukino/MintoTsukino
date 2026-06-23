import { aggregateAlbumAnalyses, createRenderPlan } from "./album-analysis.js";
import { recommendSettings } from "./auto-finish.js";
import { createZip, triggerDownload } from "./export.js";
import { copySettings, FINISH_TYPES } from "./finish-types.js";
import {
  collectDroppedFiles,
  createTrackEntries,
  resolveOutputPaths,
} from "./files.js";
import {
  estimateOutputBytes,
  LARGE_OUTPUT_BYTES,
  shouldUseIndividualDownloads,
} from "./output-policy.js";
import { createPreviewController } from "./preview.js";
import { appState, resetAlbumState } from "./state.js";
import { drawWaveform } from "./waveform.js";
import { analyzeAudio, resampleChannels } from "./workers/analysis.js";
import { encodeWav24 } from "./workers/wav-encoder.js";

const OUTPUT_SAMPLE_RATE = 48_000;

const elements = {
  status: document.querySelector("#app-status"),
  dropZone: document.querySelector("#drop-zone"),
  fileInput: document.querySelector("#file-input"),
  folderInput: document.querySelector("#folder-input"),
  chooseFiles: document.querySelector("#choose-files"),
  chooseFolder: document.querySelector("#choose-folder"),
  addDemo: document.querySelector("#add-demo"),
  clearFiles: document.querySelector("#clear-files"),
  trackList: document.querySelector("#track-list"),
  trackSummary: document.querySelector("#track-summary"),
  fileWarning: document.querySelector("#file-warning"),
  finishTypes: document.querySelector("#finish-types"),
  customLabel: document.querySelector("#custom-label"),
  autoFinish: document.querySelector("#auto-finish"),
  autoFeedback: document.querySelector("#auto-feedback"),
  previewTrack: document.querySelector("#preview-track"),
  preparePreview: document.querySelector("#prepare-preview"),
  waveform: document.querySelector("#waveform"),
  playTime: document.querySelector("#play-time"),
  playOriginal: document.querySelector("#play-original"),
  playFinished: document.querySelector("#play-finished"),
  stopPreview: document.querySelector("#stop-preview"),
  levelMatch: document.querySelector("#level-match"),
  meterPeak: document.querySelector("#meter-peak"),
  meterRms: document.querySelector("#meter-rms"),
  meterCrest: document.querySelector("#meter-crest"),
  meterLufs: document.querySelector("#meter-lufs"),
  meterReduction: document.querySelector("#meter-reduction"),
  renderAll: document.querySelector("#render-all"),
  cancelRender: document.querySelector("#cancel-render"),
  renderMessage: document.querySelector("#render-message"),
  albumProgress: document.querySelector("#album-progress"),
  albumProgressText: document.querySelector("#album-progress-text"),
  trackProgress: document.querySelector("#track-progress"),
  trackProgressText: document.querySelector("#track-progress-text"),
  downloadArea: document.querySelector("#download-area"),
};

const settingInputs = {
  targetLoudness: document.querySelector("#target-loudness"),
  lowCleanup: document.querySelector("#low-cleanup"),
  clarity: document.querySelector("#clarity"),
  deharsh: document.querySelector("#deharsh"),
  punch: document.querySelector("#punch"),
  stereoWidth: document.querySelector("#stereo-width"),
  peakSafe: document.querySelector("#peak-safe"),
};

const workerRequests = new Map();
let workerRequestId = 0;
let dspWorker = createDspWorker();
let audioContext = null;
let downloadUrls = [];

function createDspWorker() {
  const worker = new Worker(new URL("./workers/dsp-worker.js", import.meta.url), { type: "module" });
  worker.addEventListener("message", ({ data }) => {
    const request = workerRequests.get(data.id);
    if (!request) return;
    if (data.type === "progress") {
      request.onProgress?.(data.progress);
      return;
    }
    workerRequests.delete(data.id);
    if (data.type === "error") request.reject(new Error(data.message));
    else request.resolve(data);
  });
  worker.addEventListener("error", (event) => {
    for (const request of workerRequests.values()) {
      request.reject(new Error(event.message || "音声処理を続けられませんでした。"));
    }
    workerRequests.clear();
  });
  return worker;
}

function restartDspWorker(reason = "音声処理を中止しました。") {
  dspWorker.terminate();
  for (const request of workerRequests.values()) request.reject(new Error(reason));
  workerRequests.clear();
  dspWorker = createDspWorker();
}

function runWorker(action, channels, sampleRate, extras = {}, onProgress) {
  const id = ++workerRequestId;
  const transfer = channels.map((channel) => channel.buffer);
  return new Promise((resolve, reject) => {
    workerRequests.set(id, { resolve, reject, onProgress });
    dspWorker.postMessage({ id, action, channels, sampleRate, ...extras }, transfer);
  });
}

function ensureAudioContext() {
  if (!audioContext) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error("このブラウザは音声処理に対応していません。");
    audioContext = new Context({ sampleRate: OUTPUT_SAMPLE_RATE });
  }
  return audioContext;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function updatePlayTime(current, duration, kind) {
  elements.playTime.textContent = `${formatDuration(current)} / ${formatDuration(duration)}`;
  elements.playOriginal.classList.toggle("playing", kind === "original");
  elements.playFinished.classList.toggle("playing", kind === "finished");
  if (elements.stopPreview) elements.stopPreview.disabled = !kind;
}

const previewController = createPreviewController(ensureAudioContext, updatePlayTime);

async function decodeTrack(track) {
  const context = ensureAudioContext();
  const source = await track.file.arrayBuffer();
  const buffer = await context.decodeAudioData(source.slice(0));
  if (buffer.numberOfChannels < 1) throw new Error("音声チャンネルがありません。");
  const channelCount = Math.min(2, buffer.numberOfChannels);
  const channels = Array.from(
    { length: channelCount },
    (_, index) => new Float32Array(buffer.getChannelData(index)),
  );
  return { channels, sampleRate: buffer.sampleRate };
}

function setStatus(message, state = "ready") {
  elements.status.textContent = message;
  elements.status.dataset.state = state;
}

function formatBytes(bytes) {
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

function settingsFromInputs() {
  return {
    targetLoudness: Number(settingInputs.targetLoudness.value),
    lowCleanup: Number(settingInputs.lowCleanup.value),
    clarity: Number(settingInputs.clarity.value),
    deharsh: Number(settingInputs.deharsh.value),
    punch: Number(settingInputs.punch.value),
    stereoWidth: Number(settingInputs.stereoWidth.value),
    peakSafe: settingInputs.peakSafe.checked,
  };
}

function updateRangeOutput(input) {
  const output = document.querySelector(`output[for="${input.id}"]`);
  if (!output) return;
  const unit = output.dataset.unit ?? "";
  output.value = `${input.value}${unit}`;
  output.textContent = `${input.value}${unit}`;
}

function applySettingsToInputs(settings) {
  for (const [key, input] of Object.entries(settingInputs)) {
    if (input.type === "checkbox") input.checked = Boolean(settings[key]);
    else {
      input.value = settings[key];
      updateRangeOutput(input);
    }
  }
  appState.settings = { ...settings };
}

function clearPreview() {
  previewController.stop();
  appState.preview = null;
  drawWaveform(elements.waveform);
  elements.playOriginal.disabled = true;
  elements.playFinished.disabled = true;
  elements.playTime.textContent = "0:00 / 0:00";
  for (const meter of [
    elements.meterPeak,
    elements.meterRms,
    elements.meterCrest,
    elements.meterLufs,
    elements.meterReduction,
  ]) meter.textContent = "—";
}

function selectFinishType(typeId) {
  appState.selectedFinishType = typeId;
  appState.customSettings = false;
  applySettingsToInputs(copySettings(typeId));
  const type = FINISH_TYPES[typeId];
  elements.customLabel.textContent = type.label;
  elements.autoFeedback.hidden = true;
  for (const button of elements.finishTypes.querySelectorAll("[data-finish-type]")) {
    const selected = button.dataset.finishType === typeId;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  clearPreview();
  if (appState.albumAnalysis) updateRenderPlan();
}

function markCustomSettings() {
  appState.customSettings = true;
  appState.settings = settingsFromInputs();
  elements.customLabel.textContent = "カスタム";
  elements.autoFeedback.hidden = true;
  clearPreview();
  if (appState.albumAnalysis) updateRenderPlan();
}

function renderTrackList() {
  elements.trackList.replaceChildren();
  if (appState.tracks.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "まだ音声ファイルはありません。";
    elements.trackList.append(empty);
  } else {
    appState.tracks.forEach((track, index) => {
      const item = document.createElement("li");
      item.className = "track-item";
      item.dataset.trackId = track.id;
      const status = track.status === "error"
        ? `読み込み失敗: ${track.error}`
        : track.status === "analyzing"
          ? "解析中…"
          : track.analysis
            ? `${formatDuration(track.duration)} / ${track.analysis.referenceLoudness.toFixed(1)} 参考LUFS`
            : "解析待ち";
      item.innerHTML = `
        <span class="track-index">${String(index + 1).padStart(2, "0")}</span>
        <span class="track-name"><strong></strong><small></small></span>
        <span class="track-size">${formatBytes(track.size)}</span>
        <span class="track-actions">
          <button class="track-action" type="button" data-action="up" aria-label="上へ移動" ${index === 0 || appState.render.active ? "disabled" : ""}>↑</button>
          <button class="track-action" type="button" data-action="down" aria-label="下へ移動" ${index === appState.tracks.length - 1 || appState.render.active ? "disabled" : ""}>↓</button>
          <button class="track-action remove" type="button" data-action="remove" aria-label="外す" ${appState.render.active ? "disabled" : ""}>×</button>
        </span>`;
      item.querySelector("strong").textContent = track.path;
      item.querySelector("small").textContent = status;
      elements.trackList.append(item);
    });
  }

  const totalSize = appState.tracks.reduce((sum, track) => sum + track.size, 0);
  const totalDuration = appState.tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0);
  elements.trackSummary.textContent = `${appState.tracks.length}曲 / ${formatDuration(totalDuration)} / ${formatBytes(totalSize)}`;
  elements.clearFiles.disabled = appState.tracks.length === 0 || appState.render.active;

  const previousSelection = elements.previewTrack.value || appState.previewTrackId;
  elements.previewTrack.replaceChildren();
  if (appState.tracks.length === 0) {
    elements.previewTrack.add(new Option("曲を読み込んでください", ""));
  } else {
    for (const track of appState.tracks.filter((item) => item.status !== "error")) {
      elements.previewTrack.add(new Option(track.path, track.id));
    }
    if ([...elements.previewTrack.options].some((option) => option.value === previousSelection)) {
      elements.previewTrack.value = previousSelection;
    }
  }
  updateControlAvailability();
}

function updateControlAvailability() {
  const readyTracks = appState.tracks.filter((track) => track.analysis && track.status !== "error");
  const analyzing = appState.tracks.some((track) => track.status === "analyzing");
  const enabled = readyTracks.length > 0 && !analyzing && !appState.render.active;
  elements.autoFinish.disabled = !enabled;
  elements.previewTrack.disabled = !enabled;
  elements.preparePreview.disabled = !enabled;
  elements.renderAll.disabled = !enabled;
  elements.chooseFiles.disabled = appState.render.active;
  elements.chooseFolder.disabled = appState.render.active;
  elements.addDemo.disabled = appState.render.active;
}

function updateWarnings() {
  const totalSize = appState.tracks.reduce((sum, track) => sum + track.size, 0);
  const hugeTrack = appState.tracks.find((track) => track.size > LARGE_OUTPUT_BYTES);
  const messages = [];
  if (totalSize > LARGE_OUTPUT_BYTES) {
    messages.push("読み込み量が500 MBを超えています。端末の空きメモリを確認してください。");
  }
  if (hugeTrack) messages.push(`${hugeTrack.path} は500 MBを超えています。`);
  elements.fileWarning.hidden = messages.length === 0;
  elements.fileWarning.textContent = messages.join(" ");
}

function updateRenderPlan() {
  if (!appState.albumAnalysis) return;
  appState.settings = settingsFromInputs();
  appState.renderPlan = createRenderPlan(
    appState.albumAnalysis,
    appState.settings.targetLoudness,
  );
  const plan = appState.renderPlan;
  const estimatedBytes = estimateOutputBytes(appState.tracks);
  const sizeMessage = estimatedBytes > LARGE_OUTPUT_BYTES
    ? ` 出力見込みは${formatBytes(estimatedBytes)}のため、曲ごとのダウンロードにします。`
    : ` 出力見込みは${formatBytes(estimatedBytes)}です。`;
  elements.renderMessage.textContent = plan.safetyLimited
    ? `安全優先: 共通ゲイン ${plan.sharedGainDb.toFixed(1)} dB（目標より控えめ）。${sizeMessage}`
    : `全曲共通ゲイン ${plan.sharedGainDb.toFixed(1)} dBで仕上げます。${sizeMessage}`;
}

async function analyzeTracks() {
  const pending = appState.tracks.filter((track) => !track.analysis && track.status !== "error");
  if (pending.length === 0) {
    rebuildAlbumAnalysis();
    return;
  }
  setStatus(`アルバムを一曲ずつ確認しています（0 / ${pending.length}曲）`, "working");
  updateControlAvailability();
  let finished = 0;

  for (const track of pending) {
    track.status = "analyzing";
    renderTrackList();
    try {
      const decoded = await decodeTrack(track);
      track.channels = decoded.channels.length;
      const result = await runWorker("analyze", decoded.channels, decoded.sampleRate);
      track.analysis = result.analysis;
      track.duration = result.analysis.duration;
      track.status = "ready";
    } catch (error) {
      track.status = "error";
      track.error = error instanceof Error ? error.message : String(error);
    }
    finished += 1;
    setStatus(`アルバムを一曲ずつ確認しています（${finished} / ${pending.length}曲）`, "working");
    renderTrackList();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  rebuildAlbumAnalysis();
}

function rebuildAlbumAnalysis() {
  const analyses = appState.tracks.map((track) => track.analysis).filter(Boolean);
  appState.albumAnalysis = analyses.length > 0 ? aggregateAlbumAnalyses(analyses) : null;
  clearPreview();
  if (appState.albumAnalysis) {
    updateRenderPlan();
    setStatus(
      `${analyses.length}曲の確認完了。アルバム基準は ${appState.albumAnalysis.referenceLoudness.toFixed(1)} 参考LUFSです。`,
      "success",
    );
  } else if (appState.tracks.length > 0) {
    setStatus("読み込める音声ファイルがありませんでした。", "error");
  } else {
    setStatus("食材を運び込むと、アルバムの仕込みを始めます。");
    elements.renderMessage.textContent = "音声ファイルを読み込むと仕上げを開始できます。";
  }
  renderTrackList();
}

async function addFiles(files) {
  if (appState.render.active) return;
  const additions = createTrackEntries(files);
  if (additions.length === 0) {
    setStatus("対応する音声ファイルが見つかりませんでした。", "error");
    return;
  }
  appState.tracks.push(...additions);
  resetAlbumState();
  clearDownloads();
  updateWarnings();
  renderTrackList();
  await analyzeTracks();
}

function moveTrack(trackId, direction) {
  if (appState.render.active) return;
  const index = appState.tracks.findIndex((track) => track.id === trackId);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= appState.tracks.length) return;
  [appState.tracks[index], appState.tracks[next]] = [appState.tracks[next], appState.tracks[index]];
  renderTrackList();
}

function removeTrack(trackId) {
  if (appState.render.active) return;
  appState.tracks = appState.tracks.filter((track) => track.id !== trackId);
  resetAlbumState();
  clearDownloads();
  updateWarnings();
  rebuildAlbumAnalysis();
}

function generateDemoFile(name, frequency, amplitude) {
  const duration = 2;
  const length = OUTPUT_SAMPLE_RATE * duration;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const fade = Math.min(1, index / 800, (length - index - 1) / 800);
    const transient = index % 12_000 < 500
      ? Math.exp(-(index % 12_000) / 100) * 0.22
      : 0;
    left[index] = (
      Math.sin(2 * Math.PI * frequency * index / OUTPUT_SAMPLE_RATE) * amplitude
      + transient
    ) * fade;
    right[index] = (
      Math.sin(2 * Math.PI * (frequency * 1.01) * index / OUTPUT_SAMPLE_RATE) * amplitude
      + transient
    ) * fade;
  }
  const wav = encodeWav24([left, right], OUTPUT_SAMPLE_RATE);
  const file = new File([wav], name.split("/").pop(), {
    type: "audio/wav",
    lastModified: Date.now(),
  });
  Object.defineProperty(file, "relativePath", { value: name });
  return file;
}

function resetProgress() {
  elements.albumProgress.value = 0;
  elements.trackProgress.value = 0;
  elements.albumProgressText.textContent = `0 / ${appState.tracks.length}曲`;
  elements.trackProgressText.textContent = "待機中";
}

function clearDownloads() {
  for (const url of downloadUrls) URL.revokeObjectURL(url);
  downloadUrls = [];
  elements.downloadArea.hidden = true;
  elements.downloadArea.replaceChildren();
}

function appendDownloadButton(blob, filename) {
  const url = URL.createObjectURL(blob);
  downloadUrls.push(url);
  const anchor = document.createElement("a");
  anchor.className = "counter-button accent download-button";
  anchor.href = url;
  anchor.download = filename;
  anchor.textContent = `${filename} をダウンロード`;
  elements.downloadArea.append(anchor);
}

function prepareDownloadArea(titleText, noteText = "") {
  if (elements.downloadArea.hidden) {
    elements.downloadArea.hidden = false;
    const title = document.createElement("strong");
    title.textContent = titleText;
    elements.downloadArea.append(title);
    if (noteText) {
      const note = document.createElement("p");
      note.textContent = noteText;
      elements.downloadArea.append(note);
    }
  }
}

function applyAutoFinish() {
  if (!appState.albumAnalysis) return;
  const base = copySettings(appState.selectedFinishType);
  const recommendation = recommendSettings(base, appState.albumAnalysis);
  applySettingsToInputs(recommendation.settings);
  appState.customSettings = true;
  elements.customLabel.textContent = "おまかせ調整";
  elements.autoFeedback.textContent = recommendation.reasons.join(" ");
  elements.autoFeedback.hidden = false;
  clearPreview();
  updateRenderPlan();
  setStatus("アルバムの傾向に合わせて、味付けだけを微調整しました。", "success");
}

function updateMeters(analysis, maxReductionDb) {
  elements.meterPeak.textContent = `${analysis.peakDb.toFixed(1)} dB`;
  elements.meterRms.textContent = `${analysis.rmsDb.toFixed(1)} dB`;
  elements.meterCrest.textContent = `${analysis.crestDb.toFixed(1)} dB`;
  elements.meterLufs.textContent = analysis.referenceLoudness <= -119
    ? "無音"
    : analysis.referenceLoudness.toFixed(1);
  elements.meterReduction.textContent = `${maxReductionDb.toFixed(1)} dB`;
}

async function preparePreview() {
  const trackId = elements.previewTrack.value;
  const track = appState.tracks.find((item) => item.id === trackId);
  if (!track || !appState.renderPlan) return;
  previewController.stop();
  elements.preparePreview.disabled = true;
  elements.preparePreview.textContent = "試食を仕込み中…";
  setStatus(`${track.path} の試食を仕込んでいます。`, "working");

  try {
    const decoded = await decodeTrack(track);
    const originalChannels = resampleChannels(
      decoded.channels,
      decoded.sampleRate,
      OUTPUT_SAMPLE_RATE,
    );
    const originalAnalysis = analyzeAudio(originalChannels, OUTPUT_SAMPLE_RATE);
    const result = await runWorker(
      "preview",
      decoded.channels,
      decoded.sampleRate,
      {
        settings: settingsFromInputs(),
        sharedGainDb: appState.renderPlan.sharedGainDb,
      },
    );
    const quieterRms = Math.min(originalAnalysis.rms, result.analysis.rms);
    const levelMatch = {
      original: originalAnalysis.rms > 0 ? quieterRms / originalAnalysis.rms : 1,
      finished: result.analysis.rms > 0 ? quieterRms / result.analysis.rms : 1,
    };
    appState.previewTrackId = trackId;
    appState.preview = {
      originalChannels,
      finishedChannels: result.channels,
      sampleRate: result.sampleRate,
      duration: result.analysis.duration,
      originalAnalysis,
      finishedAnalysis: result.analysis,
      maxReductionDb: result.maxReductionDb,
      levelMatch,
    };
    previewController.setData(appState.preview);
    drawWaveform(elements.waveform, originalChannels, result.channels);
    updateMeters(result.analysis, result.maxReductionDb);
    elements.playOriginal.disabled = false;
    elements.playFinished.disabled = false;
    setStatus("試食の準備ができました。原音と仕上げ後を切り替えて確認できます。", "success");
  } catch (error) {
    clearPreview();
    setStatus(
      `試食を仕込めませんでした: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
  } finally {
    elements.preparePreview.textContent = "試食を仕込む";
    updateControlAvailability();
  }
}

async function renderAllTracks() {
  const tracks = appState.tracks.filter((track) => track.analysis && track.status !== "error");
  if (tracks.length === 0 || !appState.renderPlan) return;
  previewController.stop();
  appState.render.active = true;
  appState.render.cancelled = false;
  appState.render.results = [];
  appState.render.individualMode = shouldUseIndividualDownloads(appState.tracks);
  updateControlAvailability();
  renderTrackList();
  resetProgress();
  clearDownloads();
  elements.cancelRender.hidden = false;
  setStatus("全曲を一曲ずつ仕上げています。", "working");

  const outputPaths = resolveOutputPaths(tracks);
  if (appState.render.individualMode) {
    prepareDownloadArea(
      "一曲ずつ受け取ってください",
      "大容量のためZIPを作らず、完成した曲から個別に用意します。",
    );
  }

  try {
    for (let index = 0; index < tracks.length; index += 1) {
      if (appState.render.cancelled) throw new Error("cancelled");
      const track = tracks[index];
      elements.albumProgressText.textContent = `${index} / ${tracks.length}曲`;
      elements.trackProgressText.textContent = track.path;
      elements.trackProgress.value = 0;
      const decoded = await decodeTrack(track);
      const result = await runWorker(
        "process",
        decoded.channels,
        decoded.sampleRate,
        {
          settings: settingsFromInputs(),
          sharedGainDb: appState.renderPlan.sharedGainDb,
        },
        (progress) => {
          elements.trackProgress.value = progress;
        },
      );
      if (appState.render.cancelled) throw new Error("cancelled");
      const rendered = {
        outputPath: outputPaths[index],
        wav: result.wav,
        analysis: result.analysis,
        maxReductionDb: result.maxReductionDb,
      };
      if (appState.render.individualMode) {
        appendDownloadButton(
          new Blob([result.wav], { type: "audio/wav" }),
          rendered.outputPath.split("/").pop(),
        );
      } else {
        appState.render.results.push(rendered);
      }
      elements.albumProgress.value = (index + 1) / tracks.length;
      elements.albumProgressText.textContent = `${index + 1} / ${tracks.length}曲`;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (!appState.render.individualMode && appState.render.results.length === 1) {
      const result = appState.render.results[0];
      const filename = result.outputPath.split("/").pop();
      const blob = new Blob([result.wav], { type: "audio/wav" });
      prepareDownloadArea("仕上がりました");
      appendDownloadButton(blob, filename);
      triggerDownload(blob, filename);
    } else if (!appState.render.individualMode) {
      elements.trackProgressText.textContent = "ZIPを盛り付け中";
      const zipBlob = await createZip(appState.render.results, (progress, currentFile) => {
        elements.trackProgress.value = progress;
        elements.trackProgressText.textContent = currentFile ? `ZIP: ${currentFile}` : "ZIPを盛り付け中";
      });
      prepareDownloadArea("仕上がりました");
      appendDownloadButton(zipBlob, "mastered.zip");
      triggerDownload(zipBlob, "mastered.zip");
    }
    elements.trackProgress.value = 1;
    elements.trackProgressText.textContent = "完了";
    setStatus("アルバムの仕上げが完了しました。", "success");
  } catch (error) {
    if (appState.render.cancelled || error?.message === "cancelled") {
      elements.trackProgressText.textContent = "中止";
      setStatus("仕上げを中止しました。設定を変えて、もう一度始められます。", "warning");
    } else {
      setStatus(
        `仕上げに失敗しました: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      restartDspWorker("音声処理を立て直しました。");
    }
  } finally {
    appState.render.active = false;
    elements.cancelRender.hidden = true;
    updateControlAvailability();
    renderTrackList();
  }
}

function cancelRender() {
  if (!appState.render.active) return;
  appState.render.cancelled = true;
  elements.cancelRender.disabled = true;
  restartDspWorker();
  setTimeout(() => {
    elements.cancelRender.disabled = false;
  }, 0);
}

elements.finishTypes.addEventListener("click", (event) => {
  const button = event.target.closest("[data-finish-type]");
  if (button) selectFinishType(button.dataset.finishType);
});
elements.finishTypes.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...elements.finishTypes.querySelectorAll("[data-finish-type]")];
  const current = buttons.indexOf(document.activeElement);
  const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
  const next = (current + direction + buttons.length) % buttons.length;
  buttons[next].focus();
  selectFinishType(buttons[next].dataset.finishType);
});

for (const input of Object.values(settingInputs)) {
  input.addEventListener("input", () => {
    if (input.type === "range") updateRangeOutput(input);
    markCustomSettings();
  });
}

elements.chooseFiles.addEventListener("click", (event) => {
  event.stopPropagation();
  elements.fileInput.click();
});
elements.chooseFolder.addEventListener("click", (event) => {
  event.stopPropagation();
  elements.folderInput.click();
});
elements.addDemo.addEventListener("click", async (event) => {
  event.stopPropagation();
  await addFiles([
    generateDemoFile("Demo/01_gentle.wav", 220, 0.12),
    generateDemoFile("Demo/02_loud.wav", 330, 0.36),
  ]);
});
elements.fileInput.addEventListener("change", async () => {
  await addFiles(elements.fileInput.files);
  elements.fileInput.value = "";
});
elements.folderInput.addEventListener("change", async () => {
  await addFiles(elements.folderInput.files);
  elements.folderInput.value = "";
});
elements.dropZone.addEventListener("click", () => {
  if (!appState.render.active) elements.fileInput.click();
});
for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!appState.render.active) elements.dropZone.classList.add("drag-over");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("drag-over");
  });
}
elements.dropZone.addEventListener("drop", async (event) => {
  if (appState.render.active) return;
  try {
    await addFiles(await collectDroppedFiles(event.dataTransfer));
  } catch (error) {
    setStatus(
      `フォルダを読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
  }
});
elements.clearFiles.addEventListener("click", () => {
  if (appState.render.active) return;
  appState.tracks = [];
  resetAlbumState();
  clearDownloads();
  updateWarnings();
  rebuildAlbumAnalysis();
  resetProgress();
});
elements.trackList.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]");
  const item = event.target.closest("[data-track-id]");
  if (!action || !item) return;
  if (action.dataset.action === "remove") removeTrack(item.dataset.trackId);
  if (action.dataset.action === "up") moveTrack(item.dataset.trackId, -1);
  if (action.dataset.action === "down") moveTrack(item.dataset.trackId, 1);
});
elements.autoFinish.addEventListener("click", applyAutoFinish);
elements.previewTrack.addEventListener("change", clearPreview);
elements.preparePreview.addEventListener("click", preparePreview);
elements.playOriginal.addEventListener("click", () => {
  previewController.play("original", elements.levelMatch.checked);
});
elements.playFinished.addEventListener("click", () => {
  previewController.play("finished", elements.levelMatch.checked);
});
elements.stopPreview.addEventListener("click", () => {
  previewController.stop();
});
elements.renderAll.addEventListener("click", renderAllTracks);
elements.cancelRender.addEventListener("click", cancelRender);
window.addEventListener("resize", () => {
  if (appState.preview) {
    drawWaveform(
      elements.waveform,
      appState.preview.originalChannels,
      appState.preview.finishedChannels,
    );
  } else {
    drawWaveform(elements.waveform);
  }
});

selectFinishType("streaming");
renderTrackList();
resetProgress();
clearPreview();
