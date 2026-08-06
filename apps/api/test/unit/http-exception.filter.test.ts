import assert from 'node:assert/strict';
import test from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { HttpExceptionFilter } from '../../src/http/http-exception.filter.js';
import { HttpRateLimitedError } from '../../src/http/errors.js';

interface LogCall {
  fields: Record<string, unknown>;
  message: string;
}

function createHost(reply: Record<string, unknown>, request: Record<string, unknown>): {
  getType(): string;
  switchToHttp(): { getResponse(): Record<string, unknown>; getRequest(): Record<string, unknown> };
} {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => reply, getRequest: () => request }),
  };
}

function createFastifyLikeReply(): { status: (code: number) => typeof reply; send: (payload: unknown) => void; header: (name: string, value: string) => void; sent: boolean; statusCode: number; headers: Record<string, string>; body: unknown } {
  const reply = {
    sent: false,
    statusCode: 0,
    headers: {},
    body: undefined,
    status(code: number): typeof reply {
      reply.statusCode = code;
      return reply;
    },
    send(payload: unknown): void {
      reply.body = payload;
    },
    header(name: string, value: string): void {
      reply.headers[name] = value;
    },
  };
  return reply;
}

function createRequest(logCalls: LogCall[]): Record<string, unknown> {
  return {
    ip: '127.0.0.1',
    method: 'POST',
    url: '/v1/auth/login',
    log: {
      warn: (fields: Record<string, unknown>, message: string) => {
        logCalls.push({ fields, message });
      },
      error: () => undefined,
    },
  };
}

test('a rate-limited error returns 429 with the stable envelope and Retry-After header', () => {
  const logCalls: LogCall[] = [];
  const reply = createFastifyLikeReply();
  const request = createRequest(logCalls);
  const filter = new HttpExceptionFilter();
  filter.catch(new HttpRateLimitedError({ policy: 'login_email_ip', retryAfterSeconds: 42, identifierHash: '0123456789abcdef' }), createHost(reply, request) as never);

  assert.equal(reply.statusCode, 429);
  assert.equal(reply.headers['Retry-After'], '42');
  const error = (reply.body as { error: { code: string; message: string; requestId?: string } }).error;
  assert.equal(error.code, 'http.too_many_requests');
  assert.equal(error.message, 'Too many requests');
  assert.equal(typeof error.requestId, 'string');
  assert.equal(logCalls.length, 1);
  assert.equal(logCalls[0]?.message, 'Authentication rate limit exceeded');
  assert.equal(logCalls[0]?.fields.event, 'auth_rate_limit_blocked');
  assert.equal(logCalls[0]?.fields.policy, 'login_email_ip');
  assert.equal(logCalls[0]?.fields.identifierHash, '0123456789abcdef');
  assert.equal(logCalls[0]?.fields.retryAfterSeconds, 42);
  assert.equal(logCalls[0]?.fields.clientIp, '127.0.0.1');
});

test('rate-limit logs never contain passwords, cookies, tokens, or raw emails', () => {
  const logCalls: LogCall[] = [];
  const reply = createFastifyLikeReply();
  const request = createRequest(logCalls);
  const filter = new HttpExceptionFilter();
  const email = 'student@example.com';
  filter.catch(
    new HttpRateLimitedError({ policy: 'login_email_ip', retryAfterSeconds: 10, identifierHash: '0123456789abcdef' }),
    createHost(reply, request) as never,
  );
  const serialized = JSON.stringify({ ...logCalls[0]?.fields, message: logCalls[0]?.message });
  assert.ok(!serialized.includes(email), 'raw email must not appear in logs');
  assert.ok(!serialized.includes('correct-password'));
  assert.ok(!serialized.includes('raw-session-token'));
  assert.ok(!serialized.includes('manara_session'));
});

test('non-rate-limit errors never set a Retry-After header', () => {
  const logCalls: LogCall[] = [];
  const reply = createFastifyLikeReply();
  const request = createRequest(logCalls);
  const filter = new HttpExceptionFilter();
  filter.catch(new UnauthorizedException('Invalid credentials'), createHost(reply, request) as never);
  assert.equal(reply.statusCode, 401);
  assert.ok(!('Retry-After' in reply.headers));
  assert.equal(logCalls.length, 0, 'only rate-limit blocks are logged as security events');
});
