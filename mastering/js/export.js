export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function createZip(results, onProgress = () => {}) {
  if (!window.JSZip) throw new Error("ZIP機能を読み込めませんでした。");
  const zip = new window.JSZip();
  for (const result of results) {
    zip.file(result.outputPath, result.wav, {
      binary: true,
      compression: "STORE",
    });
  }
  return zip.generateAsync({
    type: "blob",
    compression: "STORE",
    streamFiles: true,
  }, ({ percent, currentFile }) => onProgress(percent / 100, currentFile));
}
