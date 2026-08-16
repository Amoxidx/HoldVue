export interface MinuteScheduler {
  start(): void;
  stop(): void;
}

export interface SchedulerOptions {
  readonly onMinute: () => void | Promise<void>;
  readonly setIntervalFn?: (callback: () => void, delay: number) => unknown;
  readonly clearIntervalFn?: (handle: unknown) => void;
  readonly intervalMs?: number;
}

export class LocalMinuteScheduler implements MinuteScheduler {
  private handle: unknown = null;
  private readonly onMinute: () => void | Promise<void>;
  private readonly setIntervalFn: (callback: () => void, delay: number) => unknown;
  private readonly clearIntervalFn: (handle: unknown) => void;
  private readonly intervalMs: number;

  public constructor(options: SchedulerOptions) {
    this.onMinute = options.onMinute;
    this.setIntervalFn = options.setIntervalFn ?? ((callback, delay) => setInterval(callback, delay));
    this.clearIntervalFn = options.clearIntervalFn ?? (handle => clearInterval(handle as ReturnType<typeof setInterval>));
    this.intervalMs = options.intervalMs ?? 60_000;
  }

  public start(): void {
    if (this.handle !== null) return;
    this.handle = this.setIntervalFn(() => { void this.onMinute(); }, this.intervalMs);
  }

  public stop(): void {
    if (this.handle === null) return;
    this.clearIntervalFn(this.handle);
    this.handle = null;
  }
}
