import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDocumentLocale,
  DEFAULT_LOCALE,
  directionForLocale,
  normalizeLocale,
} from '../src/i18n/document-locale.js';

test('Arabic is the default and synchronizes the document as RTL', () => {
  const document = { documentElement: { lang: '', dir: '' }, title: '' };
  assert.equal(DEFAULT_LOCALE, 'ar');
  assert.equal(normalizeLocale(undefined), 'ar');
  assert.equal(directionForLocale('ar'), 'rtl');
  applyDocumentLocale(document, 'ar');
  assert.deepEqual(document.documentElement, { lang: 'ar', dir: 'rtl' });
  assert.equal(document.title, 'منارة');
});

test('English and regional English tags synchronize the document as LTR', () => {
  const document = { documentElement: { lang: 'ar', dir: 'rtl' }, title: 'منارة' };
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(directionForLocale('en'), 'ltr');
  applyDocumentLocale(document, 'en');
  assert.deepEqual(document.documentElement, { lang: 'en', dir: 'ltr' });
  assert.equal(document.title, 'Manara');
});

test('unsupported locale input fails safely to the Arabic-first default', () => {
  for (const locale of ['', 'fr', 'not-a-locale', null]) {
    assert.equal(normalizeLocale(locale), 'ar');
  }
});
