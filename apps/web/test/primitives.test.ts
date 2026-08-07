import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BeaconNode } from '../src/components/beacon/BeaconNode.js';
import { BeaconRail } from '../src/components/beacon/BeaconRail.js';
import { RegistrationMark } from '../src/components/beacon/RegistrationMark.js';
import { Alert } from '../src/components/ui/Alert.js';
import { Button } from '../src/components/ui/Button.js';
import { Input } from '../src/components/ui/Input.js';
import { Progress } from '../src/components/ui/Progress.js';

test('button preserves native semantics, safe type, disabled, and loading state', () => {
  const basic = renderToStaticMarkup(h(Button, null, 'Save'));
  assert.match(basic, /^<button/);
  assert.match(basic, /type="button"/);
  assert.match(basic, /data-variant="primary"/);

  const loading = renderToStaticMarkup(h(Button, { loading: true }, 'Save'));
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /disabled=""/);
  assert.match(loading, />Loading</);
});

test('input remains native and exposes invalid and disabled states', () => {
  const html = renderToStaticMarkup(h(Input, { disabled: true, invalid: true, name: 'email', type: 'email' }));
  assert.match(html, /^<input/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /type="email"/);
});

test('alert announcement role remains an explicit caller decision', () => {
  const staticAlert = renderToStaticMarkup(h(Alert, { title: 'Notice' }, 'Review the record.'));
  assert.doesNotMatch(staticAlert, /role=/);
  const urgentAlert = renderToStaticMarkup(
    h(Alert, { role: 'alert', title: 'Unable to save', variant: 'danger' }, 'Try again.'),
  );
  assert.match(urgentAlert, /role="alert"/);
  assert.match(urgentAlert, /data-variant="danger"/);
});

test('progress uses a native labeled element and visible value text', () => {
  const html = renderToStaticMarkup(h(Progress, { label: 'Course progress', value: 64 }));
  assert.match(html, /<label for=/);
  assert.match(html, /<progress/);
  assert.match(html, /value="64"/);
  assert.match(html, />64%<\/span>/);
});

test('Beacon primitives require semantic context and stay hidden from assistive technology', () => {
  const rail = renderToStaticMarkup(
    h(
      BeaconRail,
      { purpose: 'progress' },
      h(BeaconNode, { meaning: 'checkpoint', state: 'complete' }),
      h(BeaconNode, { meaning: 'consequence', state: 'current' }),
    ),
  );
  assert.match(rail, /data-purpose="progress"/);
  assert.match(rail, /aria-hidden="true"/);
  assert.match(rail, /data-meaning="consequence"/);

  const mark = renderToStaticMarkup(h(RegistrationMark, { context: 'record' }));
  assert.match(mark, /data-context="record"/);
  assert.match(mark, /aria-hidden="true"/);
});

test('component styles use semantic variables and logical properties', () => {
  const css = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}/i);
  assert.match(css, /border-inline-start/);
  assert.match(css, /inset-inline/);
  assert.match(css, /min-height:\s*var\(--control-height\)/);
  assert.match(css, /ui-spin/);
});
