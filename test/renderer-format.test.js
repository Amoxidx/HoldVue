import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRendererMoney, formatRendererPercent, formatRendererUnitPrice, statusToneForMessage } from '../src/renderer/renderer-app.ts';

test('renderer number formatting is exact, localized and safe at every display boundary', () => {
  assert.equal(formatRendererMoney(null, 'EUR', 'de'), '—');
  assert.equal(formatRendererMoney('1234560000000', 'EUR', 'de'), '1,23 EUR');
  assert.equal(formatRendererMoney('1235000000000', 'USD', 'en'), '1.24 USD');
  assert.equal(formatRendererMoney('-1235000000000', 'EUR', 'de'), '−1,24 EUR');
  assert.equal(formatRendererMoney('-1', 'EUR', 'de'), '0,00 EUR');
  assert.equal(formatRendererMoney('invalid', 'EUR', 'de'), '—');

  assert.equal(formatRendererUnitPrice(null, 'EUR', 'de'), '—');
  assert.equal(formatRendererUnitPrice('1235000000000', 'EUR', 'de'), '1,24 EUR');
  assert.equal(formatRendererUnitPrice('0', 'USD', 'en'), '0.00 USD');
  assert.equal(formatRendererUnitPrice('123400000', 'EUR', 'de'), '0,0001234 EUR');
  assert.equal(formatRendererUnitPrice('1', 'USD', 'en'), '0.000000000001 USD');
  assert.equal(formatRendererUnitPrice('-123400000', 'USD', 'en'), '−0.0001234 USD');
  assert.equal(formatRendererUnitPrice('invalid', 'EUR', 'de'), '—');

  assert.equal(formatRendererPercent(null, 'de'), '—');
  assert.equal(formatRendererPercent('4095', 'de'), '0,41%');
  assert.equal(formatRendererPercent('-4095', 'en'), '−0.41%');
  assert.equal(formatRendererPercent('-1', 'en'), '0.00%');
  assert.equal(formatRendererPercent('invalid', 'en'), '—');
});

test('renderer status tones distinguish progress, warnings, neutral states and failures', () => {
  assert.equal(statusToneForMessage('status.saved'), 'ready');
  assert.equal(statusToneForMessage('status.syncing'), 'busy');
  assert.equal(statusToneForMessage('status.syncPartial'), 'warning');
  assert.equal(statusToneForMessage('status.syncErc20Key'), 'warning');
  assert.equal(statusToneForMessage('status.syncRate'), 'warning');
  assert.equal(statusToneForMessage('status.syncEmpty'), 'neutral');
  assert.equal(statusToneForMessage('status.syncReady'), 'neutral');
  assert.equal(statusToneForMessage('status.copyUnavailable'), 'neutral');
  assert.equal(statusToneForMessage('status.syncError'), 'error');
  assert.equal(statusToneForMessage('status.error'), 'error');
  assert.equal(statusToneForMessage('error.generic'), 'error');
});
