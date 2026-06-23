const EPSILON = 1e-12;
const ACTIVE_BLOCK_THRESHOLD = 1e-7;

export function gainToDb(gain) {
  return gain > EPSILON ? 20 * Math.log10(gain) : -120;
}

export function dbToGain(db) {
  return 10 ** (db / 20);
}

export function resampleChannels(channels, sourceRate, targetRate = 48_000) {
  if (sourceRate === targetRate) return channels.map((channel) => new Float32Array(channel));
  const sourceLength = channels[0]?.length ?? 0;
  const targetLength = Math.max(1, Math.round(sourceLength * targetRate / sourceRate));
  return channels.map((channel) => {
    const output = new Float32Array(targetLength);
    const ratio = sourceRate / targetRate;
    for (let i = 0; i < targetLength; i += 1) {
      const position = i * ratio;
      const index = Math.min(channel.length - 1, Math.floor(position));
      const next = Math.min(channel.length - 1, index + 1);
      const fraction = position - index;
      output[i] = channel[index] + (channel[next] - channel[index]) * fraction;
    }
    return output;
  });
}

export function analyzeAudio(channels, sampleRate) {
  const channelCount = channels.length;
  const length = channels[0]?.length ?? 0;
  if (channelCount === 0 || length === 0) {
    return {
      sampleRate,
      channelCount,
      length,
      duration: 0,
      peak: 0,
      peakDb: -120,
      rms: 0,
      rmsDb: -120,
      crestDb: 0,
      referenceLoudness: -120,
      activeEnergySum: 0,
      activeBlockCount: 0,
      lowRatio: 0,
      presenceRatio: 0,
      highRatio: 0,
      sideRatio: 0,
      correlation: 1,
      clippedRatio: 0,
    };
  }

  let peak = 0;
  let energySum = 0;
  let clipped = 0;
  let sideEnergy = 0;
  let midEnergy = 0;
  let correlationNumerator = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  let lowState = 0;
  let presenceState = 0;
  let lowEnergy = 0;
  let presenceEnergy = 0;
  let highEnergy = 0;
  const lowCoeff = Math.exp(-2 * Math.PI * 200 / sampleRate);
  const presenceCoeff = Math.exp(-2 * Math.PI * 4_000 / sampleRate);
  const blockSize = Math.max(1, Math.round(sampleRate * 0.4));
  let blockEnergy = 0;
  let blockSamples = 0;
  let activeEnergySum = 0;
  let activeBlockCount = 0;

  for (let i = 0; i < length; i += 1) {
    let mono = 0;
    let frameEnergy = 0;
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const sample = Number.isFinite(channels[channelIndex][i]) ? channels[channelIndex][i] : 0;
      const magnitude = Math.abs(sample);
      peak = Math.max(peak, magnitude);
      if (magnitude >= 0.9999) clipped += 1;
      frameEnergy += sample * sample;
      mono += sample;
    }
    mono /= channelCount;
    energySum += frameEnergy;
    blockEnergy += frameEnergy;
    blockSamples += channelCount;

    lowState = lowCoeff * lowState + (1 - lowCoeff) * mono;
    presenceState = presenceCoeff * presenceState + (1 - presenceCoeff) * mono;
    const presenceBand = presenceState - lowState;
    const highBand = mono - presenceState;
    lowEnergy += lowState * lowState;
    presenceEnergy += presenceBand * presenceBand;
    highEnergy += highBand * highBand;

    if (channelCount >= 2) {
      const left = channels[0][i];
      const right = channels[1][i];
      const mid = (left + right) * 0.5;
      const side = (left - right) * 0.5;
      midEnergy += mid * mid;
      sideEnergy += side * side;
      correlationNumerator += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }

    if ((i + 1) % blockSize === 0 || i === length - 1) {
      const average = blockEnergy / Math.max(1, blockSamples);
      if (average > ACTIVE_BLOCK_THRESHOLD) {
        activeEnergySum += average;
        activeBlockCount += 1;
      }
      blockEnergy = 0;
      blockSamples = 0;
    }
  }

  const totalSamples = length * channelCount;
  const meanEnergy = energySum / Math.max(1, totalSamples);
  const rms = Math.sqrt(meanEnergy);
  const activeMean = activeEnergySum / Math.max(1, activeBlockCount);
  const spectralTotal = lowEnergy + presenceEnergy + highEnergy + EPSILON;
  const stereoTotal = midEnergy + sideEnergy + EPSILON;
  const correlationDenominator = Math.sqrt(leftEnergy * rightEnergy) + EPSILON;

  return {
    sampleRate,
    channelCount,
    length,
    duration: length / sampleRate,
    peak,
    peakDb: gainToDb(peak),
    rms,
    rmsDb: gainToDb(rms),
    crestDb: Math.max(0, gainToDb(peak) - gainToDb(rms)),
    referenceLoudness: activeBlockCount > 0 ? -0.691 + 10 * Math.log10(activeMean) : -120,
    activeEnergySum,
    activeBlockCount,
    lowRatio: lowEnergy / spectralTotal,
    presenceRatio: presenceEnergy / spectralTotal,
    highRatio: highEnergy / spectralTotal,
    sideRatio: sideEnergy / stereoTotal,
    correlation: channelCount >= 2 ? correlationNumerator / correlationDenominator : 1,
    clippedRatio: clipped / Math.max(1, totalSamples),
  };
}

export function aggregateAlbumAnalyses(analyses) {
  const valid = analyses.filter(Boolean);
  const activeEnergySum = valid.reduce((sum, item) => sum + item.activeEnergySum, 0);
  const activeBlockCount = valid.reduce((sum, item) => sum + item.activeBlockCount, 0);
  const totalLength = valid.reduce((sum, item) => sum + item.length, 0);
  const weighted = (property) => valid.reduce(
    (sum, item) => sum + item[property] * item.length,
    0,
  ) / Math.max(1, totalLength);
  const activeMean = activeEnergySum / Math.max(1, activeBlockCount);
  return {
    trackCount: valid.length,
    duration: valid.reduce((sum, item) => sum + item.duration, 0),
    peak: valid.reduce((peak, item) => Math.max(peak, item.peak), 0),
    peakDb: valid.reduce((peak, item) => Math.max(peak, item.peakDb), -120),
    referenceLoudness: activeBlockCount > 0 ? -0.691 + 10 * Math.log10(activeMean) : -120,
    activeEnergySum,
    activeBlockCount,
    lowRatio: weighted("lowRatio"),
    presenceRatio: weighted("presenceRatio"),
    highRatio: weighted("highRatio"),
    sideRatio: weighted("sideRatio"),
    correlation: weighted("correlation"),
    clippedRatio: weighted("clippedRatio"),
    crestDb: weighted("crestDb"),
  };
}

export function createRenderPlan(albumAnalysis, targetLoudness, options = {}) {
  const ceilingDb = options.ceilingDb ?? -1;
  const maxReductionDb = options.maxReductionDb ?? 3;
  const desiredGainDb = targetLoudness - albumAnalysis.referenceLoudness;
  const safeGainDb = ceilingDb + maxReductionDb - albumAnalysis.peakDb;
  const sharedGainDb = Math.min(desiredGainDb, safeGainDb);
  return {
    targetLoudness,
    desiredGainDb,
    safeGainDb,
    sharedGainDb,
    safetyLimited: sharedGainDb < desiredGainDb - 0.01,
    predictedReductionDb: Math.max(0, albumAnalysis.peakDb + sharedGainDb - ceilingDb),
    ceilingDb,
  };
}
