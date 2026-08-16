import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { bindChart, buildChartGeometry, chartMarkup, chartTooltip, nearestChartPoint } from '../src/renderer/chart.ts';

const points = (count = 3) => Array.from({ length: count }, (_, index) => ({ timestamp: index * 86400000, valueEurScaled: String((index + 1) * 1000000000000), valueUsdScaled: String((index + 1) * 1200000000000), coverage: 'complete' }));
const config = (items = points()) => ({ points: items, currency: 'EUR', range: '1D', title: 'Synthetic value', summary: 'Synthetic chart', unit: 'value' });

test('chart geometry and markup cover empty, single and compact multi-point states', () => {
  assert.deepEqual(buildChartGeometry(config([])).points, []);
  assert.match(chartMarkup(config([])), /data-chart-empty/);
  const one = chartMarkup(config(points(1))); assert.doesNotMatch(one, /polyline/); assert.match(one, /chart-point/);
  const many = chartMarkup(config(), 'en'); assert.match(many, /chart-guide/); assert.match(many, /chart-crosshair/); assert.match(many, /text-anchor/); assert.equal((many.match(/chart-x-label/g) ?? []).length, 3);
  assert.match(chartMarkup(config([{ ...points(1)[0], valueEurScaled: '1234500000000' }]), 'de'), /1,23/);
  assert.match(chartMarkup({ ...config(), range: '7D' }), /chart-x-label/);
  assert.match(chartMarkup({ ...config(), range: '1M' }), /chart-x-label/);
  assert.match(chartMarkup({ ...config(), range: 'MAX' }), /chart-x-label/);
  assert.match(chartMarkup(config([{ ...points(1)[0], valueEurScaled: '1' }]), 'en'), /0\.0000/);
  assert.match(chartMarkup(config([{ ...points(1)[0], valueEurScaled: '0' }]), 'en'), /0/);
  assert.match(chartMarkup({ ...config([{ ...points(3)[0], valueEurScaled: '3000000000000' }, { ...points(3)[1], valueEurScaled: '1000000000000' }, { ...points(3)[2], valueEurScaled: '2000000000000' }]), range: 'MAX' }, 'en'), /chart-guide/);
  assert.equal(buildChartGeometry({ ...config(), width: 100, height: 80 }).width, 720);
  assert.equal(buildChartGeometry({ ...config(), width: 400, height: 120 }).height, 120);
  assert.equal(nearestChartPoint([], 2), null); assert.equal(nearestChartPoint(buildChartGeometry(config()).points, Number.NaN), null); assert.equal(nearestChartPoint(buildChartGeometry(config()).points, 0), 0);
});

test('chart tooltip is exact, range labels adapt and pointer/keyboard indicators stay synchronized', () => {
  assert.equal(chartTooltip(null, 'EUR'), '');
  assert.match(chartTooltip({ timestamp: 0, value: '1230000000000' }, 'EUR', 'de', 'price'), /Stückpreis/);
  assert.match(chartTooltip({ timestamp: 0, value: '1230000000000' }, 'USD', 'en', 'price'), /Unit price/);
  assert.match(chartTooltip({ timestamp: 0, value: '1230000000000' }, 'EUR', 'de', 'value'), /Portfoliowert/);
  assert.match(chartTooltip({ timestamp: 0, value: '1230000000000' }, 'USD', 'en', 'value'), /Portfolio value/);
  const dom = new JSDOM('<div id="host" tabindex="0"></div>'); const host = dom.window.document.querySelector('#host');
  host.getBoundingClientRect = () => ({ left: 0, width: 400 });
  const seen = []; const dispose = bindChart(host, { ...config(), range: '1Y', unit: 'price' }, 'en', (index, tooltip) => seen.push([index, tooltip]));
  assert.equal(host.querySelectorAll('.chart-point').length, 3);
  host.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  const offsetEvent = new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 390 }); Object.defineProperty(offsetEvent, 'offsetX', { value: 390 }); host.dispatchEvent(offsetEvent);
  host.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 5 }));
  host.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  host.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  host.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  const invalidMove = new dom.window.MouseEvent('pointermove', { bubbles: true }); Object.defineProperty(invalidMove, 'clientX', { value: Number.NaN }); Object.defineProperty(invalidMove, 'offsetX', { value: Number.NaN }); host.dispatchEvent(invalidMove);
  host.getBoundingClientRect = () => ({ left: 0, width: 0 }); Object.defineProperty(host, 'clientWidth', { configurable: true, value: 300 }); host.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 150 })); Object.defineProperty(host, 'clientWidth', { configurable: true, value: 0 }); host.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 150 }));
  host.dispatchEvent(new dom.window.MouseEvent('pointerleave', { bubbles: true }));
  assert.ok(seen.length >= 3); assert.equal(host.querySelector('[data-chart-crosshair]').hasAttribute('hidden'), true);
  dispose();
});
