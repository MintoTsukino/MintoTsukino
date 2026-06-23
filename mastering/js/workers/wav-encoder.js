export function encodeWav24(channels, sampleRate = 48_000) {
  const channelCount = channels.length;
  const length = channels[0]?.length ?? 0;
  if (channelCount < 1 || channelCount > 2) throw new Error("WAV出力はモノまたはステレオに対応しています。");
  if (channels.some((channel) => channel.length !== length)) throw new Error("チャンネル長が一致しません。");
  const bytesPerSample = 3;
  const dataSize = length * channelCount * bytesPerSample;
  if (dataSize + 44 > 0xffff_ffff) throw new Error("WAVのサイズ上限を超えます。");
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 24, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < length; i += 1) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const source = Number.isFinite(channels[channelIndex][i]) ? channels[channelIndex][i] : 0;
      const sample = Math.max(-1, Math.min(1 - 1 / 8_388_608, source));
      const integer = sample < 0
        ? Math.round(sample * 8_388_608)
        : Math.round(sample * 8_388_607);
      view.setUint8(offset, integer & 0xff);
      view.setUint8(offset + 1, (integer >> 8) & 0xff);
      view.setUint8(offset + 2, (integer >> 16) & 0xff);
      offset += 3;
    }
  }
  return buffer;
}

export function inspectWav24(buffer) {
  const view = new DataView(buffer);
  const text = (offset, length) => String.fromCharCode(
    ...new Uint8Array(buffer, offset, length),
  );
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") throw new Error("WAVヘッダーが不正です。");
  const channelCount = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataSize = view.getUint32(40, true);
  return {
    channelCount,
    sampleRate,
    bitsPerSample,
    dataSize,
    sampleFrames: dataSize / (channelCount * (bitsPerSample / 8)),
  };
}
