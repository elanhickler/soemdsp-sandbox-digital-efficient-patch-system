// Two triad shapes, relative to their root (bit 0 = root itself).
const nodeGraphChordSequencerMajorTriadMask = 0x91; // bits 0, 4, 7
const nodeGraphChordSequencerMinorTriadMask = 0x89; // bits 0, 3, 7

// Six diatonic progressions in C, four chords each. Mirrors
// native_modules/chord_sequencer exactly. Root anchors each chord's root at
// MIDI 60 (middle C) + pitch class, directly usable as a 0.1V/Oct bass pitch.
const nodeGraphChordSequencerProgressions = Object.freeze([
  [[0, 0], [7, 0], [9, 1], [5, 0]], // I - V - vi - IV
  [[0, 0], [5, 0], [7, 0], [0, 0]], // I - IV - V - I
  [[2, 1], [7, 0], [0, 0], [0, 0]], // ii - V - I - I
  [[9, 1], [5, 0], [0, 0], [7, 0]], // vi - IV - I - V
  [[0, 0], [9, 1], [5, 0], [7, 0]], // I - vi - IV - V
  [[0, 0], [9, 1], [2, 1], [7, 0]], // I - vi - ii - V
]);

function createNodeGraphChordSequencerState() {
  return { clockWasHigh: false, resetWasHigh: false, stepIndex: 0 };
}

function nodeGraphChordSequencerRotateLeft12(mask, amount) {
  const n = ((amount % 12) + 12) % 12;
  if (n === 0) return mask & 0xFFF;
  return ((mask << n) | (mask >> (12 - n))) & 0xFFF;
}

// Steps through a built-in diatonic chord progression on each Clock edge.
// Scale is a digital signal (12-bit pitch-class mask, same convention as
// Turing Machine's Scale output / Pitch Quantizer's Scale input); Root is
// the chord's root as 0.1V/Oct.
function nodeGraphChordSequencerSample(state, options = {}) {
  const clockHigh = Number(options.clock) > 0;
  const resetHigh = Number(options.reset) > 0;
  const progressions = nodeGraphChordSequencerProgressions;
  const progressionIndex = Math.max(0, Math.min(progressions.length - 1, Math.round(Number(options.progression) || 0)));
  const level = Number(options.level) || 0;

  if (resetHigh && !state.resetWasHigh) {
    state.stepIndex = 0;
  }
  state.resetWasHigh = resetHigh;

  if (clockHigh && !state.clockWasHigh) {
    state.stepIndex = (state.stepIndex + 1) % progressions[progressionIndex].length;
  }
  state.clockWasHigh = clockHigh;

  const [root, quality] = progressions[progressionIndex][state.stepIndex];
  const baseMask = quality === 0 ? nodeGraphChordSequencerMajorTriadMask : nodeGraphChordSequencerMinorTriadMask;

  return {
    Scale: nodeGraphChordSequencerRotateLeft12(baseMask, root),
    Root: (60 + root) / 120,
    Gate: (clockHigh ? 1 : 0) * level,
  };
}
