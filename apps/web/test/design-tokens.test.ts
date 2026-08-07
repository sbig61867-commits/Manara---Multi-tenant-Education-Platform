import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const tokenPath = fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url));
const css = readFileSync(tokenPath, 'utf8');

function block(selector: string): string {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `missing ${selector} token block`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('\n}', open);
  return css.slice(open + 1, close);
}

function declarations(source: string): Map<string, string> {
  return new Map(
    [...source.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]),
  );
}

function rgb(hex: string): [number, number, number] {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const channels = rgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

const light = declarations(block(':root'));
const dark = declarations(block('.dark'));

test('the approved hierarchy and complete token categories exist', () => {
  for (const family of ['foundation', 'memory', 'consequence']) {
    for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
      assert.ok(light.has(`${family}-${step}`), `missing --${family}-${step}`);
    }
  }
  for (const token of [
    'canvas',
    'surface',
    'surface-muted',
    'surface-strong',
    'text-strong',
    'text',
    'text-muted',
    'action',
    'on-action',
    'font-ui',
    'font-display',
    'control-height',
    'row-height',
    'ring-focus',
    'motion-fast',
    'ease-enter',
    'chart-1',
    'chart-5',
  ]) {
    assert.ok(light.has(token), `missing --${token}`);
  }
});

test('dark mode independently defines surfaces, content, actions, states, and charts', () => {
  for (const token of [
    'canvas',
    'surface',
    'surface-muted',
    'surface-strong',
    'border-subtle',
    'text-strong',
    'text',
    'text-muted',
    'action',
    'on-action',
    'success',
    'warning',
    'danger',
    'info',
    'chart-1',
    'chart-5',
  ]) {
    assert.ok(dark.has(token), `dark mode must define --${token}`);
  }
});

test('approved reference colors and strict visual hierarchy remain stable', () => {
  assert.equal(light.get('foundation-800'), '#103f3a');
  assert.equal(light.get('memory-600'), '#694c70');
  assert.equal(light.get('consequence-600'), '#a05534');
  assert.equal(light.get('canvas'), '#f8f7f3');
  assert.equal(dark.get('canvas'), '#101715');
});

test('core light and dark text/action pairs meet WCAG AA', () => {
  const pairs: Array<[string, string, number]> = [
    [light.get('text')!, light.get('canvas')!, 4.5],
    [light.get('text-strong')!, light.get('surface')!, 4.5],
    [light.get('foundation-700')!, light.get('surface')!, 4.5],
    [light.get('foundation-600')!, '#ffffff', 4.5],
    [dark.get('text')!, dark.get('canvas')!, 4.5],
    [dark.get('text-strong')!, dark.get('surface')!, 4.5],
    [dark.get('action')!, dark.get('on-action')!, 4.5],
  ];
  for (const [foreground, background, minimum] of pairs) {
    assert.ok(
      contrast(foreground, background) >= minimum,
      `${foreground} on ${background} must meet ${minimum}:1`,
    );
  }
});

test('reduced-motion and direction-safe global contracts are present', () => {
  const globalCss = readFileSync(fileURLToPath(new URL('../src/styles/index.css', import.meta.url)), 'utf8');
  assert.match(globalCss, /prefers-reduced-motion:\s*reduce/);
  assert.match(globalCss, /:lang\(ar\)/);
  assert.match(globalCss, /:focus-visible/);
  assert.doesNotMatch(globalCss, /letter-spacing\s*:/);
});
