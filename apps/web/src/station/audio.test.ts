import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installAudioUnlock,
  isAudioUnlocked,
  playDuplicateTone,
  playTone,
  resetAudioForTests,
  unlockAudio,
} from './audio.ts';

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = {};
  oscillators: { start: ReturnType<typeof vi.fn> }[] = [];
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  createGain() {
    return { gain: { value: 1 }, connect: (node: unknown) => node };
  }
  createOscillator() {
    const oscillator = {
      type: '',
      frequency: { value: 0 },
      connect: (node: unknown) => node,
      start: vi.fn(),
      stop: vi.fn(),
    };
    this.oscillators.push(oscillator);
    return oscillator;
  }
}

afterEach(() => {
  resetAudioForTests();
  FakeAudioContext.instances = [];
  vi.unstubAllGlobals();
});

describe('audio', () => {
  it('stays silent until unlocked', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    playTone();
    expect(FakeAudioContext.instances).toEqual([]);
    expect(isAudioUnlocked()).toBe(false);
  });

  it('is unlocked by the first click and then plays tones', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const target = new EventTarget();
    installAudioUnlock(target);
    target.dispatchEvent(new Event('pointerdown'));
    expect(isAudioUnlocked()).toBe(true);
    playTone();
    expect(FakeAudioContext.instances[0]!.oscillators[0]!.start).toHaveBeenCalled();

    // The listener is removed after the first interaction.
    target.dispatchEvent(new Event('keydown'));
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it('plays two beeps for a repeated article', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    unlockAudio();
    const audio = FakeAudioContext.instances[0]!;
    audio.state = 'running';
    audio.currentTime = 2;
    playDuplicateTone();
    expect(audio.oscillators.map((o) => o.start.mock.calls[0]![0])).toEqual([2, 2.16]);
  });

  it('ignores browsers without audio support', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => unlockAudio()).not.toThrow();
    expect(isAudioUnlocked()).toBe(false);
  });
});
