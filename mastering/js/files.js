const AUDIO_EXTENSIONS = new Set(["wav", "mp3", "m4a", "aac", "flac", "ogg"]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

export function hasSupportedExtension(name) {
  const extension = name.split(".").pop()?.toLowerCase();
  return AUDIO_EXTENSIONS.has(extension ?? "");
}

export function sanitizeRelativePath(input) {
  const normalized = String(input ?? "")
    .replaceAll("\\", "/")
    .replace(CONTROL_CHARACTERS, "")
    .replace(/^[a-zA-Z]:/, "")
    .replace(/^\/+/, "");
  const safeParts = normalized
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.replace(/[<>:"|?*]/g, "_").trim() || "untitled");
  return safeParts.join("/") || "untitled";
}

export function naturalCompare(left, right) {
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function stripExtension(path) {
  return path.replace(/\.[^.\/]+$/, "");
}

export function createTrackEntries(files) {
  return [...files]
    .filter((file) => hasSupportedExtension(file.name))
    .map((file, index) => {
      const relativePath = sanitizeRelativePath(file.webkitRelativePath || file.relativePath || file.name);
      return {
        id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
        file,
        path: relativePath,
        name: file.name,
        size: file.size,
        duration: null,
        channels: null,
        analysis: null,
        status: "pending",
        error: null,
      };
    })
    .sort((a, b) => naturalCompare(a.path, b.path));
}

export function outputPathForTrack(track) {
  return `${stripExtension(sanitizeRelativePath(track.path))}_mastered.wav`;
}

export function resolveOutputPaths(tracks) {
  const used = new Map();
  return tracks.map((track) => {
    const original = outputPathForTrack(track);
    const count = used.get(original.toLowerCase()) ?? 0;
    used.set(original.toLowerCase(), count + 1);
    if (count === 0) return original;
    return `${stripExtension(original)}_${count + 1}.wav`;
  });
}

function readFileEntry(entry, relativePath) {
  return new Promise((resolve, reject) => {
    entry.file((file) => {
      Object.defineProperty(file, "relativePath", {
        configurable: true,
        value: sanitizeRelativePath(`${relativePath}/${file.name}`),
      });
      resolve([file]);
    }, reject);
  });
}

async function readDirectoryEntry(entry, relativePath) {
  const reader = entry.createReader();
  const entries = [];
  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    entries.push(...batch);
  }
  const collected = [];
  for (const child of entries) {
    const childPath = `${relativePath}/${entry.name}`.replace(/^\/+/, "");
    collected.push(...await walkEntry(child, childPath));
  }
  return collected;
}

async function walkEntry(entry, relativePath = "") {
  if (entry.isFile) return readFileEntry(entry, relativePath);
  if (entry.isDirectory) return readDirectoryEntry(entry, relativePath);
  return [];
}

export async function collectDroppedFiles(dataTransfer) {
  const items = [...(dataTransfer.items ?? [])];
  const entryItems = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);
  if (entryItems.length > 0) {
    const files = [];
    for (const entry of entryItems) files.push(...await walkEntry(entry));
    return files.filter((file) => hasSupportedExtension(file.name));
  }
  return [...(dataTransfer.files ?? [])].filter((file) => hasSupportedExtension(file.name));
}
