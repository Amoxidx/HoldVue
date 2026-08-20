import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

test('HoldVue uses one accessible icon language without platform glyph fallbacks', async () => {
  const html = await readFile(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/renderer/style.css', import.meta.url), 'utf8');
  const dom = new JSDOM(html); const documentRef = dom.window.document;
  const symbols = Array.from(documentRef.querySelectorAll('.icon-library symbol'));
  assert.ok(symbols.length >= 18);
  assert.equal(new Set(symbols.map(symbol => symbol.getAttribute('viewBox'))).size, 1);
  assert.equal(symbols[0].getAttribute('viewBox'), '0 0 20 20');
  assert.equal(new Set(symbols.map(symbol => symbol.id)).size, symbols.length);
  for (const use of documentRef.querySelectorAll('svg.icon use')) assert.ok(documentRef.querySelector(use.getAttribute('href')));
  for (const button of documentRef.querySelectorAll('button.icon-button')) {
    assert.ok(button.getAttribute('aria-label'), button.outerHTML);
    assert.ok(button.querySelector('svg.icon[aria-hidden="true"][focusable="false"]'), button.outerHTML);
  }
  assert.doesNotMatch(html, />\s*[×✕✖＋✓]\s*</);
  assert.doesNotMatch(css, /content:\s*["'][×✕✖＋✓−]["']/);
  assert.match(css, /stroke-width:\s*1\.75/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /@media \(pointer: coarse\)/);
});

test('static controls, dialogs and ARIA references have accessible names and valid targets', async () => {
  const html = await readFile(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html); const documentRef = dom.window.document;
  const ids = Array.from(documentRef.querySelectorAll('[id]'), element => element.id);
  assert.equal(new Set(ids).size, ids.length, 'IDs must be unique');
  for (const control of documentRef.querySelectorAll('input:not([type="hidden"]), select, textarea')) {
    if (control.hidden || control.getAttribute('aria-hidden') === 'true') continue;
    const labelled = control.getAttribute('aria-label') || control.getAttribute('aria-labelledby') || control.closest('label') || (control.id && documentRef.querySelector(`label[for="${control.id}"]`));
    assert.ok(labelled, control.outerHTML);
  }
  for (const button of documentRef.querySelectorAll('button')) {
    assert.equal(button.getAttribute('type') === null, false, button.outerHTML);
    assert.ok(button.getAttribute('aria-label') || button.textContent.trim(), button.outerHTML);
  }
  for (const dialog of documentRef.querySelectorAll('dialog')) assert.ok(dialog.getAttribute('aria-label') || dialog.getAttribute('aria-labelledby'), dialog.outerHTML);
  for (const element of documentRef.querySelectorAll('[aria-labelledby], [aria-describedby], [aria-controls]')) {
    for (const attribute of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
      for (const id of (element.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean)) assert.ok(documentRef.getElementById(id), `${attribute} references missing #${id}`);
    }
  }
});
