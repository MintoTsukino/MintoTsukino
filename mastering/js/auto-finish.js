function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function adjust(base, delta) {
  return clamp(base + Math.max(-15, Math.min(15, delta)), 0, 100);
}

export function recommendSettings(baseSettings, albumAnalysis) {
  const settings = { ...baseSettings };
  const reasons = [];

  if (albumAnalysis.lowRatio > 0.58) {
    settings.lowCleanup = adjust(baseSettings.lowCleanup, 12);
    reasons.push("低い帯域が多めなので、濁りの整理を少し強めました。");
  } else if (albumAnalysis.lowRatio < 0.32) {
    settings.lowCleanup = adjust(baseSettings.lowCleanup, -7);
    reasons.push("低い帯域が軽めなので、痩せないよう整理を控えました。");
  }

  if (albumAnalysis.presenceRatio < 0.16) {
    settings.clarity = adjust(baseSettings.clarity, 10);
    reasons.push("輪郭が奥に見えるため、明瞭感を少し足しました。");
  } else if (albumAnalysis.presenceRatio > 0.34) {
    settings.clarity = adjust(baseSettings.clarity, -8);
    reasons.push("中高域が十分に前へ出ているため、明瞭感を控えました。");
  }

  if (albumAnalysis.highRatio > 0.24) {
    settings.deharsh = adjust(baseSettings.deharsh, 13);
    reasons.push("高い帯域が強めなので、刺さりの抑えを深くしました。");
  } else {
    settings.deharsh = adjust(baseSettings.deharsh, -4);
  }

  if (albumAnalysis.crestDb < 8) {
    settings.punch = adjust(baseSettings.punch, 10);
    reasons.push("音の起伏が小さめなので、立ち上がりを少し前へ出しました。");
  } else if (albumAnalysis.crestDb > 15) {
    settings.punch = adjust(baseSettings.punch, -9);
    reasons.push("立ち上がりが十分にあるため、弾き出しを控えました。");
  }

  if (albumAnalysis.correlation < 0.15) {
    settings.stereoWidth = adjust(baseSettings.stereoWidth, -15);
    reasons.push("左右の広がりが不安定なので、ステレオ感を安全側へ寄せました。");
  } else if (albumAnalysis.sideRatio < 0.08 && albumAnalysis.correlation > 0.7) {
    settings.stereoWidth = adjust(baseSettings.stereoWidth, 10);
    reasons.push("中央に集まっているため、広がりを少し足しました。");
  }

  if (reasons.length === 0) {
    reasons.push("大きな偏りがないため、選んだ仕上げタイプをほぼそのまま使います。");
  }

  return { settings, reasons };
}
