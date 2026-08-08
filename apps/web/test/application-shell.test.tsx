import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '../src/routes.js';
import { productNavigation } from '../src/components/navigation/navigation-config.js';

function renderRoute(path: string) {
  return renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, h(AppRoutes)));
}

test('each supported product role renders role-specific navigation without authorization claims', () => {
  for (const [role, navigation] of Object.entries(productNavigation)) {
    const html = renderRoute(navigation.items[0]!.to);
    assert.match(html, new RegExp(`data-role="${role}"`));
    assert.match(html, new RegExp(navigation.label.split(' / ')[0]!));
    assert.match(html, /<main class="product-main" id="main-content"/);
  }
});

test('navigation configurations cover four approved product contexts', () => {
  assert.deepEqual(Object.keys(productNavigation).sort(), [
    'institution-admin',
    'student',
    'super-admin',
    'teacher',
  ]);
});

test('active navigation and breadcrumbs expose non-color current-page semantics', () => {
  const html = renderRoute('/teacher/classes');
  assert.match(html, /aria-current="page"/);
  assert.match(html, /navigation-link--active/);
  assert.match(html, /aria-label="Breadcrumb/);
  assert.match(html, />Classes<\/li>/);
});

test('skip link targets the shell main landmark', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(index, /class="skip-link" href="#main-content"/);
  assert.doesNotMatch(index, /class="skip-link" href="#root"/);
  assert.match(index, /<title>منارة<\/title>/);
  assert.doesNotMatch(index, /<title>[^<]*(?:Manara.*منارة|منارة.*Manara)/);
});

test('shell identity exposes locale-exclusive wordmarks and no text-bearing symbol', () => {
  const html = renderRoute('/student');
  assert.match(html, /data-locale="ar" lang="ar">منارة/);
  assert.match(html, /data-locale="en" lang="en">Manara/);
  assert.doesNotMatch(html, /aria-label="Manara home"/);

  const css = readFileSync(new URL('../src/styles/layouts.css', import.meta.url), 'utf8');
  assert.match(css, /html:lang\(ar\) \[data-locale='ar'\]/);
  assert.match(css, /html:lang\(en\) \[data-locale='en'\]/);
});

test('layout styles use logical properties and semantic variables', () => {
  const css = readFileSync(new URL('../src/styles/layouts.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}/i);
  assert.match(css, /border-inline-end/);
  assert.match(css, /inset-inline-end/);
  assert.match(css, /var\(--surface\)/);
});
