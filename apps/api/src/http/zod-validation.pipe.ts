import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { HttpValidationError } from './errors.js';

export type ValidationTarget = 'body' | 'query' | 'param';

/**
 * Zod-backed validation pipe. Bind it to a handler with
 * `@ValidateBody(schema)`, `@ValidateQuery(schema)`, or `@ValidateParams(schema)`.
 * A `null` schema (the global no-op instance) passes everything through.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(
    private readonly schema: ZodType | null,
    private readonly target: ValidationTarget,
  ) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (this.schema === null) {
      return value;
    }
    if (metadata.type !== this.target) {
      return value;
    }
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    throw new HttpValidationError(
      'Validation failed',
      result.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
        code: issue.code === 'invalid_format' ? 'invalid_string' : issue.code,
        message: issue.message,
      })),
    );
  }
}
