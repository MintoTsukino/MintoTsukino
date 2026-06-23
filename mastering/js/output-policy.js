export const LARGE_OUTPUT_BYTES = 500_000_000;

export function estimateOutputBytes(tracks, sampleRate = 48_000) {
  return tracks.reduce((sum, track) => {
    const channels = Math.max(1, Math.min(2, track.channels ?? 2));
    return sum + Math.ceil((track.duration ?? 0) * sampleRate * channels * 3 + 44);
  }, 0);
}

export function shouldUseIndividualDownloads(tracks) {
  return estimateOutputBytes(tracks) > LARGE_OUTPUT_BYTES;
}
