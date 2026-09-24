/**
 * Small helpers every voice in the game shares.
 *
 * Everything audible is SYNTHESISED at runtime - there is not a byte of audio
 * data in the build. That is the whole reason the audio pass costs nothing
 * against the 12 MB budget.
 */

/** Convert a MIDI note number to hertz. */
export const midiToFreq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/**
 * A short buffer of white noise, reused by every percussive voice.
 *
 * Built once: a quarter of a second at the context's own rate is enough for
 * hats, snares and impacts, all of which only ever play a slice of it.
 */
export const createNoiseBuffer = (ctx: BaseAudioContext): AudioBuffer => {
  const length = Math.floor(ctx.sampleRate * 0.25);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
};

/**
 * A decaying gain envelope.
 *
 * `exponentialRampToValueAtTime` cannot reach zero, hence the tiny floor -
 * ramping to an actual 0 throws, and ramping linearly gives a duller, clickier
 * tail than a percussive sound wants.
 */
export const envelope = (
  ctx: BaseAudioContext,
  time: number,
  peak: number,
  attack: number,
  decay: number,
): GainNode => {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, time + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
  return gain;
};
