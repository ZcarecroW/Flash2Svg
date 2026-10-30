// Separate bundle (panel/audio.js), loaded by the panel on the first player export that has
// sounds: keeps the audio codecs out of the panel's start-up.
import { createAudioCodecs } from "../core/audio-codecs.ts";

(globalThis as { Flash2SvgAudio?: { createAudioCodecs: typeof createAudioCodecs } }).Flash2SvgAudio = { createAudioCodecs };
