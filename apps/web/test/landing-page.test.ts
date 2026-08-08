import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '../src/routes.js';
import { publicNavigation } from '../src/components/navigation/navigation-config.js';

const html = renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/'] }, React.createElement(AppRoutes)),
);

test('landing page has one h1 and sequential public sections', () => {
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  assert.match(html, /<main class="public-main" id="main-content"/);
  assert.match(html, /<footer class="public-footer"/);
  assert.match(html, /id="capabilities"/);
  assert.match(html, /id="workflow"/);
  assert.match(html, /id="governance"/);
});

test('public navigation points only to real landing destinations', () => {
  assert.deepEqual(publicNavigation.map((item) => item.to), ['/#capabilities', '/#workflow', '/#governance']);
  for (const item of publicNavigation) assert.match(html, new RegExp(`href="${item.to}"`));
  assert.doesNotMatch(html, /login|sign up|book demo|contact sales/i);
});

test('Arabic and English copy remain locale-exclusive with a usable language switch', () => {
  assert.match(html, /data-locale="ar" lang="ar">منارة/);
  assert.match(html, /data-locale="en" lang="en">Manara/);
  assert.match(html, /aria-pressed="false" lang="ar" type="button">العربية/);
  assert.match(html, /aria-pressed="true" lang="en" type="button">English/);
  const css = readFileSync(new URL('../src/styles/layouts.css', import.meta.url), 'utf8');
  assert.match(css, /html:lang\(ar\) \[data-locale='ar'\]/);
});

test('AI direction is explicitly planned and avoids unsupported proof', () => {
  assert.match(html, /Future direction/);
  assert.match(html, /not available in the platform today/);
  assert.doesNotMatch(html, /testimonial|customer logo|certified|award-winning/i);
});

test('landing copy explains the institutional problem and the platform response', () => {
  assert.match(html, /When learning tools fragment/);
  assert.match(html, /Manara brings learning work into one clear place/);
  assert.doesNotMatch(html, /MNR\s*\/\s*01|A—04/);
});

test('product proof labels itself as structural rather than complete', () => {
  assert.match(html, /Structural preview/);
  assert.match(html, /not a completed dashboard/);
  assert.match(html, /aria-labelledby="workflow-preview-caption"/);
});

test('reveal enhancement is progressive and reduced-motion safe', () => {
  const hook = readFileSync(new URL('../src/hooks/use-section-reveal.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles/public.css', import.meta.url), 'utf8');
  assert.match(hook, /if \(!\('IntersectionObserver' in window\)\) return/);
  assert.doesNotMatch(css, /^\s*\[data-reveal\][^{]*\{[^}]*opacity:\s*0/ms);
  assert.match(css, /data-reveal-enhanced='true'/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test('landing styles consume semantic tokens without raw palette values', () => {
  const css = readFileSync(new URL('../src/styles/public.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}/i);
  assert.match(css, /border-inline-start/);
  assert.match(css, /inset-inline-end/);
});
