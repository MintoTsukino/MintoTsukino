function coefficients(type, sampleRate, frequency, q = Math.SQRT1_2, gainDb = 0) {
  const omega = 2 * Math.PI * frequency / sampleRate;
  const sine = Math.sin(omega);
  const cosine = Math.cos(omega);
  const alpha = sine / (2 * q);
  const amplitude = 10 ** (gainDb / 40);
  let b0;
  let b1;
  let b2;
  let a0;
  let a1;
  let a2;

  if (type === "highpass") {
    b0 = (1 + cosine) / 2;
    b1 = -(1 + cosine);
    b2 = (1 + cosine) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosine;
    a2 = 1 - alpha;
  } else if (type === "lowshelf") {
    const root = 2 * Math.sqrt(amplitude) * alpha;
    b0 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosine + root);
    b1 = 2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cosine);
    b2 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosine - root);
    a0 = (amplitude + 1) + (amplitude - 1) * cosine + root;
    a1 = -2 * ((amplitude - 1) + (amplitude + 1) * cosine);
    a2 = (amplitude + 1) + (amplitude - 1) * cosine - root;
  } else {
    b0 = 1 + alpha * amplitude;
    b1 = -2 * cosine;
    b2 = 1 - alpha * amplitude;
    a0 = 1 + alpha / amplitude;
    a1 = -2 * cosine;
    a2 = 1 - alpha / amplitude;
  }
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

export function applyBiquad(channel, type, sampleRate, frequency, q, gainDb = 0) {
  const c = coefficients(type, sampleRate, frequency, q, gainDb);
  const output = new Float32Array(channel.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < channel.length; i += 1) {
    const x0 = Number.isFinite(channel[i]) ? channel[i] : 0;
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    output[i] = Number.isFinite(y0) ? y0 : 0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return output;
}
