/**
 * Sound output of the workstation. Browsers block audio until the user has
 * interacted with the page, so the first click or key press unlocks it.
 */

let context: AudioContext | undefined;

export function unlockAudio(): void {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
  } catch {
    // No audio support; entries still work without sound.
  }
}

export function isAudioUnlocked(): boolean {
  return context?.state === 'running';
}

/** Unlocks the audio on the first click or key press; returns a function that removes the listeners. */
export function installAudioUnlock(target: EventTarget = window): () => void {
  const events = ['pointerdown', 'keydown'] as const;
  const onInteraction = () => {
    unlockAudio();
    remove();
  };
  const remove = () => {
    for (const type of events) target.removeEventListener(type, onInteraction);
  };
  for (const type of events) target.addEventListener(type, onInteraction);
  return remove;
}

/** Plays a short tone, e.g. for an unknown article. Does nothing while audio is locked. */
export function playTone({ frequency = 330, durationMs = 250 } = {}): void {
  if (!context || context.state !== 'running') return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'square';
  oscillator.frequency.value = frequency;
  gain.gain.value = 0.15;
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + durationMs / 1000);
}

/** Resets the module state; only for tests. */
export function resetAudioForTests(): void {
  context = undefined;
}
