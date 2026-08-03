import assert from 'node:assert/strict';
import test from 'node:test';
import { Argon2idPasswordHasher } from '../../src/identity/hasher.js';

const hasher = new Argon2idPasswordHasher();

test('hash produces an argon2id PHC encoded string', async () => {
  const encoded = await hasher.hash('correct horse battery staple');
  assert.ok(encoded.startsWith('$argon2id$v=19$m=65536,t=3,p=4$'));
});

test('hash produces a unique salt per invocation', async () => {
  const first = await hasher.hash('same password');
  const second = await hasher.hash('same password');
  assert.notEqual(first, second);
});

test('verify accepts the correct password', async () => {
  const encoded = await hasher.hash('correct horse battery staple');
  assert.equal(await hasher.verify('correct horse battery staple', encoded), true);
});

test('verify rejects the wrong password', async () => {
  const encoded = await hasher.hash('correct horse battery staple');
  assert.equal(await hasher.verify('wrong password', encoded), false);
});

test('verify rejects an empty password', async () => {
  const encoded = await hasher.hash('correct horse battery staple');
  assert.equal(await hasher.verify('', encoded), false);
});

test('verify rejects malformed encodings without throwing', async () => {
  assert.equal(await hasher.verify('password', 'not-an-argon2id-hash'), false);
  assert.equal(await hasher.verify('password', '$argon2id$broken'), false);
  assert.equal(await hasher.verify('password', ''), false);
});

test('verify rejects a tampered hash segment', async () => {
  const encoded = await hasher.hash('correct horse battery staple');
  const idx = encoded.length - 10;
  const replacement = encoded[idx] === 'A' ? 'B' : 'A';
  const tampered = `${encoded.slice(0, idx)}${replacement}${encoded.slice(idx + 1)}`;
  assert.equal(await hasher.verify('correct horse battery staple', tampered), false);
});
