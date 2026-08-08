import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '../src/routes.js';

function renderRoute(path: string) {
  return renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, h(AppRoutes)));
}

test('the entry point renders one H1 and one primary CTA', () => {
  const html = renderRoute('/');
  assert.match(html, /<h1[^>]*id="entry-hero-title"[^>]*>/);
  const h1Count = (html.match(/<h1\b/g) ?? []).length;
  assert.equal(h1Count, 1);
  const primaryCount = (html.match(/data-variant="primary"/g) ?? []).length;
  assert.equal(primaryCount, 1);
});

test('the entry point renders the structural main landmark', () => {
  const html = renderRoute('/');
  assert.match(html, /<main[^>]*id="main-content"/);
  assert.match(html, /class="entry-header"/);
});

test('the entry point exposes no Home/About navigation or product shell', () => {
  const html = renderRoute('/');
  assert.doesNotMatch(html, />Home</);
  assert.doesNotMatch(html, />About</);
  assert.doesNotMatch(html, /aria-label="Public navigation/);
  assert.doesNotMatch(html, /class="product-layout"/);
  assert.doesNotMatch(html, /aria-label="[^"]*navigation/);
});

test('hero copy communicates what Manara is and its differentiator in both locales', () => {
  const html = renderRoute('/');
  assert.match(html, /منصة سحابية متعددة المؤسسات لإدارة التعليم والتدريب/);
  assert.match(html, /A multi-tenant cloud platform/);
  assert.match(html, /نواة واحدة مرنة تتكيف/);
  assert.match(html, /A single flexible core/);
});

test('the trust signal is a single restrained supporting line in both locales', () => {
  const html = renderRoute('/');
  assert.match(html, /عزل كامل للبيانات بين المؤسسات/);
  assert.match(html, /Full data isolation between institutions/);
  const trustCount = (html.match(/data-locale="ar" lang="ar">عزل/gi) ?? []).length;
  assert.equal(trustCount, 1);
});

test('locale copy is balanced and never duplicated between languages', () => {
  const html = renderRoute('/');
  const ar = (html.match(/data-locale="ar" lang="ar">/g) ?? []).length;
  const en = (html.match(/data-locale="en" lang="en">/g) ?? []).length;
  assert.ok(ar >= 1);
  assert.equal(en, ar);
});

test('beacon decorative elements are hidden from assistive technology', () => {
  const html = renderRoute('/');
  assert.match(html, /aria-hidden="true"/);
  const visibleNodes = (html.match(/class="beacon-node"/g) ?? []).length;
  assert.ok(visibleNodes >= 1, 'beacon composition includes nodes');
});

test('the entry page copies are locale-exclusive with a usable fallback', () => {
  const html = renderRoute('/');
  assert.match(html, /data-locale="ar" lang="ar">منارة/);
  assert.match(html, /data-locale="en" lang="en">Manara/);
  assert.match(html, /data-locale="ar" lang="ar">اطلب الانضمام/);
  assert.match(html, /data-locale="en" lang="en">Request access/);
});

test('entry styles use semantic tokens, logical properties, and no raw palette', () => {
  const css = readFileSync(new URL('../src/styles/entry.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(css, /rgb\(/);
  assert.doesNotMatch(css, /--brand-|--gold-|--ink-/);
  assert.match(css, /margin-inline|inset-inline|padding-inline/);
  assert.match(css, /var\(--canvas\)|var\(--surface\)/);
});
