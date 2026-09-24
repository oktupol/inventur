/** Outcome of handling a queued item: `retry` keeps it at the head and pauses the queue. */
export type QueueOutcome = 'done' | 'retry';

/**
 * Processes items strictly one after another in the order they were added,
 * so fast scans are neither lost nor reordered. A handler that returns
 * `retry` (e.g. on a network error) pauses the queue until `resume`.
 */
export class SerialQueue<T> {
  private readonly items: T[] = [];
  private running = false;
  private paused = false;
  private handler: ((item: T) => Promise<QueueOutcome>) | undefined;
  private readonly changed: (queue: SerialQueue<T>) => void;

  constructor(
    handler?: (item: T) => Promise<QueueOutcome>,
    onChange: (queue: SerialQueue<T>) => void = () => {},
  ) {
    this.handler = handler;
    this.changed = onChange;
  }

  /** Replaces the handler, e.g. with one that uses the latest UI state; items wait until one is set. */
  setHandler(handler: (item: T) => Promise<QueueOutcome>): void {
    this.handler = handler;
    void this.run();
  }

  private onChange(): void {
    this.changed(this);
  }

  /** Items not yet handled, including the one in progress. */
  get pending(): readonly T[] {
    return this.items;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  push(item: T): void {
    this.items.push(item);
    this.onChange();
    void this.run();
  }

  pause(): void {
    this.paused = true;
    this.onChange();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.onChange();
    void this.run();
  }

  private async run(): Promise<void> {
    if (this.running || !this.handler) return;
    this.running = true;
    try {
      while (!this.paused && this.items.length > 0) {
        let outcome: QueueOutcome;
        try {
          outcome = await this.handler!(this.items[0]!);
        } catch {
          outcome = 'retry';
        }
        if (outcome === 'retry') {
          this.paused = true;
        } else {
          this.items.shift();
        }
        this.onChange();
      }
    } finally {
      this.running = false;
    }
  }
}
