import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDocumentLocale,
  DEFAULT_LOCALE,
  directionForLocale,
  normalizeLocale,
} from '../src/i18n/document-locale.js';

test('English is the default and synchronizes the document as LTR', () => {
  const document = { documentElement: { lang: '', dir: '' }, title: '' };
  assert.equal(DEFAULT_LOCALE, 'en');
  assert.equal(normalizeLocale(undefined), 'en');
  assert.equal(directionForLocale('en'), 'ltr');
  applyDocumentLocale(document, 'en');
  assert.deepEqual(document.documentElement, { lang: 'en', dir: 'ltr' });
  assert.equal(document.title, 'Manara');
});

test('Arabic tags synchronize the document as RTL', () => {
  const document = { documentElement: { lang: 'en', dir: 'ltr' }, title: 'Manara' };
  assert.equal(normalizeLocale('ar'), 'ar');
  assert.equal(directionForLocale('ar'), 'rtl');
  applyDocumentLocale(document, 'ar');
  assert.deepEqual(document.documentElement, { lang: 'ar', dir: 'rtl' });
  assert.equal(document.title, 'منارة');
});

test('unsupported locale input fails safely to the English-first default', () => {
  for (const locale of ['', 'fr', 'not-a-locale', null]) {
    assert.equal(normalizeLocale(locale), 'en');
  }
});
