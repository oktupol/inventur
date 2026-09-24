import { describe, expect, it } from 'vitest';
import { SerialQueue, type QueueOutcome } from './queue.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SerialQueue', () => {
  it('handles items one after another in order', async () => {
    const handled: number[] = [];
    let active = 0;
    let maxActive = 0;
    const queue = new SerialQueue<number>(async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await tick();
      handled.push(item);
      active--;
      return 'done';
    });
    for (let i = 0; i < 20; i++) queue.push(i);
    while (queue.pending.length > 0) await tick();
    expect(handled).toEqual([...Array(20).keys()]);
    expect(maxActive).toBe(1);
  });

  it('keeps an item and pauses on retry until resumed', async () => {
    const outcomes: QueueOutcome[] = ['retry', 'done', 'done'];
    const handled: string[] = [];
    const queue = new SerialQueue<string>(async (item) => {
      handled.push(item);
      return outcomes.shift()!;
    });
    queue.push('a');
    queue.push('b');
    await tick();
    expect(queue.isPaused).toBe(true);
    expect(queue.pending).toEqual(['a', 'b']);

    queue.resume();
    await tick();
    await tick();
    expect(handled).toEqual(['a', 'a', 'b']);
    expect(queue.pending).toEqual([]);
  });

  it('treats a throwing handler like a retry', async () => {
    let fail = true;
    const queue = new SerialQueue<string>(async () => {
      if (fail) throw new Error('offline');
      return 'done';
    });
    queue.push('a');
    await tick();
    expect(queue.isPaused).toBe(true);
    fail = false;
    queue.resume();
    await tick();
    expect(queue.pending).toEqual([]);
  });

  it('waits for a handler that needs user input before continuing', async () => {
    const choice = deferred<void>();
    const handled: string[] = [];
    const queue = new SerialQueue<string>(async (item) => {
      if (item === 'ambiguous') await choice.promise;
      handled.push(item);
      return 'done';
    });
    queue.push('ambiguous');
    queue.push('next');
    await tick();
    expect(handled).toEqual([]);
    choice.resolve();
    await tick();
    await tick();
    expect(handled).toEqual(['ambiguous', 'next']);
  });

  it('reports changes', async () => {
    let changes = 0;
    const queue = new SerialQueue<string>(
      async () => 'done',
      () => changes++,
    );
    queue.push('a');
    await tick();
    expect(changes).toBe(2);
  });
});

describe('SerialQueue handler', () => {
  it('waits for a handler and uses the latest one', async () => {
    const handled: string[] = [];
    const queue = new SerialQueue<string>();
    queue.push('a');
    await tick();
    expect(queue.pending).toEqual(['a']);
    queue.setHandler(async (item) => {
      handled.push(`first:${item}`);
      return 'done';
    });
    await tick();
    queue.setHandler(async (item) => {
      handled.push(`second:${item}`);
      return 'done';
    });
    queue.push('b');
    await tick();
    expect(handled).toEqual(['first:a', 'second:b']);
  });
});
