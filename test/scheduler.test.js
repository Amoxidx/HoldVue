import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalMinuteScheduler } from '../src/shared/scheduler.ts';

test('minute scheduler is idempotent, injectable, and stoppable', async () => {
  const calls = [];
  const timers = [];
  const cleared = [];
  const scheduler = new LocalMinuteScheduler({
    onMinute: () => { calls.push('tick'); },
    setIntervalFn: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearIntervalFn: handle => { cleared.push(handle); }
  });
  scheduler.start(); scheduler.start();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 60_000);
  timers[0].callback();
  assert.deepEqual(calls, ['tick']);
  scheduler.stop(); scheduler.stop();
  assert.deepEqual(cleared, [1]);
  const custom = new LocalMinuteScheduler({ onMinute: async () => undefined, intervalMs: 1, setIntervalFn: callback => { callback(); return 'x'; }, clearIntervalFn: () => undefined });
  custom.start(); custom.stop();
  const defaults = new LocalMinuteScheduler({ onMinute: () => undefined });
  defaults.start(); defaults.stop();
  await Promise.resolve();
});
