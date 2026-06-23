function makeAudioBuffer(context, channels, sampleRate) {
  const buffer = context.createBuffer(channels.length, channels[0]?.length ?? 1, sampleRate);
  channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
  return buffer;
}

export function createPreviewController(getAudioContext, onTime) {
  let data = null;
  let active = null;
  let offset = 0;
  let animationFrame = 0;

  function stopNode(node, when = 0) {
    if (!node) return;
    try {
      node.source.stop(when);
    } catch {
      // The source may already have ended.
    }
  }

  function stop() {
    if (active) stopNode(active);
    active = null;
    offset = 0;
    cancelAnimationFrame(animationFrame);
    onTime?.(0, data?.duration ?? 0, null);
  }

  function setData(nextData) {
    stop();
    data = nextData;
    onTime?.(0, data?.duration ?? 0, null);
  }

  function updateClock() {
    if (!active || !data) return;
    const context = getAudioContext();
    const elapsed = context.currentTime - active.startedAt;
    offset = Math.min(data.duration, active.offset + elapsed);
    onTime?.(offset, data.duration, active.kind);
    if (offset < data.duration) animationFrame = requestAnimationFrame(updateClock);
    else stop();
  }

  async function play(kind, levelMatch) {
    if (!data) return;
    const context = getAudioContext();
    await context.resume();
    const switching = active && active.kind !== kind;
    const startOffset = switching
      ? Math.min(data.duration - 0.01, active.offset + context.currentTime - active.startedAt)
      : 0;
    const source = context.createBufferSource();
    source.buffer = makeAudioBuffer(
      context,
      kind === "original" ? data.originalChannels : data.finishedChannels,
      data.sampleRate,
    );
    const gain = context.createGain();
    const targetGain = levelMatch ? data.levelMatch[kind] : 1;
    const now = context.currentTime;
    gain.gain.setValueAtTime(switching ? 0 : targetGain, now);
    if (switching) gain.gain.linearRampToValueAtTime(targetGain, now + 0.03);
    source.connect(gain).connect(context.destination);
    source.start(now, Math.max(0, startOffset));

    if (active) {
      active.gain.gain.cancelScheduledValues(now);
      active.gain.gain.setValueAtTime(active.gain.gain.value, now);
      active.gain.gain.linearRampToValueAtTime(0, now + 0.03);
      stopNode(active, now + 0.04);
    }

    active = { source, gain, kind, startedAt: now, offset: startOffset };
    onTime?.(startOffset, data.duration, kind);
    source.addEventListener("ended", () => {
      if (active?.source === source) stop();
    });
    cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(updateClock);
  }

  return { setData, play, stop };
}
