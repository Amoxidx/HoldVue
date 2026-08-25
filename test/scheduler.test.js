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

test('minute scheduler contains synchronous and asynchronous callback failures', async () => {
  const callbacks = [];
  const synchronous = new LocalMinuteScheduler({ onMinute: () => { throw new Error('synthetic sync failure'); }, setIntervalFn: callback => { callbacks.push(callback); return 1; } });
  const asynchronous = new LocalMinuteScheduler({ onMinute: async () => { throw new Error('synthetic async failure'); }, setIntervalFn: callback => { callbacks.push(callback); return 2; } });
  synchronous.start();
  asynchronous.start();
  callbacks.forEach(callback => callback());
  await Promise.resolve();
  await Promise.resolve();
  synchronous.stop();
  asynchronous.stop();
});
