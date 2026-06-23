function cloneChannels(channels) {
  return channels.map((channel) => new Float32Array(channel));
}

function stereoCorrelation(left, right) {
  let numerator = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = 0; index < left.length; index += 1) {
    numerator += left[index] * right[index];
    leftEnergy += left[index] * left[index];
    rightEnergy += right[index] * right[index];
  }
  return numerator / (Math.sqrt(leftEnergy * rightEnergy) + 1e-12);
}

function processWidth(left, right, sampleRate, widthFactor, lowSideFactor) {
  const outputLeft = new Float32Array(left.length);
  const outputRight = new Float32Array(right.length);
  const lowCoefficient = Math.exp(-2 * Math.PI * 120 / sampleRate);
  let lowSide = 0;

  for (let index = 0; index < left.length; index += 1) {
    const safeLeft = Number.isFinite(left[index]) ? left[index] : 0;
    const safeRight = Number.isFinite(right[index]) ? right[index] : 0;
    const mid = (safeLeft + safeRight) * 0.5;
    const side = (safeLeft - safeRight) * 0.5;
    lowSide = lowCoefficient * lowSide + (1 - lowCoefficient) * side;
    const highSide = side - lowSide;
    const shapedSide = lowSide * lowSideFactor + highSide * widthFactor;
    outputLeft[index] = mid + shapedSide;
    outputRight[index] = mid - shapedSide;
  }

  return [outputLeft, outputRight];
}

export function applyStereoWidth(channels, sampleRate, amount = 50) {
  if (channels.length < 2 || amount === 50) return cloneChannels(channels);

  const normalized = Math.max(0, Math.min(1, amount / 100));
  let widthFactor = normalized <= 0.5
    ? normalized * 2
    : 1 + (normalized - 0.5) * 0.7;
  const inputCorrelation = stereoCorrelation(channels[0], channels[1]);
  if (inputCorrelation < 0.2 && widthFactor > 1) {
    widthFactor = 1 + (widthFactor - 1) * Math.max(0, (inputCorrelation + 0.2) / 0.4);
  }

  let lowSideFactor = widthFactor <= 1 ? widthFactor : 0.35;
  let [left, right] = processWidth(
    channels[0],
    channels[1],
    sampleRate,
    widthFactor,
    lowSideFactor,
  );

  let correlation = stereoCorrelation(left, right);
  if (correlation < 0) {
    const safety = Math.max(0, Math.min(1, 1 + correlation));
    widthFactor *= safety;
    lowSideFactor *= safety;
    [left, right] = processWidth(
      channels[0],
      channels[1],
      sampleRate,
      widthFactor,
      lowSideFactor,
    );
    correlation = stereoCorrelation(left, right);
  }

  return [
    left,
    right,
    ...channels.slice(2).map((channel) => new Float32Array(channel)),
  ];
}
