function channelPeakAt(channels, start, end) {
  let peak = 0;
  for (const channel of channels) {
    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, Math.abs(channel[index] ?? 0));
    }
  }
  return peak;
}

function drawSeries(context, channels, width, height, color, lineWidth) {
  if (!channels?.length || !channels[0]?.length) return;
  const center = height * 0.5;
  const samplesPerPixel = Math.max(1, Math.ceil(channels[0].length / width));
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.beginPath();
  for (let x = 0; x < width; x += 1) {
    const start = x * samplesPerPixel;
    const end = Math.min(channels[0].length, start + samplesPerPixel);
    const peak = channelPeakAt(channels, start, end);
    context.moveTo(x + 0.5, center - peak * center * 0.88);
    context.lineTo(x + 0.5, center + peak * center * 0.88);
  }
  context.stroke();
}

export function drawWaveform(canvas, originalChannels = [], finishedChannels = []) {
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#0e0c0b";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(238, 225, 201, 0.12)";
  context.beginPath();
  context.moveTo(0, height * 0.5 + 0.5);
  context.lineTo(width, height * 0.5 + 0.5);
  context.stroke();
  drawSeries(context, originalChannels, width, height, "rgba(238, 225, 201, 0.28)", 1);
  drawSeries(context, finishedChannels, width, height, "rgba(127, 223, 202, 0.78)", 1.2);
}
