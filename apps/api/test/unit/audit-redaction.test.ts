import assert from 'node:assert/strict';
import test from 'node:test';
import { REDACTED_VALUE, redactAuditMetadata } from '../../src/audit/application/redaction.js';

test('redaction replaces password fields before persistence', () => {
  const redacted = redactAuditMetadata({ password: 'hunter2', passwd: 'x', pwd: 'y' });
  assert.equal(redacted.password, REDACTED_VALUE);
  assert.equal(redacted.passwd, REDACTED_VALUE);
  assert.equal(redacted.pwd, REDACTED_VALUE);
});

test('redaction replaces password hash fields', () => {
  const redacted = redactAuditMetadata({ password_hash: '$argon2id$abc' });
  assert.equal(redacted.password_hash, REDACTED_VALUE);
});

test('redaction replaces raw session and invitation tokens', () => {
  const redacted = redactAuditMetadata({
    session_token: 'raw-session',
    invitation_token: 'raw-invite',
    refreshToken: 'raw-refresh',
    jwt: 'raw-jwt',
  });
  assert.equal(redacted.session_token, REDACTED_VALUE);
  assert.equal(redacted.invitation_token, REDACTED_VALUE);
  assert.equal(redacted.refreshToken, REDACTED_VALUE);
  assert.equal(redacted.jwt, REDACTED_VALUE);
});

test('redaction replaces API keys, secrets, and credentials', () => {
  const redacted = redactAuditMetadata({
    api_key: 'sk-live-123',
    API_KEY: 'sk-live-456',
    secret: 's3cr3t',
    credentials: 'user:pass',
  });
  assert.equal(redacted.api_key, REDACTED_VALUE);
  assert.equal(redacted.API_KEY, REDACTED_VALUE);
  assert.equal(redacted.secret, REDACTED_VALUE);
  assert.equal(redacted.credentials, REDACTED_VALUE);
});

test('redaction replaces database credentials and connection details', () => {
  const redacted = redactAuditMetadata({
    database_url: 'postgres://u:p@host/db',
    dbUrl: 'postgres://u:p@host/db',
    dsn: 'host=1 user=u',
    connection_string: 'postgres://u:p@host/db',
  });
  assert.equal(redacted.database_url, REDACTED_VALUE);
  assert.equal(redacted.dbUrl, REDACTED_VALUE);
  assert.equal(redacted.dsn, REDACTED_VALUE);
  assert.equal(redacted.connection_string, REDACTED_VALUE);
});

test('redaction replaces full payment details', () => {
  const redacted = redactAuditMetadata({
    card_number: '4111111111111111',
    cardNumber: '4111111111111111',
    cvv: '123',
    cvc: '123',
    pan: '4111111111111111',
  });
  assert.equal(redacted.card_number, REDACTED_VALUE);
  assert.equal(redacted.cardNumber, REDACTED_VALUE);
  assert.equal(redacted.cvv, REDACTED_VALUE);
  assert.equal(redacted.cvc, REDACTED_VALUE);
  assert.equal(redacted.pan, REDACTED_VALUE);
});

test('redaction replaces authorization headers and is case and separator insensitive', () => {
  const redacted = redactAuditMetadata({
    authorization: 'Bearer abc',
    auth_header: 'Bearer def',
    sessionToken: 'raw',
    API_KEY: 'k',
  });
  assert.equal(redacted.authorization, REDACTED_VALUE);
  assert.equal(redacted.auth_header, REDACTED_VALUE);
  assert.equal(redacted.sessionToken, REDACTED_VALUE);
  assert.equal(redacted.API_KEY, REDACTED_VALUE);
});

test('redaction preserves benign metadata fields', () => {
  const redacted = redactAuditMetadata({
    feature_key: 'ai.question_generator',
    quota_key: 'ai_requests_monthly',
    fileName: 'report.pdf',
    status: 'published',
    attemptCount: 3,
  });
  assert.equal(redacted.feature_key, 'ai.question_generator');
  assert.equal(redacted.quota_key, 'ai_requests_monthly');
  assert.equal(redacted.fileName, 'report.pdf');
  assert.equal(redacted.status, 'published');
  assert.equal(redacted.attemptCount, 3);
});

test('redaction returns a new object and does not mutate the input', () => {
  const input = { password: 'hunter2', reason: 'ok' };
  const redacted = redactAuditMetadata(input);
  assert.notEqual(redacted, input);
  assert.equal(input.password, 'hunter2');
  assert.equal(redacted.password, REDACTED_VALUE);
  assert.equal(redacted.reason, 'ok');
});

test('redaction preserves non-sensitive values of every allowed type', () => {
  const redacted = redactAuditMetadata({ count: 5, active: true, note: null, ratio: 1.5 });
  assert.equal(redacted.count, 5);
  assert.equal(redacted.active, true);
  assert.equal(redacted.note, null);
  assert.equal(redacted.ratio, 1.5);
});

test('redaction of an empty metadata object returns an empty object', () => {
  const redacted = redactAuditMetadata({});
  assert.deepEqual(redacted, {});
});
