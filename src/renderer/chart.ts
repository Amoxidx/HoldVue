import type { Currency } from '../shared/ports.ts';
import type { HistoryPoint } from '../shared/state.ts';
import { scaledToDecimal } from '../shared/pricing.ts';
import type { PortfolioRange } from '../shared/portfolio.ts';

export interface ChartPoint extends HistoryPoint { readonly timestamp: number; }
export interface ChartConfig {
  readonly points: readonly ChartPoint[];
  readonly currency: Currency;
  readonly range: PortfolioRange;
  readonly title: string;
  readonly summary: string;
  readonly unit: 'price' | 'value';
  readonly width?: number;
  readonly height?: number;
}
export interface ChartHost {
  innerHTML: string;
  addEventListener(type: string, callback: (event: Event) => void): void;
  removeEventListener(type: string, callback: (event: Event) => void): void;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getAttribute(name: string): string | null;
  querySelector(selector: string): ChartHost | null;
  querySelectorAll(selector: string): Iterable<ChartHost>;
  clientWidth: number;
  clientHeight: number;
  getBoundingClientRect(): { readonly left: number; readonly width: number };
}

const safeDimension = (value: number | undefined, fallback: number, minimum: number): number => Number.isFinite(value) && (value as number) >= minimum ? Math.floor(value as number) : fallback;
const valueOf = (point: ChartPoint, currency: Currency): string => currency === 'EUR' ? point.valueEurScaled : point.valueUsdScaled;
const formatDate = (timestamp: number, locale: string, range?: PortfolioRange): string => {
  const options: Intl.DateTimeFormatOptions = range === '1D' || range === undefined ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' } : range === '7D' || range === '1M' ? { day: '2-digit', month: 'short' } : { month: 'short', year: 'numeric' };
  return new Intl.DateTimeFormat(locale, options).format(new Date(timestamp));
};
const escape = (value: string): string => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));

function coordinate(value: string, min: bigint, span: bigint, height: number, top: number, bottom: number): number {
  if (span === 0n) return (top + height - bottom) / 2;
  const scaled = (BigInt(value) - min) * 1000000n / span;
  return top + (height - top - bottom) - Number(scaled) / 1000000 * (height - top - bottom);
}
function xCoordinate(index: number, count: number, width: number, left: number, right: number): number {
  if (count <= 1) return left + (width - left - right) / 2;
  return left + index / (count - 1) * (width - left - right);
}
function chartValues(points: readonly ChartPoint[], currency: Currency): readonly string[] { return points.map(point => valueOf(point, currency)); }
function xLabels(points: readonly ChartPoint[], locale: string, range: PortfolioRange): readonly string[] {
  if (points.length === 0) return [];
  const indexes = points.length === 1 ? [0] : points.length === 2 ? [0, 1] : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  return indexes.map(index => formatDate(points[index]!.timestamp, locale, range));
}
function compactDecimal(value: string, locale: string): string {
  const [whole, fraction] = [...value.split('.'), ''] as [string, string];
  if (fraction === '') return whole;
  const first = fraction.replace(/^0+/, '');
  const significant = (whole === '0' ? first.slice(0, 4) : fraction.slice(0, 2));
  const zeros = whole === '0' ? fraction.length - first.length : 0;
  const result = whole === '0' && significant !== '' ? `0.${'0'.repeat(zeros)}${significant}` : `${whole}.${significant}`;
  return locale === 'de' ? result.replace('.', ',') : result;
}
function localizedChartValue(value: string, locale: string): string {
  const decimal = scaledToDecimal(value); const negative = decimal.startsWith('-'); const unsigned = negative ? decimal.slice(1) : decimal;
  const [whole = '0', fraction = ''] = unsigned.split('.'); const firstSignificant = fraction.search(/[1-9]/);
  const precision = whole !== '0' ? 2 : firstSignificant < 0 ? 0 : Math.min(12, firstSignificant + 4);
  const shownFraction = fraction.slice(0, precision).replace(/0+$/, '');
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(BigInt(whole));
  return `${negative ? '−' : ''}${grouped}${shownFraction ? `${locale === 'de' ? ',' : '.'}${shownFraction}` : ''}`;
}
function yLabels(values: readonly string[], currency: Currency, locale: string): readonly string[] {
  if (values.length === 0) return [];
  const numeric = values.map(value => BigInt(value));
  const min = numeric.reduce((a, b) => a < b ? a : b);
  const max = numeric.reduce((a, b) => a > b ? a : b);
  if (min === max) return [compactDecimal(scaledToDecimal(values[0]!), locale)];
  const middle = min + (max - min) / 2n;
  return [compactDecimal(scaledToDecimal(max.toString()), locale), compactDecimal(scaledToDecimal(middle.toString()), locale), compactDecimal(scaledToDecimal(min.toString()), locale)];
}

export interface ChartGeometry { readonly points: readonly { readonly x: number; readonly y: number; readonly timestamp: number; readonly value: string }[]; readonly width: number; readonly height: number; }
export function buildChartGeometry(config: ChartConfig): ChartGeometry {
  const width = safeDimension(config.width, 720, 240); const height = safeDimension(config.height, config.unit === 'price' ? 160 : 240, 100);
  const left = 58; const right = 12; const top = 18; const bottom = 30; const values = chartValues(config.points, config.currency);
  if (values.length === 0) return { points: [], width, height };
  const numbers = values.map(value => BigInt(value)); const min = numbers.reduce((a, b) => a < b ? a : b); const max = numbers.reduce((a, b) => a > b ? a : b); const span = max - min;
  return { width, height, points: config.points.map((point, index) => ({ x: xCoordinate(index, config.points.length, width, left, right), y: coordinate(values[index]!, min, span, height, top, bottom), timestamp: point.timestamp, value: values[index]! })) };
}

export function chartMarkup(config: ChartConfig, locale = 'de'): string {
  const geometry = buildChartGeometry(config); const values = chartValues(config.points, config.currency); const labels = xLabels(config.points, locale, config.range); const ys = yLabels(values, config.currency, locale);
  if (config.points.length === 0) return `<div class="chart-empty" data-chart-empty><svg class="icon chart-empty-icon" aria-hidden="true" focusable="false"><use href="#icon-chart"></use></svg><span>${escape(config.summary)}</span></div>`;
  const polyline = geometry.points.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  const circles = geometry.points.map((point, index) => `<circle class="chart-point" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${config.points.length === 1 ? '4' : '2.5'}" data-chart-index="${index}" aria-hidden="true"></circle>`).join('');
  const guides = ys.map((_, index) => { const y = ys.length === 1 ? 18 : 18 + index * (geometry.height - 48) / (ys.length - 1); return `<line class="chart-guide" x1="58" x2="${geometry.width - 12}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}"></line>`; }).join('');
  const yText = ys.map((value, index) => { const y = ys.length === 1 ? 18 : 18 + index * (geometry.height - 48) / (ys.length - 1); return `<text class="chart-y-label" x="4" y="${y.toFixed(2)}" dominant-baseline="middle">${escape(value)}</text>`; }).join('');
  const xIndexes = labels.length === 1 ? [0] : labels.length === 2 ? [0, geometry.points.length - 1] : [0, Math.floor((geometry.points.length - 1) / 2), geometry.points.length - 1];
  const xText = labels.map((label, index) => `<text class="chart-x-label" text-anchor="${index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle'}" x="${geometry.points[xIndexes[index]!]!.x.toFixed(2)}" y="${geometry.height - 4}">${escape(label)}</text>`).join('');
  const line = geometry.points.length > 1 ? `<polygon class="chart-area" points="${geometry.points[0]!.x.toFixed(2)},${geometry.height - 30} ${polyline} ${geometry.points.at(-1)!.x.toFixed(2)},${geometry.height - 30}"></polygon><polyline class="chart-line" points="${polyline}"></polyline>` : '';
  return `<svg class="portfolio-chart" viewBox="0 0 ${geometry.width} ${geometry.height}" role="img" aria-label="${escape(config.title)}" data-chart-kind="${config.unit}" data-single-point="${config.points.length === 1}"><title>${escape(config.title)}</title><desc>${escape(config.summary)}</desc>${guides}<line class="chart-crosshair" data-chart-crosshair x1="0" x2="0" y1="18" y2="${geometry.height - 30}" hidden></line>${line}${circles}${yText}${xText}</svg><div class="chart-tooltip" data-chart-tooltip role="status" aria-live="polite" hidden></div>`;
}

export function nearestChartPoint(points: readonly { readonly x: number; readonly timestamp: number; readonly value: string }[], x: number): number | null {
  if (points.length === 0 || !Number.isFinite(x)) return null;
  let nearest = 0; let distance = Math.abs(points[0]!.x - x);
  for (let index = 1; index < points.length; index += 1) { const next = Math.abs(points[index]!.x - x); if (next < distance) { nearest = index; distance = next; } }
  return nearest;
}
export function chartTooltip(point: { readonly timestamp: number; readonly value: string } | null, currency: Currency, locale = 'de', unit: 'price' | 'value' = 'value'): string {
  if (!point) return '';
  const label = unit === 'price' ? (locale === 'de' ? 'Stückpreis' : 'Unit price') : (locale === 'de' ? 'Portfoliowert' : 'Portfolio value');
  return `${formatDate(point.timestamp, locale)} · ${label}: ${localizedChartValue(point.value, locale)} ${currency}`;
}

export function bindChart(host: ChartHost, config: ChartConfig, locale: string, onPoint?: (index: number | null, tooltip: string) => void): () => void {
  host.innerHTML = chartMarkup(config, locale);
  const geometry = buildChartGeometry(config); const svg = config.points.length > 0;
  const pointFromEvent = (event: Event): number | null => { const mouse = event as MouseEvent; const rect = host.getBoundingClientRect(); const raw = Number.isFinite(mouse.offsetX) ? mouse.offsetX : mouse.clientX - rect.left; const width = rect.width || host.clientWidth || geometry.width; const value = raw * geometry.width / width; return nearestChartPoint(geometry.points, value); };
  const indicator = (index: number | null): void => { const crosshair = host.querySelector('[data-chart-crosshair]')!; const points = host.querySelectorAll('[data-chart-index]'); if (index === null) crosshair.setAttribute('hidden', 'true'); else { crosshair.removeAttribute('hidden'); const point = geometry.points[index]!; crosshair.setAttribute('x1', point.x.toFixed(2)); crosshair.setAttribute('x2', point.x.toFixed(2)); } for (const point of points) point.setAttribute('data-active', String(point.getAttribute('data-chart-index') === String(index))); };
  const move = (event: Event): void => { const index = pointFromEvent(event); if (index !== null) host.setAttribute('data-chart-index', String(index)); indicator(index); onPoint?.(index, index === null ? '' : chartTooltip({ timestamp: config.points[index]!.timestamp, value: valueOf(config.points[index]!, config.currency) }, config.currency, locale, config.unit)); };
  const leave = (): void => { indicator(null); onPoint?.(null, ''); };
  const key = (event: Event): void => {
    const keyValue = (event as KeyboardEvent).key; const current = Number(host.getAttribute('data-chart-index') ?? '-1');
    if (keyValue === 'Escape') { leave(); return; }
    const next = keyValue === 'ArrowRight' ? Math.min(current + 1, config.points.length - 1) : keyValue === 'ArrowLeft' ? Math.max(current - 1, 0) : keyValue === 'Home' ? 0 : keyValue === 'End' ? config.points.length - 1 : current;
    if (next !== current && next >= 0) { event.preventDefault(); host.setAttribute('data-chart-index', String(next)); indicator(next); const point = config.points[next]!; onPoint?.(next, chartTooltip({ timestamp: point.timestamp, value: valueOf(point, config.currency) }, config.currency, locale, config.unit)); }
  };
  if (svg) { host.addEventListener('pointermove', move); host.addEventListener('pointerleave', leave); host.addEventListener('keydown', key); }
  return () => { if (svg) { host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave); host.removeEventListener('keydown', key); } };
}
