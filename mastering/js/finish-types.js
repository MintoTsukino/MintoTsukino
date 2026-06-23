export const FINISH_TYPES = Object.freeze({
  natural: Object.freeze({
    label: "そのまま整える",
    targetLoudness: -14,
    lowCleanup: 25,
    clarity: 40,
    deharsh: 45,
    punch: 40,
    stereoWidth: 50,
    peakSafe: true,
  }),
  streaming: Object.freeze({
    label: "配信バランス",
    targetLoudness: -14,
    lowCleanup: 40,
    clarity: 55,
    deharsh: 60,
    punch: 50,
    stereoWidth: 55,
    peakSafe: true,
  }),
  loud: Object.freeze({
    label: "音圧寄り",
    targetLoudness: -10,
    lowCleanup: 40,
    clarity: 60,
    deharsh: 65,
    punch: 65,
    stereoWidth: 60,
    peakSafe: true,
  }),
  vocal: Object.freeze({
    label: "歌を前へ",
    targetLoudness: -14,
    lowCleanup: 45,
    clarity: 70,
    deharsh: 70,
    punch: 45,
    stereoWidth: 40,
    peakSafe: true,
  }),
  bgm: Object.freeze({
    label: "やわらかBGM",
    targetLoudness: -18,
    lowCleanup: 25,
    clarity: 35,
    deharsh: 55,
    punch: 25,
    stereoWidth: 55,
    peakSafe: true,
  }),
});

export function getFinishType(id) {
  return FINISH_TYPES[id] ?? FINISH_TYPES.streaming;
}

export function copySettings(typeId = "streaming") {
  const { label: _label, ...settings } = getFinishType(typeId);
  return { ...settings };
}
