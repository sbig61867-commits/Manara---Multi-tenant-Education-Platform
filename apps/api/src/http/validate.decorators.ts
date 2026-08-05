import { applyDecorators, UsePipes } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

/** Validates the request body against the given Zod schema. */
export function ValidateBody(schema: ZodType): MethodDecorator & PropertyDecorator {
  return applyDecorators(UsePipes(new ZodValidationPipe(schema, 'body')));
}

/** Validates the query object against the given Zod schema. */
export function ValidateQuery(schema: ZodType): MethodDecorator & PropertyDecorator {
  return applyDecorators(UsePipes(new ZodValidationPipe(schema, 'query')));
}

/** Validates the route params object against the given Zod schema. */
export function ValidateParams(schema: ZodType): MethodDecorator & PropertyDecorator {
  return applyDecorators(UsePipes(new ZodValidationPipe(schema, 'param')));
}
