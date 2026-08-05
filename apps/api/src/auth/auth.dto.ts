import { z } from 'zod';
import { authSessionSchema, emailSchema, userSummarySchema } from '@manara/contracts';
import { PASSWORD_MAX_LENGTH } from '../identity/application/password-policy.js';

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export type LoginBody = z.infer<typeof loginBodySchema>;

export const loginResponseSchema = z.object({
  session: authSessionSchema,
  user: userSummarySchema,
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const sessionResponseSchema = z.object({
  session: authSessionSchema,
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

const sessionViewOpenApi = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string' },
    expiresAt: { type: 'string' },
    idleExpiresAt: { type: 'string' },
  },
  required: ['id', 'userId', 'createdAt', 'expiresAt', 'idleExpiresAt'],
};

const userSummaryOpenApi = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    email: { type: 'string' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
  required: ['id', 'email', 'createdAt', 'updatedAt'],
};

export const LOGIN_RESPONSE_OPENAPI = {
  type: 'object',
  properties: {
    session: sessionViewOpenApi,
    user: userSummaryOpenApi,
  },
  required: ['session', 'user'],
};

export const SESSION_RESPONSE_OPENAPI = {
  type: 'object',
  properties: {
    session: sessionViewOpenApi,
  },
  required: ['session'],
};
