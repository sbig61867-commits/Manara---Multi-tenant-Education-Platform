import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { SessionService } from '../../src/identity/application/session.service.js';
import { FakeSessionRepository, RecordingEventPublisher } from './helpers.js';

function createService(): {
  service: SessionService;
  sessions: FakeSessionRepository;
  events: RecordingEventPublisher;
} {
  const sessions = new FakeSessionRepository();
  const events = new RecordingEventPublisher();
  const service = new SessionService(sessions, events);
  return { service, sessions, events };
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

test('createSession returns a raw token once and persists only its hash', async () => {
  const { service, sessions } = createService();
  const { token } = await service.createSession('user-1');
  assert.ok(token.length >= 32);
  assert.equal(sessions.storedSessions().length, 1);
  assert.equal(sessions.storedSessions()[0]?.tokenHash, tokenHash(token));
  const serialized = JSON.stringify(sessions.storedSessions());
  assert.ok(!serialized.includes(token));
});

test('createSession sets absolute and idle expiry bounds', async () => {
  const { service } = createService();
  const { session } = await service.createSession('user-1');
  const now = Date.now();
  const expectedAbsolute = now + 24 * 60 * 60 * 1000;
  const expectedIdle = now + 30 * 60 * 1000;
  assert.ok(Math.abs(session.expiresAt.getTime() - expectedAbsolute) < 5_000);
  assert.ok(Math.abs(session.idleExpiresAt.getTime() - expectedIdle) < 5_000);
  assert.equal(session.revokedAt, null);
});

test('createSession revokes the previous session when requested', async () => {
  const { service, sessions, events } = createService();
  const first = await service.createSession('user-1');
  const second = await service.createSession('user-1', { previousSessionId: first.session.id });
  assert.equal((await sessions.findById(first.session.id))?.revokedAt !== null, true);
  assert.equal((await sessions.findById(second.session.id))?.revokedAt, null);
  assert.equal(events.eventsOfType('session.revoked').length, 1);
  assert.equal(events.eventsOfType('session.created').length, 2);
});

test('validateSession returns the session for a valid token', async () => {
  const { service } = createService();
  const { session, token } = await service.createSession('user-1');
  const validated = await service.validateSession(token);
  assert.ok(validated);
  assert.equal(validated.id, session.id);
  assert.equal(validated.userId, 'user-1');
});

test('validateSession returns null for an unknown token', async () => {
  const { service } = createService();
  assert.equal(await service.validateSession('unknown-token'), null);
});

test('validateSession returns null for an absolutely expired session', async () => {
  const { service, sessions } = createService();
  const { session, token } = await service.createSession('user-1');
  const past = new Date(Date.now() - 1_000);
  await sessions.update({ ...session, expiresAt: past, idleExpiresAt: past });
  assert.equal(await service.validateSession(token), null);
});

test('validateSession returns null for an idle-expired session', async () => {
  const { service, sessions } = createService();
  const { session, token } = await service.createSession('user-1');
  const past = new Date(Date.now() - 1_000);
  await sessions.update({ ...session, idleExpiresAt: past });
  assert.equal(await service.validateSession(token), null);
});

test('validateSession returns null for a revoked session', async () => {
  const { service } = createService();
  const { token } = await service.createSession('user-1');
  await service.revokeSession(token);
  assert.equal(await service.validateSession(token), null);
});

test('rotateSession issues a fresh token, preserves absolute expiry, refreshes idle', async () => {
  const { service } = createService();
  const first = await service.createSession('user-1');
  await new Promise((resolve) => setTimeout(resolve, 10));
  const rotated = await service.rotateSession(first.token);
  assert.ok(rotated);
  assert.notEqual(rotated.token, first.token);
  assert.equal(rotated.session.expiresAt.getTime(), first.session.expiresAt.getTime());
  assert.ok(rotated.session.idleExpiresAt.getTime() > first.session.idleExpiresAt.getTime());
  assert.equal(await service.validateSession(first.token), null);
  assert.ok(await service.validateSession(rotated.token));
});

test('rotateSession returns null for an invalid token', async () => {
  const { service } = createService();
  assert.equal(await service.rotateSession('unknown-token'), null);
});

test('revokeSession revokes once and reports false on the second attempt', async () => {
  const { service, events } = createService();
  const { token } = await service.createSession('user-1');
  assert.equal(await service.revokeSession(token), true);
  assert.equal(await service.revokeSession(token), false);
  assert.equal(events.eventsOfType('session.revoked').length, 1);
});

test('revokeAllSessions revokes every session and publishes one event', async () => {
  const { service, events } = createService();
  const first = await service.createSession('user-1');
  const second = await service.createSession('user-1');
  await service.createSession('user-2');
  const count = await service.revokeAllSessions('user-1');
  assert.equal(count, 2);
  assert.equal(await service.validateSession(first.token), null);
  assert.equal(await service.validateSession(second.token), null);
  const revokedAll = events.eventsOfType('session.revoked.all');
  assert.equal(revokedAll.length, 1);
  assert.equal(revokedAll[0]?.count, 2);
});

test('revokeAllSessions publishes nothing when there are no sessions', async () => {
  const { service, events } = createService();
  assert.equal(await service.revokeAllSessions('user-1'), 0);
  assert.equal(events.eventsOfType('session.revoked.all').length, 0);
});

test('session events never contain a raw token', async () => {
  const { service, events } = createService();
  const { token } = await service.createSession('user-1');
  const serialized = JSON.stringify(events.published);
  assert.ok(!serialized.includes(token));
});

test('rotateSession keeps sessions revocable after rotation', async () => {
  const { service } = createService();
  const first = await service.createSession('user-1');
  const rotated = await service.rotateSession(first.token);
  assert.ok(rotated);
  assert.equal(await service.revokeSession(rotated.token), true);
  assert.equal(await service.validateSession(rotated.token), null);
});
