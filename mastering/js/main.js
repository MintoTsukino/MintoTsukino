import { aggregateAlbumAnalyses, createRenderPlan } from "./album-analysis.js";
import { createZip, triggerDownload } from "./export.js";
import { copySettings, FINISH_TYPES } from "./finish-types.js";
import {
  collectDroppedFiles,
  createTrackEntries,
  resolveOutputPaths,
} from "./files.js";
import { appState, resetAlbumState } from "./state.js";
import { encodeWav24 } from "./workers/wav-encoder.js";

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
  previewTrack: document.querySelector("#preview-track"),
  preparePreview: document.querySelector("#prepare-preview"),
  renderAll: document.querySelector("#render-all"),
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
let lastDownload = null;

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
    for (const request of workerRequests.values()) request.reject(new Error(event.message));
    workerRequests.clear();
  });
  return worker;
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
    audioContext = new Context({ sampleRate: 48_000 });
  }
  return audioContext;
}

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

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
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

function selectFinishType(typeId) {
  appState.selectedFinishType = typeId;
  appState.customSettings = false;
  applySettingsToInputs(copySettings(typeId));
  const type = FINISH_TYPES[typeId];
  elements.customLabel.textContent = type.label;
  for (const button of elements.finishTypes.querySelectorAll("[data-finish-type]")) {
    const selected = button.dataset.finishType === typeId;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", String(selected));
  }
  if (appState.albumAnalysis) updateRenderPlan();
}

function markCustomSettings() {
  appState.customSettings = true;
  appState.settings = settingsFromInputs();
  elements.customLabel.textContent = "カスタム";
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
          <button class="track-action" type="button" data-action="up" aria-label="上へ移動" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="track-action" type="button" data-action="down" aria-label="下へ移動" ${index === appState.tracks.length - 1 ? "disabled" : ""}>↓</button>
          <button class="track-action remove" type="button" data-action="remove" aria-label="外す">×</button>
        </span>`;
      item.querySelector("strong").textContent = track.path;
      item.querySelector("small").textContent = status;
      elements.trackList.append(item);
    });
  }

  const totalSize = appState.tracks.reduce((sum, track) => sum + track.size, 0);
  const totalDuration = appState.tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0);
  elements.trackSummary.textContent = `${appState.tracks.length}曲 / ${formatDuration(totalDuration)} / ${formatBytes(totalSize)}`;
  elements.clearFiles.disabled = appState.tracks.length === 0;

  elements.previewTrack.replaceChildren();
  if (appState.tracks.length === 0) {
    elements.previewTrack.add(new Option("曲を読み込んでください", ""));
  } else {
    for (const track of appState.tracks.filter((item) => item.status !== "error")) {
      elements.previewTrack.add(new Option(track.path, track.id));
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
}

function updateWarnings() {
  const totalSize = appState.tracks.reduce((sum, track) => sum + track.size, 0);
  const hugeTrack = appState.tracks.find((track) => track.size > 500_000_000);
  const messages = [];
  if (totalSize > 500_000_000) messages.push("元ファイルの合計が500 MBを超えています。曲数を分けると安定します。");
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
  elements.renderMessage.textContent = plan.safetyLimited
    ? `安全優先：共通ゲイン ${plan.sharedGainDb.toFixed(1)} dB（目標より控えめ）`
    : `全曲共通ゲイン ${plan.sharedGainDb.toFixed(1)} dBで仕上げます。`;
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
  }
  renderTrackList();
}

async function addFiles(files) {
  const additions = createTrackEntries(files);
  if (additions.length === 0) {
    setStatus("対応する音声ファイルが見つかりませんでした。", "error");
    return;
  }
  appState.tracks.push(...additions);
  resetAlbumState();
  updateWarnings();
  renderTrackList();
  await analyzeTracks();
}

function moveTrack(trackId, direction) {
  const index = appState.tracks.findIndex((track) => track.id === trackId);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= appState.tracks.length) return;
  [appState.tracks[index], appState.tracks[next]] = [appState.tracks[next], appState.tracks[index]];
  renderTrackList();
}

function removeTrack(trackId) {
  appState.tracks = appState.tracks.filter((track) => track.id !== trackId);
  resetAlbumState();
  updateWarnings();
  rebuildAlbumAnalysis();
}

function generateDemoFile(name, frequency, amplitude) {
  const sampleRate = 48_000;
  const duration = 2;
  const length = sampleRate * duration;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const fade = Math.min(1, i / 800, (length - i - 1) / 800);
    const transient = i % 12_000 < 500 ? Math.exp(-(i % 12_000) / 100) * 0.22 : 0;
    left[i] = (Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude + transient) * fade;
    right[i] = (Math.sin(2 * Math.PI * (frequency * 1.01) * i / sampleRate) * amplitude + transient) * fade;
  }
  const wav = encodeWav24([left, right], sampleRate);
  return new File([wav], name, { type: "audio/wav", lastModified: Date.now() });
}

function resetProgress() {
  elements.albumProgress.value = 0;
  elements.trackProgress.value = 0;
  elements.albumProgressText.textContent = `0 / ${appState.tracks.length}曲`;
  elements.trackProgressText.textContent = "待機中";
}

function offerDownload(blob, filename) {
  if (lastDownload?.url) URL.revokeObjectURL(lastDownload.url);
  const url = URL.createObjectURL(blob);
  lastDownload = { blob, filename, url };
  elements.downloadArea.hidden = false;
  elements.downloadArea.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = "仕上がりました";
  const button = document.createElement("button");
  button.className = "counter-button accent";
  button.type = "button";
  button.textContent = `${filename} をダウンロード`;
  button.addEventListener("click", () => triggerDownload(blob, filename));
  elements.downloadArea.append(title, button);
}

async function renderAllTracks() {
  const tracks = appState.tracks.filter((track) => track.analysis && track.status !== "error");
  if (tracks.length === 0 || !appState.renderPlan) return;
  appState.render.active = true;
  appState.render.results = [];
  updateControlAvailability();
  resetProgress();
  elements.downloadArea.hidden = true;
  setStatus("全曲を一曲ずつ仕上げています。", "working");

  const outputPaths = resolveOutputPaths(tracks);
  try {
    for (let index = 0; index < tracks.length; index += 1) {
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
      appState.render.results.push({
        outputPath: outputPaths[index],
        wav: result.wav,
        analysis: result.analysis,
        maxReductionDb: result.maxReductionDb,
      });
      elements.albumProgress.value = (index + 1) / tracks.length;
      elements.albumProgressText.textContent = `${index + 1} / ${tracks.length}曲`;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (appState.render.results.length === 1) {
      const result = appState.render.results[0];
      const blob = new Blob([result.wav], { type: "audio/wav" });
      offerDownload(blob, result.outputPath.split("/").pop());
      triggerDownload(blob, result.outputPath.split("/").pop());
    } else {
      elements.trackProgressText.textContent = "ZIPを盛り付け中";
      const zipBlob = await createZip(appState.render.results, (progress, currentFile) => {
        elements.trackProgress.value = progress;
        elements.trackProgressText.textContent = currentFile ? `ZIP: ${currentFile}` : "ZIPを盛り付け中";
      });
      offerDownload(zipBlob, "mastered.zip");
      triggerDownload(zipBlob, "mastered.zip");
    }
    elements.trackProgress.value = 1;
    elements.trackProgressText.textContent = "完了";
    setStatus("アルバムの仕上げが完了しました。", "success");
  } catch (error) {
    setStatus(`仕上げに失敗しました: ${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    appState.render.active = false;
    updateControlAvailability();
  }
}

elements.finishTypes.addEventListener("click", (event) => {
  const button = event.target.closest("[data-finish-type]");
  if (button) selectFinishType(button.dataset.finishType);
});

for (const input of Object.values(settingInputs)) {
  input.addEventListener("input", () => {
    if (input.type === "range") updateRangeOutput(input);
    markCustomSettings();
  });
  input.addEventListener("change", markCustomSettings);
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
elements.dropZone.addEventListener("click", () => elements.fileInput.click());
for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("drag-over");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("drag-over");
  });
}
elements.dropZone.addEventListener("drop", async (event) => {
  try {
    await addFiles(await collectDroppedFiles(event.dataTransfer));
  } catch (error) {
    setStatus(`フォルダを読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
});
elements.clearFiles.addEventListener("click", () => {
  appState.tracks = [];
  resetAlbumState();
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
elements.renderAll.addEventListener("click", renderAllTracks);

selectFinishType("streaming");
renderTrackList();
resetProgress();
