import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArgumentMetadata } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../src/http/zod-validation.pipe.js';
import { HttpValidationError } from '../../src/http/errors.js';

const bodySchema = z.object({
  email: z.string().email(),
  count: z.coerce.number().int().min(0).max(100),
});

const bodyMetadata: ArgumentMetadata = { type: 'body', metatype: Object, data: undefined };
const queryMetadata: ArgumentMetadata = { type: 'query', metatype: Object, data: undefined };

test('valid bodies pass through with transformed values', () => {
  const pipe = new ZodValidationPipe(bodySchema, 'body');
  const result = pipe.transform({ email: 'a@b.com', count: '5' }, bodyMetadata);
  assert.deepEqual(result, { email: 'a@b.com', count: 5 });
});

test('invalid bodies throw a stable validation error', () => {
  const pipe = new ZodValidationPipe(bodySchema, 'body');
  assert.throws(
    () => pipe.transform({ email: 'not-an-email', count: -1 }, bodyMetadata),
    (error: unknown) => {
      if (!(error instanceof HttpValidationError)) return false;
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'http.validation_failed');
      assert.ok(Array.isArray(error.details));
      assert.equal(error.details?.length, 2);
      const emailIssue = error.details?.find((detail) => detail.path === 'email');
      assert.equal(emailIssue?.code, 'invalid_string');
      return true;
    },
  );
});

test('root-level issues use the (root) path', () => {
  const pipe = new ZodValidationPipe(z.string().min(5), 'body');
  assert.throws(
    () => pipe.transform('abc', bodyMetadata),
    (error: unknown) => error instanceof HttpValidationError && error.details?.[0]?.path === '(root)',
  );
});

test('a null schema is a no-op (global default instance)', () => {
  const pipe = new ZodValidationPipe(null, 'body');
  const value = { anything: true };
  assert.equal(pipe.transform(value, bodyMetadata), value);
});

test('the pipe ignores other metadata targets', () => {
  const pipe = new ZodValidationPipe(bodySchema, 'body');
  const value = { not: 'validated' };
  assert.equal(pipe.transform(value, queryMetadata), value);
});
